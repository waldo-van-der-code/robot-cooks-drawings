// SERVER-SIDE ONLY — Groq fallback for SVG generation.
// Uses free-tier models only (Groq retired the Llama 3.3 / 4 Scout models this used before).
import Groq from 'groq-sdk';

// Netlify has the key as lowercase `groq_api_key`.
function getKey(): string | undefined {
  return process.env.GROQ_API_KEY || process.env.groq_api_key;
}

function getClient(): Groq {
  const key = getKey();
  if (!key) throw new Error('GROQ_API_KEY is not set');
  return new Groq({ apiKey: key });
}

// Free-tier models ranked best→worst for SVG generation quality.
const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
];

export async function generateWithGroq(
  systemInstruction: string,
  userPrompt: string,
): Promise<string> {
  const client = getClient();

  let lastError: unknown;
  for (const model of GROQ_MODELS) {
    try {
      console.log(`[groq] Trying model: ${model}`);
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 32768,
        // gpt-oss reasons at medium effort by default, which sometimes took 46 s.
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' as const } : {}),
      });

      const text = completion.choices[0]?.message?.content?.trim() ?? '';
      console.log(`[groq] SUCCESS with ${model} — output length: ${text.length} chars`);
      console.log(`[groq] Output preview:\n${text.slice(0, 400)}${text.length > 400 ? '\n…' : ''}`);
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[groq] Model ${model} failed: ${msg.slice(0, 150)}`);
      lastError = err;
    }
  }

  throw new Error(`All Groq models failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function isGroqAvailable(): boolean {
  return Boolean(getKey());
}
