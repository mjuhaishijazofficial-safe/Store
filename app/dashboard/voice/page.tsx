'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { useSectionGuard } from '@/lib/use-section-guard';
import { hasSection, type Section } from '@/lib/permissions';
import { getSttProvider } from '@/lib/voice/stt-provider';
import { speak, stopSpeaking, isTtsSupported, primeTts } from '@/lib/voice/tts';
import { fetchWithTimeout } from '@/lib/voice/fetch-timeout';
import { startOfTodayPKT } from '@/lib/pkt-time';
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
  action:
    | 'khata_purchase' | 'khata_payment' | 'khata_return' | 'add_customer' | 'check_balance' | 'check_stock' | 'inventory_summary' | 'print_statement' | 'send_statement_whatsapp'
    | 'stock_in' | 'stock_out' | 'add_expense' | 'check_expense_total' | 'check_sales_total' | 'check_supplier_balance' | 'supplier_payment'
    | 'general_query' | 'unknown';
  customer_name: string | null;
  customer_phone: string | null;
  target_phone: string | null;
  supplier_name: string | null;
  item_name: string | null;
  qty: number | null;
  unit: string | null;
  amount: number | null;
  expense_category: 'rent' | 'salary' | 'utility' | 'marketing' | 'other' | null;
  query: string | null;
};

