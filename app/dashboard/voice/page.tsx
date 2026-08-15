'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { useSectionGuard } from '@/lib/use-section-guard';
import { getSttProvider } from '@/lib/voice/stt-provider';
import { speak, stopSpeaking, isTtsSupported, primeTts } from '@/lib/voice/tts';
import { fetchWithTimeout } from '@/lib/voice/fetch-timeout';
import { ArrowLeftIcon, MicIcon, SpeakerOnIcon, SpeakerOffIcon } from '@/components/icons';

const VOICE_REPLY_KEY = 'eagle:voiceReplyEnabled';

// Slightly longer than the server routes' own upstream timeouts, so a
// route that times out internally still gets to return its own proper
// error instead of the browser giving up on it first — but bounded
// regardless, so nothing can leave the UI stuck in "thinking" forever.
const CLIENT_TIMEOUT_MS = 20000;

type Stage = 'idle' | 'listening' | 'transcribing' | 'processing' | 'confirm' | 'error' | 'done';

type ParsedIntent = {
  action: 'khata_purchase' | 'khata_payment' | 'khata_return' | 'add_customer' | 'check_balance' | 'check_stock' | 'general_query' | 'unknown';
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

  useEffect(() => {
    const saved = localStorage.getItem(VOICE_REPLY_KEY);
    if (saved !== null) setVoiceReplyOn(saved === '1');
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
  // not just reads it), and the final result (done/error). Listening/
  // processing stay silent on purpose — narrating "I'm listening" every
  // single time would get old fast and adds nothing a human doesn't
  // already see from the pulsing avatar.
  useEffect(() => {
    if (!voiceReplyOn) return;
    if (stage === 'confirm' && resolved) speak(`${resolved.summary}. ${t('voice.confirmPrompt')}`, lang);
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
  }

  // Guards against a fast double-tap on "start listening" firing
  // toggleListening() twice before the first call's setStage('listening')
  // has actually taken effect — whisper-stt.ts holds its recorder/stream
  // in module-level singletons, so two concurrent listen() calls would
  // stomp on each other (second getUserMedia call overwriting the first
  // one's stream/recorder references), which is exactly the kind of bug
  // that looks like "the button doesn't respond, I have to tap it
  // several times" from the outside.
  const starting = useRef(false);

  async function toggleListening() {
    if (stage === 'listening') {
      stt.current.stop();
      return;
    }
    if (starting.current) return;
    if (!stt.current.isSupported) {
      showToast(t('voice.notSupported'), 'error');
      return;
    }
    starting.current = true;
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

  async function handleTranscript(text: string) {
    setStage('processing');
    try {
      const res = await fetchWithTimeout('/api/voice/parse-command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript: text })
      }, CLIENT_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok) {
        // A missing API key is a real dead end (nothing downstream can
        // work either); anything else is worth still trying to answer
        // as a plain question rather than giving up on what was said.
        if (data.error === 'not_configured') {
          setStage('error');
          setErrorMsg(t('voice.errGeminiNotConfigured'));
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
  // records — an exact case-insensitive match wins if there is one,
  // otherwise the first name that contains what was said (handles
  // "Zuhair" matching a saved "Muhammad Zuhair"). No match at all is
  // treated as unresolved rather than guessing which customer was meant
  // — this is money, guessing wrong is worse than asking again.
  async function findBestMatch(table: 'customers' | 'items', spoken: string): Promise<{ id: string; name: string; price?: number } | null> {
    const cols = table === 'items' ? 'id, name, price' : 'id, name';
    const { data } = await supabase.from(table).select(cols).eq('shop_id', shopId).ilike('name', `%${spoken.trim()}%`);
    const rows = (data || []) as any[];
    if (rows.length === 0) return null;
    const exact = rows.find(r => r.name.trim().toLowerCase() === spoken.trim().toLowerCase());
    return exact || rows[0];
  }

  // Read-only leg — a question/search/general chat, never touches
  // Khata/stock. No confirm step: nothing here is reversible-because-
  // nothing-happened, so there's nothing to confirm before doing.
  async function answerGeneralQuery(query: string) {
    try {
      const res = await fetchWithTimeout('/api/voice/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query })
      }, CLIENT_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok || !data.answer) {
        setStage('error');
        setErrorMsg(data.error === 'not_configured' ? t('voice.errGeminiNotConfigured') : t('voice.errParse'));
        return;
      }
      setAnswerText(data.answer);
      setStage('done');
    } catch {
      setStage('error');
      setErrorMsg(t('voice.errParse'));
    }
  }

  // Read-only lookups against the shop's own data — answered straight
  // away with no confirm step, since nothing changes. These exist as
  // real actions rather than being left to the general-question path
  // precisely because that path can only guess; these read the actual
  // records.
  async function answerLookup(intent: ParsedIntent) {
    if (intent.action === 'check_balance') {
      if (!intent.customer_name) { await answerGeneralQuery(intent.query || ''); return; }
      const customer = await findBestMatch('customers', intent.customer_name);
      if (!customer) {
        setStage('error');
        setErrorMsg(t('voice.errCustomerNotFound').replace('{name}', intent.customer_name));
        return;
      }
      const { data } = await supabase.rpc('khata_customer_totals', { p_customer_id: customer.id }).single();
      const d = data as any;
      const balance = (d?.given || 0) - (d?.paid || 0) - (d?.returned || 0);
      setAnswerText(
        (balance > 0 ? t('voice.answerBalanceOwes') : balance < 0 ? t('voice.answerBalanceAdvance') : t('voice.answerBalanceClear'))
          .replace('{customer}', customer.name)
          .replace('{amount}', fmt(Math.abs(balance)))
      );
      setStage('done');
      return;
    }

    // check_stock
    if (!intent.item_name) { await answerGeneralQuery(intent.query || ''); return; }
    const item = await findBestMatch('items', intent.item_name);
    if (!item) {
      setStage('error');
      setErrorMsg(t('voice.errItemNotFound').replace('{name}', intent.item_name));
      return;
    }
    const { data: full } = await supabase.from('items').select('name, stock, unit').eq('id', item.id).single();
    setAnswerText(
      t('voice.answerStock')
        .replace('{item}', full?.name || item.name)
        .replace('{qty}', String(full?.stock ?? 0))
        .replace('{unit}', full?.unit || '')
    );
    setStage('done');
  }

  async function resolveIntent(intent: ParsedIntent, rawText: string) {
    if (intent.action === 'general_query') {
      await answerGeneralQuery(intent.query || rawText);
      return;
    }

    if (intent.action === 'check_balance' || intent.action === 'check_stock') {
      await answerLookup(intent);
      return;
    }

    // Creating a customer changes real data, so it goes through the
    // same confirm-before-acting step every money-affecting action uses.
    if (intent.action === 'add_customer') {
      const name = intent.customer_name?.trim();
      if (!name) { await answerGeneralQuery(rawText); return; }
      const existing = await findBestMatch('customers', name);
      if (existing && existing.name.trim().toLowerCase() === name.toLowerCase()) {
        setAnswerText(t('voice.answerCustomerExists').replace('{name}', existing.name));
        setStage('done');
        return;
      }
      setResolved({
        intent,
        customerId: null,
        customerName: name,
        itemId: null,
        amount: 0,
        summary: t('voice.summaryAddCustomer')
          .replace('{name}', name)
          .replace('{phone}', intent.customer_phone?.trim() || '—')
      });
      setStage('confirm');
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
      setStage('error');
      setErrorMsg(t('voice.errCustomerNotFound').replace('{name}', intent.customer_name));
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
      setStage('error');
      setErrorMsg(t('voice.errNoAmount'));
      return;
    }

    const itemLabel = intent.item_name ? `${intent.item_name}${intent.qty ? ` — ${intent.qty}${intent.unit ? ' ' + intent.unit : ''}` : ''}` : '';
    const summary =
      intent.action === 'khata_purchase' ? t('voice.summaryPurchase').replace('{customer}', customer.name).replace('{item}', itemLabel).replace('{amount}', fmt(amount))
      : intent.action === 'khata_return' ? t('voice.summaryReturn').replace('{customer}', customer.name).replace('{item}', itemLabel).replace('{amount}', fmt(amount))
      : t('voice.summaryPayment').replace('{customer}', customer.name).replace('{amount}', fmt(amount));

    setResolved({ intent, customerId: customer.id, customerName: customer.name, itemId, amount, summary });
    setStage('confirm');
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

      <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
        {/* The "Eagle" avatar — concentric rings pulse continuously while
            listening/processing (pure CSS, no live audio-amplitude
            wiring — a steady "breathing" animation reads as "alive"
            just as well and is far simpler/more reliable). */}
        <div className="relative w-56 h-56 sm:w-64 sm:h-64 flex items-center justify-center mb-6">
          {(listening || transcribing || processing) && (
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
          {stage === 'idle' && t('voice.tapToSpeak')}
          {listening && (transcript ? `"${transcript}"` : t('voice.listening'))}
          {transcribing && t('voice.transcribing')}
          {processing && t('voice.thinking')}
          {stage === 'error' && <span className="text-mirch">{errorMsg}</span>}
          {stage === 'done' && (
            <span className={answerText ? 'text-chalk' : 'text-dhania'}>{answerText || t('voice.done')}</span>
          )}
        </div>

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
