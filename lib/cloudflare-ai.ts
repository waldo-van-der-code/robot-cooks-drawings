// SERVER-SIDE ONLY — Cloudflare Workers AI (free daily allocation, no billing required)
// Token: Cloudflare dashboard → API Tokens → custom token with "Workers AI Read" on the account
// Replaced Hugging Face Inference after its free credits ran out (2026-10).

import sharp from 'sharp';
import type { Orientation, Preset } from './types';

const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5'; // 384-dim, same model as before
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const EMBEDDING_DIM = 384;

export function isCloudflareAiAvailable(): boolean {
  return !!(process.env.CF_ACCOUNT_ID && process.env.CF_AI_TOKEN);
}

async function run<T>(model: string, input: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_AI_TOKEN;
  if (!accountId || !token) throw new Error('CF_ACCOUNT_ID / CF_AI_TOKEN are not set');

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => null) as
    { success?: boolean; result?: T; errors?: { message: string }[] } | null;
  if (!res.ok || !data?.success || !data.result) {
    const msg = data?.errors?.map(e => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Workers AI ${model} failed: ${msg}`);
  }
  return data.result;
}

export async function cfEmbed(text: string): Promise<number[]> {
  const result = await run<{ data?: number[][] }>(EMBEDDING_MODEL, { text: [text] }, 10_000);
  const vector = result.data?.[0];
  if (vector?.length !== EMBEDDING_DIM) {
    throw new Error(`Workers AI ${EMBEDDING_MODEL} returned ${vector?.length ?? 'no'} dims, expected ${EMBEDDING_DIM}`);
  }
  return vector;
}

export async function generateImageWithCloudflare(params: {
  prompt: string;
  preset: Preset;
  orientation: Orientation;
}): Promise<{ imageBase64: string; mimeType: 'image/png' }> {
  const presetHint = params.preset === 'story_sketch'
    ? 'expressive kids storybook illustration, charming cartoon characters with personality'
    : 'classic kids coloring book page, large colorable regions, child-friendly';

  const fullPrompt = `${presetHint}, ${params.prompt}. Black and white line art only, bold clean outlines, no color fills, no shading, no gradients, pure white background, kids cartoon illustration style, printable coloring page`;

  console.log(`[cf-image] Trying model: ${IMAGE_MODEL}`);
  const result = await run<{ image: string }>(IMAGE_MODEL, { prompt: fullPrompt, steps: 4 }, 30_000);

  // FLUX returns a square JPEG; the rest of the app stores and serves PNG.
  // The PDF and thumbnail steps letterbox it onto the A4 page.
  const png = await sharp(Buffer.from(result.image, 'base64')).png().toBuffer();
  const imageBase64 = png.toString('base64');
  console.log(`[cf-image] SUCCESS with ${IMAGE_MODEL} — ${imageBase64.length} base64 chars`);
  return { imageBase64, mimeType: 'image/png' };
}
