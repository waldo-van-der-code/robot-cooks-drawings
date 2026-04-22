# Robot Cooks Drawings

AI-powered A4 coloring page generator for kids. Describe what you want, get a printable SVG/PDF drawing — styled for kids to color in.

## What it does

- **Generate** — Describe a scene, pick a style (coloring book, cartoon story, connect-the-dots), and Gemini generates a clean A4 SVG drawing
- **Save** — SVG is converted to PDF + thumbnail, metadata is extracted, and everything is stored in Supabase
- **Browse** — Library with semantic search, tag filters, and orientation filters
- **Print** — Download the PDF and hand it to a kid

---

## Stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 14 (App Router) |
| Hosting | Netlify |
| Database | Supabase (Postgres + pgvector) |
| Storage | Supabase Storage |
| AI generation | Google Gemini API |
| Embeddings | Hugging Face (`BAAI/bge-small-en-v1.5`, 384-dim) |
| PDF generation | Puppeteer + `@sparticuz/chromium` |
| Styling | Tailwind CSS |
| Package manager | pnpm |

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

| Variable | Where to get it | Client-safe? |
|---|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) | **Never** |
| `HF_API_KEY` | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) | **Never** |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **Never** |
| `DEFAULT_OWNER_ID` | Any UUID (single-user mode) | No |

---

## Supabase Setup

### 1. Create a project at [supabase.com](https://supabase.com)

### 2. Run migrations in order via the SQL Editor

```
supabase/migrations/20260228000100_enable_extensions.sql
supabase/migrations/20260228000200_create_tables.sql
supabase/migrations/20260228000300_create_search_function.sql
supabase/migrations/20260228000400_create_storage_buckets.sql
supabase/migrations/20260228000500_resize_embedding_vector.sql
supabase/migrations/20260301000600_fix_search_index.sql
```

> **Note:** Migrations 500 and 600 can be combined into one query — see the combined script in [migration notes](#migration-notes) below.

### 3. Verify storage buckets

Supabase → Storage should show three buckets: `drawings-svg`, `drawings-pdf`, `drawings-thumb`. If they weren't auto-created by the migration, create them manually with **Public: off**.

---

## Local Development

**Prerequisites:** Node.js 20+, pnpm, Google Chrome (for PDF generation on macOS)

```bash
pnpm install
cp .env.example .env.local   # fill in values
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Netlify Deployment

1. Push to GitHub
2. Import project at [app.netlify.com](https://app.netlify.com) — build settings auto-detected from `netlify.toml`
3. Add all env variables in Netlify → Site → Environment variables
4. Deploy

---

## Architecture

### Save pipeline (`/api/save`)

1. Puppeteer renders SVG → PDF at A4 dimensions
2. Puppeteer renders SVG → PNG thumbnail
3. Gemini extracts structured metadata (tags, objects, style, scene summary)
4. Hugging Face embeds the metadata text → 384-dim vector
5. SVG, PDF, thumbnail uploaded to Supabase Storage
6. `drawings`, `drawing_metadata`, `drawing_embeddings` rows inserted

### Semantic search (`/api/search`)

- Query is embedded with the same HF model (384-dim)
- `match_drawings` SQL function does cosine similarity search via pgvector HNSW index
- Falls back to direct table scan if vector search returns empty (useful for small datasets)

### Security

- `GEMINI_API_KEY` and `HF_API_KEY` are server-only — never in client bundles
- `SUPABASE_SERVICE_ROLE_KEY` only used server-side in `lib/supabase/server.ts`
- File downloads use short-lived signed URLs generated server-side

---

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── generate/route.ts          # POST: generate SVG via Gemini
│   │   ├── save/route.ts              # POST: full save pipeline
│   │   ├── search/route.ts            # POST: semantic search
│   │   ├── drawings/[id]/route.ts     # GET: drawing detail
│   │   ├── drawings/[id]/similar/     # POST: find similar drawings
│   │   └── files/signed-url/          # POST: signed storage URL
│   ├── create/page.tsx                # /create
│   ├── library/page.tsx               # /library
│   ├── drawing/[id]/page.tsx          # /drawing/[id]
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── gemini.ts                      # SVG generation + metadata extraction
│   ├── embeddings.ts                  # HF embeddings (384-dim)
│   ├── pdf.ts                         # Puppeteer SVG→PDF + thumbnail
│   ├── storage.ts                     # Supabase Storage helpers
│   ├── svg-normalize.ts               # Post-generation SVG cleanup
│   ├── types.ts                       # Shared TypeScript types
│   └── supabase/
│       ├── client.ts                  # Client-side (anon key)
│       └── server.ts                  # Server-side (service role)
├── supabase/migrations/               # SQL migrations — run in filename order
├── .env.example
├── netlify.toml
└── tailwind.config.ts
```

---

## Migration Notes

Migrations 500 + 600 can be run as one combined query (drops IVFFLAT, resizes to 384-dim, creates HNSW index, recreates `match_drawings` function):

```sql
-- Drop old IVFFLAT index
DROP INDEX IF EXISTS drawing_embeddings_ivfflat_idx;

-- Resize column to 384-dim (matches BAAI/bge-small-en-v1.5)
ALTER TABLE drawing_embeddings
  ALTER COLUMN embedding TYPE vector(384);

-- Create HNSW index (works at any dataset size, unlike IVFFLAT which needs 100+ rows)
CREATE INDEX IF NOT EXISTS drawing_embeddings_hnsw_idx
  ON drawing_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Recreate match_drawings with vector(384) signature
DROP FUNCTION IF EXISTS match_drawings(vector, int, int, text[], text);

CREATE OR REPLACE FUNCTION match_drawings(
  query_embedding    vector(384),
  match_count        int     DEFAULT 20,
  match_offset       int     DEFAULT 0,
  filter_tags        text[]  DEFAULT NULL,
  filter_orientation text    DEFAULT NULL
)
RETURNS TABLE (
  id uuid, title text, prompt text, orientation text,
  margin_mm int, line_weight_mm numeric,
  svg_path text, pdf_path text, thumb_path text,
  created_at timestamptz, updated_at timestamptz,
  similarity float, metadata jsonb
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT d.id, d.title, d.prompt, d.orientation, d.margin_mm, d.line_weight_mm,
         d.svg_path, d.pdf_path, d.thumb_path, d.created_at, d.updated_at,
         1 - (de.embedding <=> query_embedding) AS similarity,
         jsonb_build_object(
           'drawing_id', dm.drawing_id, 'depiction_summary', dm.depiction_summary,
           'tags', dm.tags, 'objects', dm.objects, 'style', dm.style, 'page', dm.page
         ) AS metadata
  FROM drawings d
  INNER JOIN drawing_embeddings de ON de.drawing_id = d.id
  LEFT JOIN drawing_metadata dm ON dm.drawing_id = d.id
  WHERE (filter_tags IS NULL OR dm.tags @> filter_tags)
    AND (filter_orientation IS NULL OR d.orientation = filter_orientation)
  ORDER BY de.embedding <=> query_embedding
  LIMIT match_count OFFSET match_offset;
END;
$$;
```
