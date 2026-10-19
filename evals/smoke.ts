// HTTP smoke checks against a running app.
//   npx tsx evals/smoke.ts                                   # http://localhost:3000
//   BASE_URL=https://robot-cooks-drawings.netlify.app npx tsx evals/smoke.ts
//   ... --write   also runs the save check (creates one real drawing in the library)

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const WRITE = process.argv.includes('--write');

type Check = { name: string; run: () => Promise<void> };
const PNG_MAGIC = '89504e47';

async function post(path: string, body: unknown) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path}: HTTP ${res.status}, non-JSON response: ${text.slice(0, 80)}`);
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

let generated: { imageBase64: string } | null = null;

const checks: Check[] = [
  {
    // Regression fix-robot-cooks (2026-10-20): Hugging Face credits ran out, every search returned 500.
    name: 'search returns JSON results',
    run: async () => {
      const data = await post('/api/search', { query: 'drawing', limit: 5 });
      if (!Array.isArray(data.results)) throw new Error('results is not an array');
    },
  },
  {
    // Regression fix-robot-cooks (2026-10-20): Gemini image quota is 0 on the free tier and the
    // Hugging Face fallback had no credits, so generation always failed.
    name: 'generate returns a PNG coloring page',
    run: async () => {
      const data = await post('/api/generate', { prompt: 'a happy cat', preset: 'coloring_book', orientation: 'portrait' });
      const artifact = data.artifact as { kind?: string; imageBase64?: string } | undefined;
      if (artifact?.kind !== 'image' || !artifact.imageBase64) throw new Error('no image artifact');
      const head = Buffer.from(artifact.imageBase64.slice(0, 16), 'base64').toString('hex').slice(0, 8);
      if (head !== PNG_MAGIC) throw new Error(`image is not PNG (magic ${head})`);
      generated = { imageBase64: artifact.imageBase64 };
    },
  },
  ...(WRITE ? [{
    // Regression RCD-002 / fix-robot-cooks: save must answer with JSON and land in the library.
    name: 'save stores the drawing and search finds it',
    run: async () => {
      if (!generated) throw new Error('skipped: generate check failed');
      const title = `smoke test ${new Date().toISOString()}`;
      const saved = await post('/api/save', {
        title, prompt: 'a happy cat', imageBase64: generated.imageBase64, orientation: 'portrait',
      });
      if (typeof saved.id !== 'string') throw new Error('save returned no id');
      const found = await post('/api/search', { query: 'happy cat', limit: 50 });
      const ids = (found.results as { id: string }[]).map(r => r.id);
      if (!ids.includes(saved.id)) throw new Error(`saved drawing ${saved.id} not in search results`);
      console.log(`    saved drawing ${saved.id} ("${title}")`);
    },
  }] : []),
];

(async () => {
  console.log(`Smoke checks against ${BASE_URL}${WRITE ? ' (with --write)' : ''}`);
  let failed = 0;
  for (const check of checks) {
    const start = Date.now();
    try {
      await check.run();
      console.log(`  PASS ${check.name} (${Date.now() - start}ms)`);
    } catch (err) {
      failed++;
      console.log(`  FAIL ${check.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})();
