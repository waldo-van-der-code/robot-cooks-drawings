import type { Handler } from '@netlify/functions';

export const handler: Handler = async () => {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'NOT_SET';
  const keyPresent = !!(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hfKeyPresent = !!(process.env.HF_API_KEY);

  let supabaseReachable = false;
  let supabaseError = '';
  try {
    const r = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '' },
      signal: AbortSignal.timeout(8000),
    });
    supabaseReachable = true;
    supabaseError = `HTTP ${r.status}`;
  } catch (e) {
    supabaseError = e instanceof Error ? `${e.message} (cause: ${(e as NodeJS.ErrnoException).cause})` : String(e);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      supabaseUrl: url,
      serviceRoleKeyPresent: keyPresent,
      hfApiKeyPresent: hfKeyPresent,
      supabaseReachable,
      supabaseStatus: supabaseError,
      nodeVersion: process.version,
    }),
  };
};
