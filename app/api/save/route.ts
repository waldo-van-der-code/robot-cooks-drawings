import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { extractMetadata } from '@/lib/gemini';
import { generateEmbedding } from '@/lib/embeddings';
import { svgToPdf, svgToThumbnail, imageToPdf, imageToThumbnail } from '@/lib/pdf';
import { uploadFile, BUCKETS } from '@/lib/storage';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SaveRequest } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Netlify kills synchronous functions at 60s and answers with an HTML page, which the
// client cannot parse. Cap the slowest step so the route always returns JSON in time.
const METADATA_TIMEOUT_MS = 25_000;

type Metadata = Awaited<ReturnType<typeof extractMetadata>>;

async function extractMetadataOrFallback(
  params: Parameters<typeof extractMetadata>[0],
  orientation: string,
): Promise<Metadata> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`metadata extraction exceeded ${METADATA_TIMEOUT_MS}ms`)), METADATA_TIMEOUT_MS);
  });
  try {
    return await Promise.race([extractMetadata(params), timeout]);
  } catch (err) {
    console.warn('[POST /api/save] metadata extraction failed, saving without it:', err);
    return {
      depiction_summary: params.prompt,
      tags: [],
      objects: [],
      style: { stroke_style: '', fill_style: '', complexity: '', aesthetic: '' },
      page: { orientation, layout: '', composition: '' },
      raw_model_output: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: SaveRequest = await req.json();
    const { title, prompt, svg, imageBase64, orientation, margin_mm, line_weight_mm } = body;

    if (!title?.trim() || !prompt?.trim()) {
      return NextResponse.json({ error: 'title and prompt are required' }, { status: 400 });
    }
    if (!svg?.trim() && !imageBase64?.trim()) {
      return NextResponse.json({ error: 'svg or imageBase64 is required' }, { status: 400 });
    }

    const drawingId = uuidv4();
    const ownerId = process.env.DEFAULT_OWNER_ID;
    const basePath = `${ownerId}/${drawingId}`;

    const isImageArtifact = Boolean(imageBase64);

    const [pdfBuffer, thumbBuffer, metadata] = await Promise.all([
      isImageArtifact
        ? imageToPdf(imageBase64!, orientation)
        : svgToPdf(svg!, orientation),
      isImageArtifact
        ? imageToThumbnail(imageBase64!, orientation)
        : svgToThumbnail(svg!, orientation),
      extractMetadataOrFallback({ prompt, svg, imageBase64 }, orientation),
    ]);

    const embeddingText = [prompt, metadata.depiction_summary, metadata.tags.join(', ')]
      .filter(Boolean)
      .join('. ');

    // Embed before uploading so a provider failure leaves no orphaned files in storage.
    const embedding = await generateEmbedding(embeddingText);

    // Store source file: PNG for image artifacts, SVG for dots.
    const [sourcePath, pdfPath, thumbPath] = await Promise.all([
      isImageArtifact
        ? uploadFile(BUCKETS.SVG, `${basePath}.png`, Buffer.from(imageBase64!, 'base64'), 'image/png')
        : uploadFile(BUCKETS.SVG, `${basePath}.svg`, svg!, 'image/svg+xml'),
      uploadFile(BUCKETS.PDF,   `${basePath}.pdf`, pdfBuffer,   'application/pdf'),
      uploadFile(BUCKETS.THUMB, `${basePath}.png`, thumbBuffer, 'image/png'),
    ]);

    const supabase = createServerSupabase();

    const { error: drawingError } = await supabase.from('drawings').insert({
      id: drawingId,
      owner_id: ownerId,
      title,
      prompt,
      orientation,
      margin_mm: margin_mm ?? 10,
      line_weight_mm: line_weight_mm ?? 0.3,
      svg_path: sourcePath,
      pdf_path: pdfPath,
      thumb_path: thumbPath,
    });

    if (drawingError) throw new Error(`drawings insert: ${drawingError.message}`);

    const { error: metaError } = await supabase.from('drawing_metadata').insert({
      drawing_id: drawingId,
      depiction_summary: metadata.depiction_summary,
      tags: metadata.tags,
      objects: metadata.objects,
      style: metadata.style,
      page: metadata.page,
      raw_model_output: metadata.raw_model_output,
    });

    if (metaError) throw new Error(`drawing_metadata insert: ${metaError.message}`);

    const vectorLiteral = `[${embedding.join(',')}]`;
    const { error: embError } = await supabase.from('drawing_embeddings').insert({
      drawing_id: drawingId,
      embedding: vectorLiteral,
      embedding_text: embeddingText,
    });

    if (embError) throw new Error(`drawing_embeddings insert: ${embError.message}`);

    return NextResponse.json({ id: drawingId });
  } catch (err) {
    console.error('[POST /api/save]', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
