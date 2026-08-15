import { fetchWithTimeout } from './fetch-timeout';

// Shared LLM leg for the voice feature's two text calls (intent parsing
// and general questions).
//
// OpenAI is the default rather than Gemini for one concrete reason:
// Gemini's free tier currently allows only ~20 requests per DAY on the
// flash models, and a voice assistant spends one call per command — so
// it stopped working within minutes of real use. The OpenAI account
// here is already funded for Whisper, and these text calls are tiny
// (a couple of hundred tokens each, fractions of a cent), so putting
// them on the same paid key removes the quota cliff entirely.
//
// Gemini stays available as a fallback provider: set
// VOICE_LLM_PROVIDER=gemini to switch back with no other change.

const OPENAI_TIMEOUT_MS = 12000;
const GEMINI_TIMEOUT_MS = 8000;

export type LlmResult = { text: string | null; rateLimited: boolean };

function useOpenAI() {
  const provider = process.env.VOICE_LLM_PROVIDER;
  if (provider === 'gemini') return false;
  if (provider === 'openai') return true;
  // Unset: prefer OpenAI when its key exists, otherwise fall back to
  // Gemini so an install with only a Gemini key still works.
  return !!process.env.OPENAI_API_KEY;
}

// jsonSchema, when given, constrains the reply to exactly that shape.
export async function askLlm(prompt: string, jsonSchema?: Record<string, unknown>): Promise<LlmResult> {
  return useOpenAI() ? askOpenAI(prompt, jsonSchema) : askGemini(prompt, jsonSchema);
}

async function askOpenAI(prompt: string, jsonSchema?: Record<string, unknown>): Promise<LlmResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { text: null, rateLimited: false };

  try {
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        // gpt-4o-mini: the cheapest capable model — these are short
        // classification/answer calls, not reasoning-heavy work.
        model: process.env.VOICE_LLM_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        ...(jsonSchema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: 'voice_command', strict: false, schema: jsonSchema }
              }
            }
          : {}),
        temperature: 0.2,
        max_tokens: 400
      })
    }, OPENAI_TIMEOUT_MS);

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[voice/llm] OpenAI responded', res.status, detail.slice(0, 400));
      return { text: null, rateLimited: res.status === 429 };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || null;
    return { text, rateLimited: false };
  } catch (e: any) {
    console.error('[voice/llm] OpenAI call threw', e?.message || e);
    return { text: null, rateLimited: false };
  }
}

// Gemini's schema dialect is OpenAPI-ish with uppercase type names,
// which is what the callers already write, so it's passed through
// as-is here and converted for OpenAI above by the callers' own schema.
async function askGemini(prompt: string, jsonSchema?: Record<string, unknown>, withSearch = false): Promise<LlmResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { text: null, rateLimited: false };
  const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

  try {
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
        ...(jsonSchema ? { generationConfig: { responseMimeType: 'application/json', responseSchema: jsonSchema } } : {})
      })
    }, GEMINI_TIMEOUT_MS);

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[voice/llm] Gemini responded', res.status, detail.slice(0, 400));
      return { text: null, rateLimited: res.status === 429 };
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p: any) => p.text || '').join('').trim() : '';
    return { text: text || null, rateLimited: false };
  } catch (e: any) {
    console.error('[voice/llm] Gemini call threw', e?.message || e);
    return { text: null, rateLimited: false };
  }
}

// Live web results, which only Gemini offers here (via its Google Search
// tool). Returns null whenever it's unavailable — quota, no key, or the
// model not supporting it — and the caller falls back to a plain answer.
export async function askWithWebSearch(prompt: string): Promise<string | null> {
  const { text } = await askGemini(prompt, undefined, true);
  return text;
}
