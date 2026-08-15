'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { useSectionGuard } from '@/lib/use-section-guard';
import { getSttProvider } from '@/lib/voice/stt-provider';
import { speak, stopSpeaking, isTtsSupported } from '@/lib/voice/tts';
import { ArrowLeftIcon, MicIcon, SpeakerOnIcon, SpeakerOffIcon } from '@/components/icons';

const VOICE_REPLY_KEY = 'eagle:voiceReplyEnabled';

type Stage = 'idle' | 'listening' | 'processing' | 'confirm' | 'error' | 'done';

type ParsedIntent = {
  action: 'khata_purchase' | 'khata_payment' | 'khata_return' | 'unknown';
  customer_name: string | null;
  item_name: string | null;
  qty: number | null;
  unit: string | null;
  amount: number | null;
};

type ResolvedCommand = {
  intent: ParsedIntent;
  customerId: string;
  customerName: string;
  itemId: string | null;
  amount: number;
  summary: string;
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

// "Eagle" — a voice command is always Khata-shaped (spec: the example
// the whole feature was scoped from was "Zuhair ke khata mein 4kg sugar
// add karo"), so this reuses record_khata_entry, the exact same RPC
// every manual Khata entry already goes through. Nothing new executes —
// voice is just another way to fill in that one form.
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
    else if (stage === 'done') speak(t('voice.done'), lang);
    else if (stage === 'error' && errorMsg) speak(errorMsg, lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  function reset() {
    setStage('idle');
    setTranscript('');
    setErrorMsg('');
    setResolved(null);
  }

  async function toggleListening() {
    if (stage === 'listening') {
      stt.current.stop();
      return;
    }
    if (!stt.current.isSupported) {
      showToast(t('voice.notSupported'), 'error');
      return;
    }
    setStage('listening');
    setTranscript('');
    setErrorMsg('');
    try {
      // Urdu locale — both providers accept it (Web Speech uses it for
      // its own cloud recognition, Whisper's route hints the same
      // language server-side); "Eagle" itself and any English words in
      // a mixed command still come through fine either way.
      const text = await stt.current.listen(lang === 'ur' ? 'ur-PK' : 'en-PK');
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
        : t('voice.errMic')
      );
    }
  }

  async function handleTranscript(text: string) {
    setStage('processing');
    try {
      const res = await fetch('/api/voice/parse-command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript: text })
      });
      const data = await res.json();
      if (!res.ok) {
        setStage('error');
        setErrorMsg(data.error === 'not_configured' ? t('voice.errGeminiNotConfigured') : t('voice.errParse'));
        return;
      }
      await resolveIntent(data as ParsedIntent, text);
    } catch {
      setStage('error');
      setErrorMsg(t('voice.errParse'));
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

  async function resolveIntent(intent: ParsedIntent, rawText: string) {
    if (intent.action === 'unknown' || !intent.customer_name) {
      setStage('error');
      setErrorMsg(t('voice.errUnclear').replace('{text}', rawText));
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
        <div className="relative w-40 h-40 flex items-center justify-center mb-6">
          {(listening || processing) && (
            <>
              <span className="absolute inset-0 rounded-full bg-haldi/20 animate-ping" style={{ animationDuration: '1.8s' }} />
              <span className="absolute inset-2 rounded-full bg-haldi/25 animate-ping" style={{ animationDuration: '1.8s', animationDelay: '0.3s' }} />
              <span className="absolute inset-6 rounded-full bg-haldi/30 animate-ping" style={{ animationDuration: '1.8s', animationDelay: '0.6s' }} />
            </>
          )}
          <div className={`relative w-28 h-28 rounded-full gradient-brand shadow-glow flex items-center justify-center text-5xl transition-transform ${listening ? 'scale-110' : ''}`}>
            🦅
          </div>
        </div>

        <div className="font-display text-xl font-800 text-haldi mb-1">Eagle</div>

        <div className="text-sm text-chalkdim min-h-[3rem] max-w-sm px-4">
          {stage === 'idle' && t('voice.tapToSpeak')}
          {listening && (transcript ? `"${transcript}"` : t('voice.listening'))}
          {processing && t('voice.thinking')}
          {stage === 'error' && <span className="text-mirch">{errorMsg}</span>}
          {stage === 'done' && <span className="text-dhania">{t('voice.done')}</span>}
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
