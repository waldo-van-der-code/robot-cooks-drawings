'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { readJson } from '@/lib/read-json';
import type { DrawingResult, Orientation } from '@/lib/types';

const PAGE_SIZE = 18;

const C = {
  textHead:  '#1c1916',
  textBody:  '#2e2a27',
  textMid:   '#4a4440',
  textMuted: '#9e978e',
  border:    '#ede9e3',
  borderMid: '#ccc7bf',
  surface:   '#f7f5f2',
  white:     '#ffffff',
  orange:    '#f97316',
};

export default function LibraryPage() {
  const [query, setQuery]             = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [orientation, setOrientation] = useState<Orientation | ''>('');
  const [tagFilter, setTagFilter]     = useState('');
  const [results, setResults]         = useState<DrawingResult[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [offset, setOffset]           = useState(0);
  const [hasMore, setHasMore]         = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (newOffset = 0, append = false) => {
    setLoading(true);
    if (!append) setError(null);
    try {
      const tags = tagFilter.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: submittedQuery.trim() || 'drawing',
          limit: PAGE_SIZE,
          offset: newOffset,
          tags: tags.length > 0 ? tags : undefined,
          orientation: orientation || undefined,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? 'Search failed');
      setResults(prev => append ? [...prev, ...data.results] : data.results);
      setHasMore(data.results.length === PAGE_SIZE);
      setOffset(newOffset + data.results.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      if (!append) setResults([]);
    } finally {
      setLoading(false);
    }
  }, [submittedQuery, orientation, tagFilter]);

  useEffect(() => {
    search(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedQuery, orientation, tagFilter]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(query);
  };

  const orientationOptions: { value: Orientation | ''; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'portrait', label: 'Portrait' },
    { value: 'landscape', label: 'Landscape' },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">

      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <h1 className="mb-4 font-display text-4xl font-semibold" style={{ color: C.textHead }}>
            Library
          </h1>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search drawings…"
              className="input flex-1"
            />
            <button type="submit" className="btn-primary" disabled={loading}>
              Search
            </button>
          </form>
        </div>
        <Link href="/create" className="btn-secondary shrink-0">
          + New Drawing
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-3">
        {/* Orientation pills */}
        <div className="flex gap-1 rounded-xl p-1" style={{ border: `2px solid ${C.border}`, background: C.white }}>
          {orientationOptions.map(o => (
            <button
              key={o.value}
              onClick={() => setOrientation(o.value)}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold transition-all"
              style={{
                background: orientation === o.value ? C.orange : 'transparent',
                color:      orientation === o.value ? '#fff' : C.textMid,
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={tagFilter}
          onChange={e => setTagFilter(e.target.value)}
          placeholder="Filter by tags (comma-separated)"
          className="input w-64"
        />
      </div>

      {/* Error state */}
      {error && (
        <div className="card mb-6 p-6 text-center">
          <p className="text-4xl mb-3" aria-hidden="true">😕</p>
          <p className="text-lg font-bold mb-1" style={{ color: C.textHead }}>Couldn&apos;t load drawings</p>
          <p className="text-sm mb-4" style={{ color: C.textMid }}>{error}</p>
          <button onClick={() => search(0, false)} className="btn-secondary">Try again</button>
        </div>
      )}

      {/* Empty state */}
      {!error && results.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-center">
          <span className="text-6xl" aria-hidden="true">🎨</span>
          <p className="text-xl font-bold" style={{ color: C.textHead }}>
            {submittedQuery ? 'No results found' : 'No drawings yet'}
          </p>
          <p className="text-base max-w-sm" style={{ color: C.textMid }}>
            {submittedQuery
              ? 'Try different keywords or clear your search'
              : 'Create your first drawing and it will show up here'}
          </p>
          {!submittedQuery && (
            <Link href="/create" className="btn-primary mt-2">
              Create your first drawing
            </Link>
          )}
        </div>
      )}

      {/* Grid */}
      {(results.length > 0 || loading) && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {results.map(drawing => (
              <DrawingCard key={drawing.id} drawing={drawing} />
            ))}
            {loading && Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[210/297] animate-pulse rounded-xl" style={{ background: C.border }} />
            ))}
          </div>

          {hasMore && !loading && (
            <div className="mt-8 flex justify-center">
              <button onClick={() => search(offset, true)} className="btn-secondary">
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DrawingCard({ drawing }: { drawing: DrawingResult }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!drawing.thumb_path) return;
    fetch('/api/files/signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: drawing.thumb_path, bucket: 'drawings-thumb' }),
    })
      .then(r => r.json())
      .then(d => d.url && setThumbUrl(d.url))
      .catch(() => null);
  }, [drawing.thumb_path]);

  return (
    <Link
      href={`/drawing/${drawing.id}`}
      className="group block overflow-hidden rounded-xl transition-all hover:-translate-y-0.5"
      style={{ border: '2px solid #ede9e3', background: '#ffffff', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
      onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = '#f97316'; (e.currentTarget as HTMLElement).style.boxShadow = '3px 3px 0 rgba(249,115,22,0.25)'; }}
      onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = '#ede9e3'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; }}
    >
      <div
        className="relative overflow-hidden"
        style={{ background: '#f7f5f2', aspectRatio: drawing.orientation === 'portrait' ? '210/297' : '297/210' }}
      >
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt={drawing.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-3xl" style={{ opacity: 0.2 }} aria-hidden="true">🖼️</span>
          </div>
        )}
      </div>

      <div className="p-3">
        <p className="truncate text-sm font-bold" style={{ color: '#1c1916' }}>{drawing.title}</p>
        {drawing.metadata?.tags && drawing.metadata.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {drawing.metadata.tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: 'rgba(250,204,21,0.25)', color: '#2e2a27' }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
