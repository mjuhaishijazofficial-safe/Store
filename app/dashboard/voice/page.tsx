'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { useSectionGuard } from '@/lib/use-section-guard';
import { getSttProvider } from '@/lib/voice/stt-provider';
import { speak, stopSpeaking, isTtsSupported, primeTts } from '@/lib/voice/tts';
import { fetchWithTimeout } from '@/lib/voice/fetch-timeout';
import { startWakeWordListener, isWakeWordSupported, type WakeWordHandle } from '@/lib/voice/wake-word';
import { ArrowLeftIcon, MicIcon, SpeakerOnIcon, SpeakerOffIcon, EarIcon } from '@/components/icons';

const VOICE_REPLY_KEY = 'eagle:voiceReplyEnabled';
const HANDS_FREE_KEY = 'eagle:handsFreeEnabled';
// Short-term memory only — kept in this component's own state, never
// persisted anywhere, gone the moment the page is left. Long enough for
// "usay 500 aur de do" to resolve against the turn just before it,
// short enough that the prompt sent to the LLM stays small and old
// context can't quietly leak into an unrelated new command.
const MAX_HISTORY_TURNS = 4;

// Slightly longer than the server routes' own upstream timeouts, so a
// route that times out internally still gets to return its own proper
// error instead of the browser giving up on it first — but bounded
// regardless, so nothing can leave the UI stuck in "thinking" forever.
const CLIENT_TIMEOUT_MS = 20000;

type Stage = 'idle' | 'listening' | 'transcribing' | 'processing' | 'clarify' | 'confirm' | 'error' | 'done';

type ConversationTurn = { user: string; eagle: string };

type MatchRow = { id: string; name: string; price?: number };
// Set while findBestMatch is waiting on the user to pick between more
// than one same-ish-named customer/item — resolve()/cancel() are what
// the tapped button (or Cancel) below actually calls.
type PendingClarify = { candidates: MatchRow[]; resolve: (row: MatchRow) => void; cancel: () => void };

type ParsedIntent = {
  action: 'khata_purchase' | 'khata_payment' | 'khata_return' | 'add_customer' | 'check_balance' | 'check_stock' | 'print_statement' | 'general_query' | 'unknown';
  customer_name: string | null;
  customer_phone: string | null;
  item_name: string | null;
  qty: number | null;
  unit: string | null;
  amount: number | null;
  query: string | null;
};

