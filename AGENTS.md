# robot-cooks-drawings

Existing independent personal repository. Inspect its current README and package scripts before work; do not infer deployment authorization.


## Shared Claude–Codex workflow (2026-09-14)

This AGENTS.md is canonical. Claude imports it; do not maintain a second rule copy.
Before work in an independent personal repository, read the workspace AGENTS.md at
`/Users/waldo.vanderhaeghen/Documents/AI-projects-personal/AGENTS.md` if not already loaded.
Also read any intervening area AGENTS.md files relevant to this project. Project rules specialize
workspace rules; documented workspace protection rules remain in force.

For a continuing task, use the shared handoff/resume skills. Maintain `.agent-state/tasks/<task-id>.md`
at the checkout root, outside todos. Record objective, existing ticket, decisions, changed files,
verification results, pending external actions and next step at meaningful milestones.
Only one agent may edit a checkout at a time: stop the outgoing agent and its workers before taking
over. Check the actual diff and branch; never repeat an uncertain external action without checking
its result. An ownership marker is coordination, not a lock enforced on every process.
Neither handover nor a saved checkpoint authorizes new sends, deployments or purchases.
Service access and account routing: `Organization/agent-setup/access.md` under the workspace root.

## Stack facts (2026-10-20)

- Live: https://robot-cooks-drawings.netlify.app. Netlify auto-deploys from GitHub `main`.
- Database and storage: self-hosted Supabase on oracle (`https://supabase.vanderlore.de`, `~/supabase/docker`). The local `.env.local` still points at the old Supabase cloud project, so take keys from oracle's `.env` when testing locally.
- AI providers: Gemini (`GEMINI_API_KEY`, free tier) for SVG and metadata. The free tier has **0 image quota**, so images come from the fallback, Cloudflare Workers AI FLUX schnell. Embeddings use Workers AI `@cf/baai/bge-small-en-v1.5` (384-dim). Netlify env: `CF_ACCOUNT_ID`, `CF_AI_TOKEN` (token "robot-cooks-drawings workers-ai", Workers AI Read; Keychain `cf-workers-ai-robot-cooks`). Hugging Face was removed after its free credits ran out.
- Magic Dots is the only preset that asks a text model for SVG code; the other presets are FLUX pictures, converted to grayscale with stretched levels so they print as black lines on white (RCD-003).
- Free-tier limits (checked 2026-10-21): `gemini-3-flash` allows **20 requests per day** per project (resets 09:00 Berlin), shared by Magic Dots and save-time metadata. Gemini 3 needs `thinkingLevel: 'low'` and 2.5 Flash `thinkingBudget: 0`, or an SVG takes 45+ s and Netlify cuts it off at 30 s. Any 429 moves the waterfall to the next model. The Groq fallback (`openai/gpt-oss-120b`, env `groq_api_key` in lowercase) is capped at 8,000 tokens per minute, which is about one Magic Dots request per minute. Its drawings are weaker than Gemini's, so it stays last. If Gemini billing is ever enabled, the Pro models at the top of `CANDIDATE_MODELS` will answer first and may exceed 30 s: time Magic Dots again then.
- `next dev` fails from this path: webpack rejects the `!` in `Fun!`. Run it from a copy without `!` (rsync the tree, including node_modules).
- Evals: `BASE_URL=<url> npx tsx evals/smoke.ts [--write]`. `--write` saves one real drawing into the library.
