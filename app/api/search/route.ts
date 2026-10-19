import { NextRequest, NextResponse } from 'next/server';
import { embedQuery } from '@/lib/embeddings';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SearchRequest, DrawingResult } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body: SearchRequest = await req.json();
    const { query, limit = 20, offset = 0, tags, orientation } = body;

    if (!query?.trim()) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const supabase = createServerSupabase();

    // If the embedding provider is down, still show the library via the table scan below.
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await embedQuery(query);
    } catch (err) {
      console.error('[search] embedding failed — falling back to direct table scan', err);
    }

    let rows: Record<string, unknown>[] = [];

    if (queryEmbedding) {
      const { data, error } = await supabase.rpc('match_drawings', {
        query_embedding: `[${queryEmbedding.join(',')}]`,
        match_count: limit,
        match_offset: offset,
        filter_tags: tags ?? null,
        filter_orientation: orientation ?? null,
      });

      if (error) throw new Error(`search RPC error: ${error.message}`);
      rows = data ?? [];
    }

    // IVFFLAT index requires lists=100 minimum rows — returns empty with small datasets.
    // Fall back to a direct table scan when the RPC returns nothing.

    if (rows.length === 0) {
      console.warn('[search] RPC returned 0 results — falling back to direct table scan');
      let q = supabase
        .from('drawings')
        .select(`
          id, title, prompt, orientation, margin_mm, line_weight_mm,
          svg_path, pdf_path, thumb_path, created_at, updated_at,
          drawing_metadata (
            drawing_id, depiction_summary, tags, objects, style, page
          )
        `)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (orientation) q = q.eq('orientation', orientation);

      const { data: fallbackData, error: fallbackError } = await q;
      if (fallbackError) throw new Error(`fallback scan error: ${fallbackError.message}`);

      rows = (fallbackData ?? []).flatMap((row: Record<string, unknown>) => {
        const dm = Array.isArray(row.drawing_metadata)
          ? (row.drawing_metadata as Record<string, unknown>[])[0]
          : row.drawing_metadata as Record<string, unknown> | null;

        // Apply tag filter client-side if needed
        if (tags && tags.length > 0 && dm) {
          const rowTags = (dm.tags as string[]) ?? [];
          if (!tags.every(t => rowTags.includes(t))) return [];
        }

        return [{
          ...row,
          drawing_metadata: undefined,
          similarity: undefined,
          metadata: dm ? {
            drawing_id:         dm.drawing_id,
            depiction_summary:  dm.depiction_summary,
            tags:               dm.tags,
            objects:            dm.objects,
            style:              dm.style,
            page:               dm.page,
          } : null,
        }];
      });
    }

    const results: DrawingResult[] = rows.map((row: Record<string, unknown>) => ({
      id:             row.id as string,
      title:          row.title as string,
      prompt:         row.prompt as string,
      orientation:    row.orientation as DrawingResult['orientation'],
      margin_mm:      row.margin_mm as number,
      line_weight_mm: row.line_weight_mm as number,
      svg_path:       row.svg_path as string,
      pdf_path:       row.pdf_path as string,
      thumb_path:     row.thumb_path as string | null,
      created_at:     row.created_at as string,
      updated_at:     row.updated_at as string,
      similarity:     row.similarity as number | undefined,
      metadata:       row.metadata as DrawingResult['metadata'],
    }));

    return NextResponse.json({ results, total: results.length });
  } catch (err) {
    console.error('[POST /api/search]', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