type ResolvedCommand = {
  intent: ParsedIntent;
  rawText: string;
  // Null for add_customer — that action is what creates the customer,
  // so there's nothing to resolve to beforehand.
  customerId: string | null;
  customerName: string;
  itemId: string | null;
  amount: number;
  summary: string;
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

// "Eagle" — a Khata-shaped command (the feature's original scope:
// "Zuhair ke khata mein 4kg sugar add karo") reuses record_khata_entry,
// the exact same RPC every manual Khata entry already goes through.
// Anything else spoken to it — a question, a search, "shukriya" — is
// answered read-only via /api/voice/ask (Gemini, optionally grounded
// with a live Google Search) and never touches the ledger at all.
export default function VoicePage() {
  const supabase = createClient();
  const { t, lang } = useLang();
  const { shopId } = useShop();
  const router = useRouter();
  const { showToast } = useToast();
  useSectionGuard('khata');

  const [stage, setStage] = useState<Stage>('idle');
  const [transcript, setTranscript] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [resolved, setResolved] = useState<ResolvedCommand | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Set only for a general_query answer — a plain spoken/read reply,
  // no confirm step, nothing written anywhere (see /api/voice/ask).
  const [answerText, setAnswerText] = useState('');
  // Persisted per-device (not per-shop) — a shop counter with customers
  // standing around may not want Eagle talking out loud even if the
  // owner does at home; localStorage keeps that a personal choice, not
  // a setting that follows the account onto every device.
  const [voiceReplyOn, setVoiceReplyOn] = useState(true);
  const stt = useRef(getSttProvider());

  // Short-term conversation memory — see MAX_HISTORY_TURNS above. A ref,
  // not state: it's read at the moment a request fires (never rendered),
  // so it doesn't need to trigger re-renders the way state would.
  const history = useRef<ConversationTurn[]>([]);
  function pushHistory(userText: string, eagleText: string) {
    history.current = [...history.current, { user: userText, eagle: eagleText }].slice(-MAX_HISTORY_TURNS);
  }

  const [pendingClarify, setPendingClarify] = useState<PendingClarify | null>(null);

  // Hands-free (wake-word) mode — off by default. Unlike voiceReplyOn,
  // this changes what the microphone does (listens continuously
  // whenever this page is open and idle), which is a bigger ask than a
  // one-time mic permission for a single command, so it stays an
  // explicit opt-in rather than defaulting on.
  const [handsFreeOn, setHandsFreeOn] = useState(false);
  const wakeHandle = useRef<WakeWordHandle | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(VOICE_REPLY_KEY);
    if (saved !== null) setVoiceReplyOn(saved === '1');
    const savedHandsFree = localStorage.getItem(HANDS_FREE_KEY);
    if (savedHandsFree === '1' && isWakeWordSupported()) setHandsFreeOn(true);
  }, []);

  useEffect(() => {
    return () => { stt.current.stop(); stopSpeaking(); };
  }, []);

  function toggleVoiceReply() {
    setVoiceReplyOn(prev => {
      const next = !prev;
      localStorage.setItem(VOICE_REPLY_KEY, next ? '1' : '0');
      if (!next) stopSpeaking();
      return next;
    });
  }

  // Eagle speaks back at exactly the moments it has something to say —
  // the confirm summary (so the shopkeeper hears what was understood,
  // not just reads it), a clarifying question when a name matched more
  // than one record, and the final result (done/error). Listening/
  // processing stay silent on purpose — narrating "I'm listening" every
  // single time would get old fast and adds nothing a human doesn't
  // already see from the pulsing avatar.
  useEffect(() => {
    if (!voiceReplyOn) return;
    if (stage === 'confirm' && resolved) speak(`${resolved.summary}. ${t('voice.confirmPrompt')}`, lang);
    else if (stage === 'clarify' && pendingClarify) {
      speak(t('voice.clarifyPrompt').replace('{names}', pendingClarify.candidates.map(c => c.name).join(t('voice.clarifyOr'))), lang);
    }
    else if (stage === 'done') speak(answerText || t('voice.done'), lang);
    else if (stage === 'error' && errorMsg) speak(errorMsg, lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  function reset() {
    setStage('idle');
    setTranscript('');
    setErrorMsg('');
    setResolved(null);
    setAnswerText('');
    pendingClarify?.cancel();
    setPendingClarify(null);
  }

  // Guards against a fast double-tap on "start listening" firing
  // beginListening() twice before the first call's setStage('listening')
  // has actually taken effect — whisper-stt.ts holds its recorder/stream
  // in module-level singletons, so two concurrent listen() calls would
  // stomp on each other (second getUserMedia call overwriting the first
  // one's stream/recorder references), which is exactly the kind of bug
  // that looks like "the button doesn't respond, I have to tap it
  // several times" from the outside.
  const starting = useRef(false);

  function toggleListening() {
    if (stage === 'listening') {
      stt.current.stop();
      return;
    }
    beginListening();
  }

  // Shared by the mic button and the wake-word listener — a spoken
  // "Eagle, ..." starts exactly the same flow a tap does. delayMs gives
  // the wake-word recognizer's own mic access a moment to actually
  // release before Whisper's getUserMedia asks for it — without this,
  // the two can briefly collide over the same microphone on some
  // browsers, right at the handoff.
  async function beginListening(delayMs = 0) {
    if (starting.current) return;
    if (!stt.current.isSupported) {
      showToast(t('voice.notSupported'), 'error');
      return;
    }
    starting.current = true;
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    // Runs inside this click handler on purpose — Chrome only permits
    // speech after a real user gesture, so priming here is what lets
    // Eagle's *first* reply actually be spoken instead of silently
    // dropped (see lib/voice/tts.ts).
    if (voiceReplyOn) primeTts();
    setStage('listening');
    setTranscript('');
    setErrorMsg('');
    try {
      // Urdu locale — both providers accept it (Web Speech uses it for
      // its own cloud recognition, Whisper's route hints the same
      // language server-side); "Eagle" itself and any English words in
      // a mixed command still come through fine either way.
      const text = await stt.current.listen(
        lang === 'ur' ? 'ur-PK' : 'en-PK',
        undefined,
        phase => setStage(phase === 'transcribing' ? 'transcribing' : 'listening')
      );
      setTranscript(text);
      await handleTranscript(text);
    } catch (e: any) {
      const reason = e?.message || 'speech_error';
      console.error('[Eagle] listen failed', reason);
      setStage('error');
      setErrorMsg(
        reason === 'whisper_not_configured' ? t('voice.errWhisperNotConfigured')
        : reason === 'no_speech' ? t('voice.errNoSpeech')
        : reason === 'not_supported' ? t('voice.notSupported')
        // getUserMedia's real DOMException name (see whisper-stt.ts) —
        // each one is a genuinely different fix for the user, not
        // interchangeable "mic broken" noise.
        : reason === 'mic_NotAllowedError' ? t('voice.errMicDenied')
        : reason === 'mic_NotFoundError' ? t('voice.errMicNotFound')
        : reason === 'mic_NotReadableError' ? t('voice.errMicBusy')
        : reason.startsWith('mic_') ? `${t('voice.errMic')} (${reason.slice(4)})`
        : reason === 'network_error' ? t('voice.errNetwork')
        // Anything from the recording/upload pipeline that isn't
        // actually a mic-access problem (AudioContext, MediaRecorder,
        // an unexpected server response) — shown with its own detail
        // instead of being mislabeled as "could not access microphone",
        // which used to hide what was actually wrong.
        : reason.startsWith('recording_failed') ? `${t('voice.errRecording')} (${reason.slice(18).trim()})`
        : t('voice.errGeneric')
      );
    } finally {
      starting.current = false;
    }
  }

  function toggleHandsFree() {
    setHandsFreeOn(prev => {
      const next = !prev;
      localStorage.setItem(HANDS_FREE_KEY, next ? '1' : '0');
      return next;
    });
  }

  // Keeps the wake-word listener running exactly when it should be:
  // hands-free mode is on AND nothing else currently has (or is about
  // to have) the microphone. Stops it the instant either condition
  // stops holding — before beginListening's own getUserMedia call, and
  // whenever hands-free gets turned off — rather than letting two
  // things compete for the mic.
  useEffect(() => {
    if (handsFreeOn && stage === 'idle' && isWakeWordSupported()) {
      wakeHandle.current = startWakeWordListener(
        lang === 'ur' ? 'ur-PK' : 'en-PK',
        () => beginListening(300),
        reason => console.error('[Eagle] wake-word listener error', reason)
      );
    }
    return () => {
      wakeHandle.current?.stop();
      wakeHandle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handsFreeOn, stage]);

  async function handleTranscript(text: string) {
    setStage('processing');
    try {
      const res = await fetchWithTimeout('/api/voice/parse-command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript: text, history: history.current })
      }, CLIENT_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok) {
        // A missing API key or a spent quota are real dead ends
        // (nothing downstream can work either, and the fallback would
        // fail the same way); anything else is worth still trying to
        // answer as a plain question rather than giving up on what was
        // said.
        if (data.error === 'not_configured') {
          setStage('error');
          setErrorMsg(t('voice.errGeminiNotConfigured'));
        } else if (data.error === 'rate_limited') {
          setStage('error');
          setErrorMsg(t('voice.errRateLimited'));
        } else {
          await answerGeneralQuery(text);
        }
        return;
      }
      await resolveIntent(data as ParsedIntent, text);
    } catch {
      await answerGeneralQuery(text);
    }
  }

  // Matches the spoken customer/item name against this shop's own real
  // records. An exact case-insensitive match wins outright. More than
  // one partial match with no exact one (two different "Ali"s) used to
  // just silently take the first row — now it stops and asks which one,
  // via the same clarify-card mechanism confirm uses, and only resolves
  // once a real answer comes back. No match at all stays unresolved
  // rather than guessing — this is money, guessing wrong is worse than
  // asking again.
  async function findBestMatch(table: 'customers' | 'items', spoken: string): Promise<MatchRow | null> {
    const cols = table === 'items' ? 'id, name, price' : 'id, name';
    const { data } = await supabase.from(table).select(cols).eq('shop_id', shopId).ilike('name', `%${spoken.trim()}%`);
    const rows = (data || []) as unknown as MatchRow[];
    if (rows.length === 0) return null;
    const exact = rows.find(r => r.name.trim().toLowerCase() === spoken.trim().toLowerCase());
    if (exact) return exact;
    if (rows.length === 1) return rows[0];

    return new Promise<MatchRow | null>(resolveOuter => {
      setPendingClarify({
        candidates: rows.slice(0, 4),
        resolve: row => { setPendingClarify(null); setStage('processing'); resolveOuter(row); },
        // Same settling path as resolve, just with no row — the caller
        // that was awaiting this then runs its own normal "not found"
        // handling, exactly as if nothing had matched at all. Also what
        // reset() calls if the user backs out of the page mid-clarify,
        // so the dangling promise doesn't hang forever.
        cancel: () => { setPendingClarify(null); setStage('processing'); resolveOuter(null); }
      });
      setStage('clarify');
    });
  }

  // Read-only leg — a question/search/general chat, never touches
  // Khata/stock. No confirm step: nothing here is reversible-because-
  // nothing-happened, so there's nothing to confirm before doing.
  async function answerGeneralQuery(query: string) {
    try {
      const res = await fetchWithTimeout('/api/voice/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, history: history.current })
      }, CLIENT_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok || !data.answer) {
        const msg = data.error === 'not_configured' ? t('voice.errGeminiNotConfigured') : t('voice.errParse');
        setStage('error');
        setErrorMsg(msg);
        pushHistory(query, msg);
        return;
      }
      setAnswerText(data.answer);
      setStage('done');
      pushHistory(query, data.answer);
    } catch {
      setStage('error');
      setErrorMsg(t('voice.errParse'));
      pushHistory(query, t('voice.errParse'));
    }
  }

  // Read-only lookups against the shop's own data — answered straight
  // away with no confirm step, since nothing changes. These exist as
  // real actions rather than being left to the general-question path
  // precisely because that path can only guess; these read the actual
  // records.
  async function answerLookup(intent: ParsedIntent, rawText: string) {
    if (intent.action === 'check_balance') {
      if (!intent.customer_name) { await answerGeneralQuery(intent.query || rawText); return; }
      const customer = await findBestMatch('customers', intent.customer_name);
      if (!customer) {
        const msg = t('voice.errCustomerNotFound').replace('{name}', intent.customer_name);
        setStage('error');
        setErrorMsg(msg);
        pushHistory(rawText, msg);
        return;
      }
      const { data } = await supabase.rpc('khata_customer_totals', { p_customer_id: customer.id }).single();
      const d = data as any;
      const balance = (d?.given || 0) - (d?.paid || 0) - (d?.returned || 0);
      const answer = (balance > 0 ? t('voice.answerBalanceOwes') : balance < 0 ? t('voice.answerBalanceAdvance') : t('voice.answerBalanceClear'))
        .replace('{customer}', customer.name)
        .replace('{amount}', fmt(Math.abs(balance)));
      setAnswerText(answer);
      setStage('done');
      pushHistory(rawText, answer);
      return;
    }

    // check_stock
    if (!intent.item_name) { await answerGeneralQuery(intent.query || rawText); return; }
    const item = await findBestMatch('items', intent.item_name);
    if (!item) {
      const msg = t('voice.errItemNotFound').replace('{name}', intent.item_name);
      setStage('error');
      setErrorMsg(msg);
      pushHistory(rawText, msg);
      return;
    }
    const { data: full } = await supabase.from('items').select('name, stock, unit').eq('id', item.id).single();
    const answer = t('voice.answerStock')
      .replace('{item}', full?.name || item.name)
      .replace('{qty}', String(full?.stock ?? 0))
      .replace('{unit}', full?.unit || '');
    setAnswerText(answer);
    setStage('done');
    pushHistory(rawText, answer);
  }

  async function resolveIntent(intent: ParsedIntent, rawText: string) {
    if (intent.action === 'general_query') {
      await answerGeneralQuery(intent.query || rawText);
      return;
    }

    if (intent.action === 'check_balance' || intent.action === 'check_stock') {
      await answerLookup(intent, rawText);
      return;
    }

    // Navigates to the customer's own page with the print dialog
    // already opening there (CustomerStatementModal's autoPrint prop,
    // triggered by ?autoPrint=1 — see app/dashboard/khata/[id]/page.tsx)
    // rather than trying to print from this page, which has no printer-
    // ready statement view of its own to reuse.
    if (intent.action === 'print_statement') {
      if (!intent.customer_name) { await answerGeneralQuery(rawText); return; }
      const customer = await findBestMatch('customers', intent.customer_name);
      if (!customer) {
        const msg = t('voice.errCustomerNotFound').replace('{name}', intent.customer_name);
        setStage('error');
        setErrorMsg(msg);
        pushHistory(rawText, msg);
        return;
      }
      const answer = t('voice.doneOpeningStatement').replace('{name}', customer.name);
      setAnswerText(answer);
      setStage('done');
      pushHistory(rawText, answer);
      router.push(`/dashboard/khata/${customer.id}?autoPrint=1`);
      return;
    }

    // Creating a customer changes real data, so it goes through the
    // same confirm-before-acting step every money-affecting action uses.
    if (intent.action === 'add_customer') {
      const name = intent.customer_name?.trim();
      if (!name) { await answerGeneralQuery(rawText); return; }
      const existing = await findBestMatch('customers', name);
      if (existing && existing.name.trim().toLowerCase() === name.toLowerCase()) {
        const answer = t('voice.answerCustomerExists').replace('{name}', existing.name);
        setAnswerText(answer);
        setStage('done');
        pushHistory(rawText, answer);
        return;
      }
      const summary = t('voice.summaryAddCustomer')
        .replace('{name}', name)
        .replace('{phone}', intent.customer_phone?.trim() || '—');
      setResolved({ intent, rawText, customerId: null, customerName: name, itemId: null, amount: 0, summary });
      setStage('confirm');
      pushHistory(rawText, summary);
      return;
    }
    // Never dead-end on "I didn't understand". If it isn't a Khata
    // command, it's still something the user said out loud and expects
    // an answer to — hand it to the general-question path instead of
    // refusing. Only Khata actions (which move money and stock) need
    // to be certain; a spoken question does not.
    if (intent.action === 'unknown' || !intent.customer_name) {
      await answerGeneralQuery(rawText);
      return;
    }

    const customer = await findBestMatch('customers', intent.customer_name);
    if (!customer) {
      const msg = t('voice.errCustomerNotFound').replace('{name}', intent.customer_name);
      setStage('error');
      setErrorMsg(msg);
      pushHistory(rawText, msg);
      return;
    }

    let itemId: string | null = null;
    let amount = intent.amount ?? 0;
    if (intent.action !== 'khata_payment' && intent.item_name) {
      const item = await findBestMatch('items', intent.item_name);
      if (item) {
        itemId = item.id;
        if (!amount && intent.qty && item.price) amount = intent.qty * item.price;
      }
    }

    if (!amount || amount <= 0) {
      const msg = t('voice.errNoAmount');
      setStage('error');
      setErrorMsg(msg);
      pushHistory(rawText, msg);
      return;
    }

    const itemLabel = intent.item_name ? `${intent.item_name}${intent.qty ? ` — ${intent.qty}${intent.unit ? ' ' + intent.unit : ''}` : ''}` : '';
    const summary =
      intent.action === 'khata_purchase' ? t('voice.summaryPurchase').replace('{customer}', customer.name).replace('{item}', itemLabel).replace('{amount}', fmt(amount))
      : intent.action === 'khata_return' ? t('voice.summaryReturn').replace('{customer}', customer.name).replace('{item}', itemLabel).replace('{amount}', fmt(amount))
      : t('voice.summaryPayment').replace('{customer}', customer.name).replace('{amount}', fmt(amount));

    setResolved({ intent, rawText, customerId: customer.id, customerName: customer.name, itemId, amount, summary });
    setStage('confirm');
    pushHistory(rawText, summary);
  }

  async function confirmExecute() {
    if (!resolved || confirming) return;
    setConfirming(true);

    if (resolved.intent.action === 'add_customer') {
      const { error: addErr } = await supabase.from('customers').insert({
        shop_id: shopId,
        name: resolved.customerName,
        phone: resolved.intent.customer_phone?.trim() || null
      });
      setConfirming(false);
      if (addErr) {
        setStage('error');
        setErrorMsg(t('common.error'));
        return;
      }
      setAnswerText(t('voice.doneCustomerAdded'));
      setStage('done');
      // Overwrites the "about to add" note pushed when the confirm card
      // first appeared with what actually happened — a later "usay
      // 500 rupay bhi de do" then resolves against a customer who
      // genuinely exists now, not one still theoretical at that point.
      pushHistory(resolved.rawText, t('voice.doneCustomerAdded'));
      return;
    }

    const p_type = resolved.intent.action === 'khata_purchase' ? 'purchase' : resolved.intent.action === 'khata_return' ? 'return' : 'payment';
    const { error: err } = await supabase.rpc('record_khata_entry', {
      p_customer_id: resolved.customerId,
      p_type,
      p_item_id: resolved.itemId,
      p_item_name: resolved.intent.item_name,
      p_qty: resolved.intent.qty,
      p_amount: resolved.amount,
      // Voice doesn't ask payment method yet — defaults to cash, same
      // as every other entry point before payment-method existed.
      p_note: t('voice.voiceEntryNote'),
      p_payment_method: 'cash'
    });
    setConfirming(false);
    if (err) {
      setStage('error');
      setErrorMsg(t('common.error'));
      return;
    }
    setStage('done');
    pushHistory(resolved.rawText, `${resolved.summary} ${t('voice.doneConfirmedSuffix')}`);
  }

  const listening = stage === 'listening';
  const transcribing = stage === 'transcribing';
  const processing = stage === 'processing';

  return (
    <div className="min-h-[80vh] flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <Link href="/dashboard/khata" className="text-xs text-chalkdim hover:text-haldi inline-flex items-center gap-1">
          <ArrowLeftIcon className="w-3.5 h-3.5" />
          {t('khataDetail.back')}
        </Link>
        <div className="flex items-center gap-3">
          {isWakeWordSupported() && (
            <button
              onClick={toggleHandsFree}
              title={t('voice.handsFreeToggle')}
              className={`flex items-center gap-1 text-xs ${handsFreeOn ? 'text-haldi' : 'text-chalkdim hover:text-haldi'}`}
            >
              <EarIcon className="w-4 h-4" />
              {handsFreeOn ? t('voice.handsFreeOn') : t('voice.handsFreeOff')}
            </button>
          )}
          {isTtsSupported() && (
            <button
              onClick={toggleVoiceReply}
              title={voiceReplyOn ? t('voice.muteReply') : t('voice.unmuteReply')}
              className="text-chalkdim hover:text-haldi"
            >
              {voiceReplyOn ? <SpeakerOnIcon className="w-4 h-4" /> : <SpeakerOffIcon className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
        {/* The "Eagle" avatar — concentric rings pulse continuously while
            listening/processing (pure CSS, no live audio-amplitude
            wiring — a steady "breathing" animation reads as "alive"
            just as well and is far simpler/more reliable). */}
        <div className="relative w-56 h-56 sm:w-64 sm:h-64 flex items-center justify-center mb-6">
          {(listening || transcribing || processing || (stage === 'idle' && handsFreeOn)) && (
            <>
              <span className="absolute inset-0 rounded-full bg-haldi/20 animate-ping" style={{ animationDuration: '1.8s' }} />
              <span className="absolute inset-3 rounded-full bg-haldi/25 animate-ping" style={{ animationDuration: '1.8s', animationDelay: '0.3s' }} />
              <span className="absolute inset-8 rounded-full bg-haldi/30 animate-ping" style={{ animationDuration: '1.8s', animationDelay: '0.6s' }} />
            </>
          )}
          <div className={`relative w-40 h-40 sm:w-44 sm:h-44 rounded-full gradient-brand shadow-glow flex items-center justify-center text-7xl sm:text-8xl transition-transform ${listening ? 'scale-110' : ''}`}>
            🦅
          </div>
        </div>

        <div className="font-display text-xl font-800 text-haldi mb-1">Eagle</div>

        <div className="text-sm text-chalkdim min-h-[3rem] max-w-sm px-4">
          {stage === 'idle' && (handsFreeOn ? t('voice.waitingForWake') : t('voice.tapToSpeak'))}
          {listening && (transcript ? `"${transcript}"` : t('voice.listening'))}
          {transcribing && t('voice.transcribing')}
          {processing && t('voice.thinking')}
          {stage === 'clarify' && pendingClarify && (
            t('voice.clarifyPrompt').replace('{names}', pendingClarify.candidates.map(c => c.name).join(t('voice.clarifyOr')))
          )}
          {stage === 'error' && <span className="text-mirch">{errorMsg}</span>}
          {stage === 'done' && (
            <span className={answerText ? 'text-chalk' : 'text-dhania'}>{answerText || t('voice.done')}</span>
          )}
        </div>

        {stage === 'clarify' && pendingClarify && (
          <div className="card p-5 mt-2 max-w-sm w-full text-left">
            <div className="text-sm font-600 mb-3">{t('voice.clarifyTitle')}</div>
            <div className="flex flex-col gap-2 mb-3">
              {pendingClarify.candidates.map(c => (
                <button key={c.id} onClick={() => pendingClarify.resolve(c)} className="btn-secondary text-left px-4 py-2.5">
                  {c.name}
                </button>
              ))}
            </div>
            <button onClick={() => pendingClarify.cancel()} className="text-chalkdim text-xs underline w-full text-center">
              {t('khataDetail.cancel')}
            </button>
          </div>
        )}

        {stage === 'confirm' && resolved && (
          <div className="card p-5 mt-2 max-w-sm w-full text-left">
            <div className="text-sm font-600 mb-4">{resolved.summary}</div>
            <div className="flex gap-2">
              <button onClick={reset} className="btn-secondary flex-1">{t('khataDetail.cancel')}</button>
              <button onClick={confirmExecute} disabled={confirming} className="btn-primary flex-1">
                {confirming ? t('khataDetail.loading') : t('voice.confirm')}
              </button>
            </div>
          </div>
        )}

        {(stage === 'idle' || listening) && (
          <button
            onClick={toggleListening}
            className={`mt-6 w-16 h-16 rounded-full flex items-center justify-center shadow-glow transition-colors ${listening ? 'bg-mirch text-board' : 'bg-haldi text-board'}`}
            aria-label={t('voice.tapToSpeak')}
          >
            <MicIcon className="w-7 h-7" />
          </button>
        )}
        {listening && <div className="text-[11px] text-chalkdim mt-2">{t('voice.tapToStop')}</div>}

        {(stage === 'error' || stage === 'done') && (
          <button onClick={reset} className="btn-secondary mt-4 px-6">{t('voice.tryAgain')}</button>
        )}
      </div>
    </div>
  );
}