type ResolvedCommand = {
  intent: ParsedIntent;
  rawText: string;
  // Null for add_customer (creates the customer) and for actions that
  // don't involve one (stock_in/out, add_expense, supplier_payment).
  customerId: string | null;
  customerName: string;
  // Null except for supplier_payment.
  supplierId: string | null;
  itemId: string | null;
  amount: number;
  summary: string;
  // Set only for send_statement_whatsapp — pre-built here (during
  // resolveIntent, before the confirm card even shows) rather than at
  // confirm time, so confirmExecute's window.open() call happens with
  // no await in between it and the tap that triggered it. Browsers
  // silently block a popup opened outside a user gesture's own call
  // stack, and every await in between risks losing that.
  waUrl?: string;
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
  const { shopId, shopName, role, allowedSections } = useShop();
  const router = useRouter();
  const { showToast } = useToast();
  useSectionGuard('khata');

  // Eagle can now touch Inventory/Expenses/Suppliers, not just Khata —
  // each of those actions is gated on the same per-staff section
  // whitelist those modules' own pages already enforce (lib/permissions.ts),
  // so a Cashier not granted "Expenses" in Settings can't get around
  // that by asking Eagle instead of opening the page.
  function hasVoiceSection(section: Section) {
    return hasSection(role, allowedSections, section);
  }

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
  // What Eagle is doing right now, in plain words — set at each real
  // step (not just once for the whole "processing" stage) so the screen
  // shows actual progress ("Zuhair ko dhoond raha hoon...", "Save kar
  // raha hoon...") instead of one static "thinking" the whole time.
  const [processingLabel, setProcessingLabel] = useState('');
  // Flipped by the Cancel button; checked right after every await in the
  // pipeline so a cancel actually stops the in-flight command instead of
  // just hiding the UI while it keeps running in the background and
  // still lands a result (or worse, still executes a write) after the
  // user already walked away from it.
  const cancelledRef = useRef(false);

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
    setProcessingLabel('');
    pendingClarify?.cancel();
    setPendingClarify(null);
  }

  // The Cancel button — visible the entire time Eagle is doing anything
  // on its own (listening, transcribing, thinking), not just once a
  // confirm/clarify card is already up. Stops the mic if it's still
  // recording, flags the in-flight command as abandoned so the pipeline
  // bails out at its next checkpoint instead of finishing and acting
  // anyway, and drops straight back to idle.
  function cancelAll() {
    cancelledRef.current = true;
    stt.current.stop();
    stopSpeaking();
    reset();
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
    // A fresh command — any earlier cancel no longer applies.
    cancelledRef.current = false;
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
      if (cancelledRef.current) return;
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
    setProcessingLabel(t('voice.thinking'));
    try {
      const res = await fetchWithTimeout('/api/voice/parse-command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript: text, history: history.current })
      }, CLIENT_TIMEOUT_MS);
      if (cancelledRef.current) return;
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
  // records — tried a few ways, not just one literal substring:
  //
  // 1. The full phrase as spoken.
  // 2. Singular/plural swap ("headphone" vs "headphones") — a plain
  //    ILIKE '%headphones%' never matches a stored "Headphone" (the
  //    stored name doesn't contain the spoken word as a substring when
  //    they differ only by a trailing 's'), which is a real miss this
  //    fixes directly.
  // 3. Each individual word in what was spoken, dropping short/common
  //    ones — catches a multi-word product name where only part of it
  //    was heard clearly, or where the parsed name has words in a
  //    different order than the stored one.
  //
  // The first strategy that returns anything wins; later ones never run
  // once an earlier one finds rows. An exact case-insensitive match
  // (against whichever strategy matched) always wins outright. More than
  // one partial match with no exact one used to just silently take the
  // first row — now it stops and asks which one via the clarify card,
  // resolving only once a real answer comes back. No match at all across
  // every strategy stays unresolved rather than guessing — this is
  // money/stock, guessing wrong is worse than asking again.
  async function findBestMatch(table: 'customers' | 'items' | 'suppliers', spoken: string): Promise<MatchRow | null> {
    const cols = table === 'items' ? 'id, name, price' : 'id, name';
    const clean = spoken.trim();
    setProcessingLabel(t('voice.searchingFor').replace('{name}', clean));

    async function queryPattern(pattern: string): Promise<MatchRow[]> {
      const { data } = await supabase.from(table).select(cols).eq('shop_id', shopId).ilike('name', `%${pattern}%`);
      return (data || []) as unknown as MatchRow[];
    }

    let rows = await queryPattern(clean);

    if (rows.length === 0) {
      const swapped = clean.endsWith('s') ? clean.slice(0, -1) : `${clean}s`;
      if (swapped) rows = await queryPattern(swapped);
    }

    if (rows.length === 0) {
      const words = clean.split(/\s+/).filter(w => w.length > 2);
      for (const word of words) {
        rows = await queryPattern(word);
        if (rows.length > 0) break;
      }
    }

    if (rows.length === 0) return null;
    const exact = rows.find(r => r.name.trim().toLowerCase() === clean.toLowerCase());
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
    setProcessingLabel(t('voice.searchingAnswer'));
    try {
      const res = await fetchWithTimeout('/api/voice/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, history: history.current })
      }, CLIENT_TIMEOUT_MS);
      if (cancelledRef.current) return;
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
  function requireSection(section: Section, rawText: string): boolean {
    if (hasVoiceSection(section)) return true;
    const msg = t('voice.errNoAccess');
    setStage('error');
    setErrorMsg(msg);
    pushHistory(rawText, msg);
    return false;
  }

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

    if (intent.action === 'check_stock') {
      if (!requireSection('inventory', rawText)) return;
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
      return;
    }

    if (intent.action === 'inventory_summary') {
      if (!requireSection('inventory', rawText)) return;
      // Same low/out-of-stock definitions Inventory's own stat row uses
      // (app/dashboard/inventory/page.tsx) — this answer can't disagree
      // with what that page shows.
      const { data: allItems } = await supabase.from('items').select('name, stock, min_stock').eq('shop_id', shopId);
      const rows = allItems || [];
      const outOfStock = rows.filter((i: any) => i.stock <= 0);
      const lowStock = rows.filter((i: any) => i.stock > 0 && i.stock <= i.min_stock);
      const NAMES_LIMIT = 6;
      const nameList = (list: any[]) => list.slice(0, NAMES_LIMIT).map(i => i.name).join(', ') + (list.length > NAMES_LIMIT ? ` +${list.length - NAMES_LIMIT}` : '');
      let answer = t('voice.answerInventorySummary').replace('{total}', String(rows.length)).replace('{low}', String(lowStock.length)).replace('{out}', String(outOfStock.length));
      if (outOfStock.length > 0) answer += ' ' + t('voice.answerOutOfStockNames').replace('{names}', nameList(outOfStock));
      if (lowStock.length > 0) answer += ' ' + t('voice.answerLowStockNames').replace('{names}', nameList(lowStock));
      setAnswerText(answer);
      setStage('done');
      pushHistory(rawText, answer);
      return;
    }

    if (intent.action === 'check_expense_total') {
      if (!requireSection('expenses', rawText)) return;
      const { data: rows } = await supabase.from('expenses').select('amount').eq('shop_id', shopId).gte('created_at', startOfTodayPKT().toISOString());
      const total = (rows || []).reduce((s: number, r: any) => s + (r.amount || 0), 0);
      const answer = t('voice.answerExpenseTotal').replace('{amount}', fmt(total));
      setAnswerText(answer);
      setStage('done');
      pushHistory(rawText, answer);
      return;
    }

    if (intent.action === 'check_sales_total') {
      if (!requireSection('reports', rawText)) return;
      // Every sale — cash (record_stock_move) and khata (record_khata_entry)
      // alike — lands in `transactions` with type 'sale'/'return' (see
      // supabase/schema.sql); same source Reports' own Total Sales figure
      // reads from, so this answer always agrees with that page.
      const { data: rows } = await supabase.from('transactions').select('type, amount').eq('shop_id', shopId).in('type', ['sale', 'return']).gte('created_at', startOfTodayPKT().toISOString());
      const total = (rows || []).reduce((s: number, r: any) => s + (r.type === 'sale' ? (r.amount || 0) : -(r.amount || 0)), 0);
      const answer = t('voice.answerSalesTotal').replace('{amount}', fmt(Math.max(0, total)));
      setAnswerText(answer);
      setStage('done');
      pushHistory(rawText, answer);
      return;
    }

    // check_supplier_balance
    if (!requireSection('suppliers', rawText)) return;
    if (!intent.supplier_name) { await answerGeneralQuery(intent.query || rawText); return; }
    const supplier = await findBestMatch('suppliers', intent.supplier_name);
    if (!supplier) {
      const msg = t('voice.errSupplierNotFound').replace('{name}', intent.supplier_name);
      setStage('error');
      setErrorMsg(msg);
      pushHistory(rawText, msg);
      return;
    }
    const { data: supplierTotals } = await supabase.rpc('supplier_contact_totals', { p_supplier_id: supplier.id }).single();
    const st = supplierTotals as any;
    const owed = (st?.given || 0) - (st?.paid || 0) - (st?.returned || 0);
    const answer = (owed > 0 ? t('voice.answerSupplierOwes') : t('voice.answerSupplierClear'))
      .replace('{supplier}', supplier.name)
      .replace('{amount}', fmt(Math.abs(owed)));
    setAnswerText(answer);
    setStage('done');
    pushHistory(rawText, answer);
  }

  async function resolveIntent(intent: ParsedIntent, rawText: string) {
    if (intent.action === 'general_query') {
      await answerGeneralQuery(intent.query || rawText);
      return;
    }

    if (
      intent.action === 'check_balance' || intent.action === 'check_stock' || intent.action === 'inventory_summary'
      || intent.action === 'check_expense_total' || intent.action === 'check_sales_total' || intent.action === 'check_supplier_balance'
    ) {
      await answerLookup(intent, rawText);
      return;
    }

    // Removes damaged/miscounted stock or logs a fresh delivery —
    // reuses record_stock_move exactly the way Inventory's own Stock
    // In/Stock Out buttons do, including the same p_reason: 'adjustment'
    // tag Stock Out's manual dropdown already uses (see
    // app/dashboard/inventory/page.tsx), so a voice-triggered removal
    // shows up in History identically to a manual one.
    if (intent.action === 'stock_in' || intent.action === 'stock_out') {
      if (!requireSection('inventory', rawText)) return;
      if (!intent.item_name) { await answerGeneralQuery(rawText); return; }
      const item = await findBestMatch('items', intent.item_name);
      if (!item) {
        const msg = t('voice.errItemNotFound').replace('{name}', intent.item_name);
        setStage('error');
        setErrorMsg(msg);
        pushHistory(rawText, msg);
        return;
      }
      const qty = intent.qty || 0;
      if (!qty || qty <= 0) {
        const msg = t('voice.errNoQty');
        setStage('error');
        setErrorMsg(msg);
        pushHistory(rawText, msg);
        return;
      }
      const amount = intent.amount ?? (item.price ? qty * item.price : 0);
      const summary = (intent.action === 'stock_in' ? t('voice.summaryStockIn') : t('voice.summaryStockOut'))
        .replace('{item}', item.name)
        .replace('{qty}', String(qty))
        .replace('{unit}', intent.unit || '');
      setResolved({ intent, rawText, customerId: null, supplierId: null, customerName: item.name, itemId: item.id, amount, summary });
      setStage('confirm');
      pushHistory(rawText, summary);
      return;
    }

    if (intent.action === 'add_expense') {
      if (!requireSection('expenses', rawText)) return;
      const amount = intent.amount || 0;
      if (!amount || amount <= 0) {
        const msg = t('voice.errNoAmount');
        setStage('error');
        setErrorMsg(msg);
        pushHistory(rawText, msg);
        return;
      }
      const category = intent.expense_category || 'other';
      const summary = t('voice.summaryAddExpense')
        .replace('{category}', t(`expenses.cat${category.charAt(0).toUpperCase()}${category.slice(1)}` as any))
        .replace('{amount}', fmt(amount));
      setResolved({ intent, rawText, customerId: null, supplierId: null, customerName: category, itemId: null, amount, summary });
      setStage('confirm');
      pushHistory(rawText, summary);
      return;
    }

    if (intent.action === 'supplier_payment') {
      if (!requireSection('suppliers', rawText)) return;
      if (!intent.supplier_name) { await answerGeneralQuery(rawText); return; }
      const supplier = await findBestMatch('suppliers', intent.supplier_name);
      if (!supplier) {
        const msg = t('voice.errSupplierNotFound').replace('{name}', intent.supplier_name);
        setStage('error');
        setErrorMsg(msg);
        pushHistory(rawText, msg);
        return;
      }
      const amount = intent.amount || 0;
      if (!amount || amount <= 0) {
        const msg = t('voice.errNoAmount');
        setStage('error');
        setErrorMsg(msg);
        pushHistory(rawText, msg);
        return;
      }
      const summary = t('voice.summarySupplierPayment').replace('{supplier}', supplier.name).replace('{amount}', fmt(amount));
      setResolved({ intent, rawText, customerId: null, supplierId: supplier.id, customerName: supplier.name, itemId: null, amount, summary });
      setStage('confirm');
      pushHistory(rawText, summary);
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

    // WhatsApp has no free "send it for me" API — wa.me only opens a
    // chat with the message already typed in, the same way the
    // customer detail page's own Remind button works (see
    // remindWhatsapp there). This is a text summary, not the actual
    // printed statement — genuinely attaching a document over WhatsApp
    // needs a paid WhatsApp Business API integration this app doesn't
    // have. The one manual step left (tapping Send inside WhatsApp) is
    // a real limit of the free approach, not something skipped here.
    if (intent.action === 'send_statement_whatsapp') {
      if (!intent.customer_name) { await answerGeneralQuery(rawText); return; }
      const customer = await findBestMatch('customers', intent.customer_name);
      if (!customer) {
        const msg = t('voice.errCustomerNotFound').replace('{name}', intent.customer_name);
        setStage('error');
        setErrorMsg(msg);
        pushHistory(rawText, msg);
        return;
      }
      const { data: full } = await supabase.from('customers').select('phone').eq('id', customer.id).single();
      const rawPhone = (intent.target_phone || full?.phone || '').replace(/\D/g, '');
      if (!rawPhone) {
        const msg = t('voice.errNoPhone').replace('{name}', customer.name);
        setStage('error');
        setErrorMsg(msg);
        pushHistory(rawText, msg);
        return;
      }
      // Pakistani local (03xx...) -> international (923xx...), same
      // conversion remindWhatsapp already does — wa.me needs the
      // country code, nobody actually speaks/saves numbers with it.
      const digits = rawPhone.startsWith('0') ? `92${rawPhone.slice(1)}` : rawPhone;

      const { data: totals } = await supabase.rpc('khata_customer_totals', { p_customer_id: customer.id }).single();
      const tt = totals as any;
      const balance = (tt?.given || 0) - (tt?.paid || 0) - (tt?.returned || 0);
      const balanceLine = (balance > 0 ? t('voice.answerBalanceOwes') : balance < 0 ? t('voice.answerBalanceAdvance') : t('voice.answerBalanceClear'))
        .replace('{customer}', customer.name)
        .replace('{amount}', fmt(Math.abs(balance)));
      const message = t('voice.whatsappStatementMsg')
        .replace('{customer}', customer.name)
        .replace('{shop}', shopName || 'Dukaan')
        .replace('{balanceLine}', balanceLine);
      const waUrl = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;

      const summary = t('voice.summarySendWhatsapp').replace('{name}', customer.name).replace('{phone}', rawPhone);
      setResolved({ intent, rawText, customerId: customer.id, supplierId: null, customerName: customer.name, itemId: null, amount: 0, summary, waUrl });
      setStage('confirm');
      pushHistory(rawText, summary);
      return;
    }

    // Creating a customer changes real data, so it goes through the
    // same confirm-before-acting step every money-affecting action uses.
    if (intent.action === 'add_customer') {
      const name = intent.customer_name?.trim();
      if (!name) { await answerGeneralQuery(rawText); return; }
      const existing = await findBestMatch('customers', name);
      if (existing && existing.name.trim().toLowerCase() === name.toLowerCase()) {
        const newPhone = intent.customer_phone?.trim();
        // A customer already existing isn't the end of it if a phone
        // number was actually spoken this time — "Irshad Khan ka
        // contact add karo, 03049444902" for someone already in Khata
        // (added earlier with no number, say) is a real, useful edit,
        // not a no-op. Only offers the update when the number actually
        // differs from what's on file — repeating the same command
        // twice doesn't prompt a pointless "confirm" a second time.
        const { data: current } = await supabase.from('customers').select('phone').eq('id', existing.id).single();
        if (newPhone && current?.phone !== newPhone) {
          const summary = t('voice.summaryUpdatePhone').replace('{name}', existing.name).replace('{phone}', newPhone);
          setResolved({ intent, rawText, customerId: existing.id, supplierId: null, customerName: existing.name, itemId: null, amount: 0, summary });
          setStage('confirm');
          pushHistory(rawText, summary);
          return;
        }
        const answer = t('voice.answerCustomerExists').replace('{name}', existing.name);
        setAnswerText(answer);
        setStage('done');
        pushHistory(rawText, answer);
        return;
      }
      const summary = t('voice.summaryAddCustomer')
        .replace('{name}', name)
        .replace('{phone}', intent.customer_phone?.trim() || '—');
      setResolved({ intent, rawText, customerId: null, supplierId: null, customerName: name, itemId: null, amount: 0, summary });
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

    setResolved({ intent, rawText, customerId: customer.id, supplierId: null, customerName: customer.name, itemId, amount, summary });
    setStage('confirm');
    pushHistory(rawText, summary);
  }

  async function confirmExecute() {
    if (!resolved || confirming) return;

    // Opened first, synchronously, before any await — a popup opened
    // after even one await has run risks the browser deciding it's no
    // longer inside the click's own gesture and silently blocking it.
    // Nothing here needs to wait on the network first: the message and
    // number were already fully built back in resolveIntent.
    if (resolved.intent.action === 'send_statement_whatsapp' && resolved.waUrl) {
      window.open(resolved.waUrl, '_blank');
      setAnswerText(t('voice.doneWhatsappOpened'));
      setStage('done');
      pushHistory(resolved.rawText, t('voice.doneWhatsappOpened'));
      return;
    }

    setConfirming(true);
    setProcessingLabel(t('voice.saving'));

    if (resolved.intent.action === 'add_customer') {
      // customerId set means resolveIntent found this exact name already
      // existing and this confirm is really "update their phone", not
      // "create a new row" — see the add_customer branch above.
      const { error: addErr } = resolved.customerId
        ? await supabase.from('customers').update({ phone: resolved.intent.customer_phone?.trim() || null }).eq('id', resolved.customerId)
        : await supabase.from('customers').insert({
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
      const done = resolved.customerId ? t('voice.donePhoneUpdated') : t('voice.doneCustomerAdded');
      setAnswerText(done);
      setStage('done');
      // Overwrites the "about to add" note pushed when the confirm card
      // first appeared with what actually happened — a later "usay
      // 500 rupay bhi de do" then resolves against a customer who
      // genuinely exists now, not one still theoretical at that point.
      pushHistory(resolved.rawText, done);
      return;
    }

    if (resolved.intent.action === 'stock_in' || resolved.intent.action === 'stock_out') {
      // Same RPC, same p_reason convention Inventory's own Stock Out
      // modal uses for a manual damage/loss/correction entry — see
      // supabase/schema.sql's record_stock_move.
      const { error: stockErr } = await supabase.rpc('record_stock_move', {
        p_item_id: resolved.itemId,
        p_type: resolved.intent.action === 'stock_in' ? 'purchase' : 'sale',
        p_qty: resolved.intent.qty,
        p_amount: resolved.amount,
        p_note: t('voice.voiceEntryNote'),
        p_reason: resolved.intent.action === 'stock_out' ? 'adjustment' : null
      });
      setConfirming(false);
      if (stockErr) {
        setStage('error');
        setErrorMsg(t('common.error'));
        return;
      }
      const done = `${resolved.summary} ${t('voice.doneConfirmedSuffix')}`;
      setAnswerText(done);
      setStage('done');
      pushHistory(resolved.rawText, done);
      return;
    }

    if (resolved.intent.action === 'add_expense') {
      const { error: expErr } = await supabase.from('expenses').insert({
        shop_id: shopId,
        category: resolved.intent.expense_category || 'other',
        amount: resolved.amount,
        note: t('voice.voiceEntryNote'),
        payment_method: 'cash'
      });
      setConfirming(false);
      if (expErr) {
        setStage('error');
        setErrorMsg(t('common.error'));
        return;
      }
      const done = `${resolved.summary} ${t('voice.doneConfirmedSuffix')}`;
      setAnswerText(done);
      setStage('done');
      pushHistory(resolved.rawText, done);
      return;
    }

    if (resolved.intent.action === 'supplier_payment') {
      // Direct insert, same as Suppliers' own "Payment Given" entry —
      // supplier_entries has no RPC wrapper (no linked inventory
      // side-effect to keep atomic with, unlike Khata/stock moves).
      const { error: supErr } = await supabase.from('supplier_entries').insert({
        shop_id: shopId,
        supplier_id: resolved.supplierId,
        type: 'payment',
        amount: resolved.amount,
        note: t('voice.voiceEntryNote'),
        payment_method: 'cash'
      });
      setConfirming(false);
      if (supErr) {
        setStage('error');
        setErrorMsg(t('common.error'));
        return;
      }
      const done = `${resolved.summary} ${t('voice.doneConfirmedSuffix')}`;
      setAnswerText(done);
      setStage('done');
      pushHistory(resolved.rawText, done);
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
        {/* Cancel takes the Back link's own spot the moment Eagle is
            doing anything on its own — the first, most reachable
            control on the whole screen, exactly when it's most needed
            (mid-listen, mid-upload, mid-think), not buried below a card
            that only appears once Eagle is already done deciding. */}
        {(listening || transcribing || processing) ? (
          <button onClick={cancelAll} className="text-xs text-mirch font-700 inline-flex items-center gap-1">
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            {t('voice.cancel')}
          </button>
        ) : (
          <Link href="/dashboard/khata" className="text-xs text-chalkdim hover:text-haldi inline-flex items-center gap-1">
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            {t('khataDetail.back')}
          </Link>
        )}
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
          {processing && (processingLabel || t('voice.thinking'))}
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
