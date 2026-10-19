'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { readJson } from '@/lib/read-json';
import type { Preset, Orientation, GenerateArtifact } from '@/lib/types';

const PRESETS: { value: Preset; label: string; description: string }[] = [
  { value: 'coloring_book', label: 'Classic Coloring', description: 'Bold outlines, kid-friendly' },
  { value: 'story_sketch',  label: 'Cartoon Story',    description: 'Expressive characters' },
  { value: 'activity_dots', label: 'Magic Dots',       description: 'Connect-the-dots' },
];

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Colors
const C = {
  bg:          '#fdf8f0',
  white:       '#ffffff',
  border:      '#ede9e3',
  borderMid:   '#ccc7bf',
  textHead:    '#1c1916',
  textBody:    '#2e2a27',
  textMid:     '#4a4440',
  textMuted:   '#9e978e',
  orange:      '#f97316',
  orangeLight: 'rgba(249,115,22,0.12)',
};

export default function CreatePage() {
  const [prompt, setPrompt]               = useState('');
  const [preset, setPreset]               = useState<Preset>('coloring_book');
  const [orientation, setOrientation]     = useState<Orientation>('portrait');
  const [lineWeight, setLineWeight]       = useState(0.3);
  const [artifact, setArtifact]           = useState<GenerateArtifact | null>(null);
  const [artifactTitle, setArtifactTitle] = useState('drawing');
  const [lightboxOpen, setLightboxOpen]   = useState(false);
  const [generating, setGenerating]       = useState(false);
  const [saveStatus, setSaveStatus]       = useState<SaveStatus>('idle');
  const [savedId, setSavedId]             = useState<string | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [saveError, setSaveError]         = useState<string | null>(null);
  const [pdfUrl, setPdfUrl]               = useState<string | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);

  /* ── auto-save ─────────────────────────────────────────────────── */
  const autoSave = useCallback(async (
    art: GenerateArtifact, promptText: string, orient: Orientation, weight: number,
  ) => {
    setSaveStatus('saving');
    setSavedId(null);
    try {
      const body: Record<string, unknown> = {
        title: promptText.slice(0, 60),
        prompt: promptText,
        orientation: orient,
        margin_mm: 10,
        line_weight_mm: weight,
      };
      if (art.kind === 'svg') body.svg = art.svg;
      else body.imageBase64 = art.imageBase64;

      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setSavedId(data.id);
      setSaveStatus('saved');
      // Fetch signed PDF URL for the download button
      fetch('/api/drawings/' + data.id)
        .then(r => r.json())
        .then(d => {
          if (d.pdf_path) {
            return fetch('/api/files/signed-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: d.pdf_path, bucket: 'drawings-pdf' }),
            }).then(r => r.json()).then(u => u.url && setPdfUrl(u.url));
          }
        })
        .catch(() => null);
    } catch (err) {
      console.error('[autoSave]', err);
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  /* ── generate ───────────────────────────────────────────────────── */
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) { setError('Please enter a prompt'); return; }
    setError(null);
    setGenerating(true);
    setArtifact(null);
    setSaveStatus('idle');
    setSavedId(null);
    setSaveError(null);
    setPdfUrl(null);
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, preset, orientation, margin_mm: 10, line_weight_mm: lineWeight }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? 'Generation failed');

      const art: GenerateArtifact = data.artifact;
      setArtifact(art);
      setArtifactTitle(prompt.slice(0, 60) || 'drawing');
      autoSave(art, prompt, orientation, lineWeight);
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [prompt, preset, orientation, lineWeight, autoSave]);

  /* ── downloads ──────────────────────────────────────────────────── */
  const downloadSvg = useCallback(() => {
    if (artifact?.kind !== 'svg') return;
    const blob = new Blob([artifact.svg], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `${artifactTitle}.svg` }).click();
    URL.revokeObjectURL(url);
  }, [artifact, artifactTitle]);

  const downloadPng = useCallback(() => {
    if (!artifact) return;
    if (artifact.kind === 'image') {
      const bytes = Uint8Array.from(atob(artifact.imageBase64), c => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: 'image/png' });
      const url   = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `${artifactTitle}.png` }).click();
      URL.revokeObjectURL(url);
      return;
    }
    const portrait = orientation === 'portrait';
    const W = portrait ? 2480 : 3508;
    const H = portrait ? 3508 : 2480;
    const img  = new Image();
    const blob = new Blob([artifact.svg], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      canvas.toBlob(pngBlob => {
        if (!pngBlob) return;
        const pngUrl = URL.createObjectURL(pngBlob);
        Object.assign(document.createElement('a'), { href: pngUrl, download: `${artifactTitle}.png` }).click();
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };
    img.src = url;
  }, [artifact, artifactTitle, orientation]);

  const ar = orientation === 'portrait' ? '210/297' : '297/210';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 font-display text-3xl font-semibold" style={{ color: C.textHead }}>
        Create Drawing
      </h1>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">

        {/* ── LEFT: controls ─────────────────────────────────────────── */}
        <div className="w-full shrink-0 space-y-4 lg:w-80 xl:w-96">

          {/* Prompt */}
          <div>
            <label className="mb-1.5 block text-sm font-bold" style={{ color: C.textHead }}>
              What do you want to draw?
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
              placeholder="e.g. a friendly dragon learning to cook pasta…"
              rows={4}
              className="input w-full resize-none"
            />
          </div>

          {/* Generate */}
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="btn-primary w-full"
          >
            {generating ? <><Spinner /> Generating…</> : '✨ Generate'}
          </button>

          {error && (
            <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          {/* Options card */}
          <div className="card p-5 space-y-5">
            <p className="section-label" style={{ marginBottom: 0 }}>Options</p>

            {/* Style */}
            <div>
              <label className="mb-2 block text-sm font-bold" style={{ color: C.textHead }}>Style</label>
              <div className="flex flex-col gap-2">
                {PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setPreset(p.value)}
                    className="w-full rounded-xl border-2 px-3 py-2.5 text-left transition-all"
                    style={{
                      borderColor: preset === p.value ? C.orange : C.borderMid,
                      background:  preset === p.value ? C.orangeLight : C.white,
                    }}
                  >
                    <span className="block text-sm font-bold" style={{ color: C.textHead }}>{p.label}</span>
                    <span className="block text-xs" style={{ color: C.textMid }}>{p.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Orientation */}
            <div>
              <label className="mb-2 block text-sm font-bold" style={{ color: C.textHead }}>Orientation</label>
              <div className="flex gap-2">
                {(['portrait', 'landscape'] as Orientation[]).map(o => (
                  <button
                    key={o}
                    onClick={() => setOrientation(o)}
                    className="flex-1 rounded-xl border-2 py-2.5 text-sm font-bold capitalize transition-all"
                    style={{
                      borderColor: orientation === o ? C.orange : C.borderMid,
                      background:  orientation === o ? C.orange : C.white,
                      color:       orientation === o ? '#fff' : C.textHead,
                    }}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>

            {/* Line weight */}
            {preset === 'activity_dots' && (
              <div>
                <label className="mb-2 flex items-center justify-between text-sm font-bold" style={{ color: C.textHead }}>
                  <span>Line Weight</span>
                  <span style={{ color: C.orange }}>{lineWeight.toFixed(1)} mm</span>
                </label>
                <input
                  type="range" min={0.1} max={2.0} step={0.1}
                  value={lineWeight}
                  onChange={e => setLineWeight(Number(e.target.value))}
                  className="w-full accent-crayon-orange"
                />
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: preview ─────────────────────────────────────────── */}
        <div ref={previewRef} className="min-w-0 flex-1 scroll-mt-20">
          <div
            className="group relative w-full overflow-hidden"
            style={{
              borderRadius: '1.25rem',
              border: `2px ${artifact ? 'solid' : 'dashed'} ${artifact ? C.borderMid : '#ccc7bf'}`,
              background: C.white,
              boxShadow: artifact ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {/* Placeholder / spinner */}
            {!artifact && (
              <div
                className="flex flex-col items-center gap-4"
                style={{ aspectRatio: ar, justifyContent: generating ? 'flex-start' : 'center', paddingTop: generating ? '2.5rem' : 0 }}
              >
                {generating ? (
                  <div className="flex flex-col items-center gap-4">
                    <RobotDrawingAnimation />
                    <p className="text-base font-medium" style={{ color: C.textMid }}>Generating your drawing…</p>
                  </div>
                ) : (
                  <>
                    <span className="text-5xl" style={{ opacity: 0.25 }} aria-hidden="true">🖼️</span>
                    <p className="text-base" style={{ color: C.textMuted }}>Your drawing will appear here</p>
                  </>
                )}
              </div>
            )}

            {/* Rendered image */}
            {artifact && (
              <>
                <button onClick={() => setLightboxOpen(true)} className="block w-full" aria-label="Open full size">
                  <div style={{ aspectRatio: ar }} className="w-full">
                    {artifact.kind === 'image' ? (
                      <img
                        src={`data:image/png;base64,${artifact.imageBase64}`}
                        alt={artifactTitle}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: artifact.svg }} />
                    )}
                  </div>
                </button>

                {/* Buttons pinned to top of image, always visible */}
                <div className="absolute top-3 left-0 right-0 flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={downloadPng}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold shadow-lg"
                    style={{ background: 'rgba(28,25,22,0.82)', color: '#fff', backdropFilter: 'blur(4px)' }}
                  >
                    <DownloadIcon /> Download as PNG
                  </button>
                  {pdfUrl ? (
                    <a
                      href={pdfUrl}
                      download={`${artifactTitle}.pdf`}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold shadow-lg"
                      style={{ background: 'rgba(249,115,22,0.9)', color: '#fff', backdropFilter: 'blur(4px)' }}
                    >
                      <DownloadIcon /> Download as PDF
                    </a>
                  ) : (
                    <span
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold shadow-lg"
                      style={{ background: 'rgba(249,115,22,0.4)', color: '#fff', backdropFilter: 'blur(4px)', cursor: 'wait' }}
                      title={saveStatus === 'saving' ? 'Preparing PDF…' : 'PDF not ready'}
                    >
                      <DownloadIcon /> Download as PDF{saveStatus === 'saving' ? '…' : ''}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Save status */}
          <div className="mt-3 min-h-[1.5rem]">
            {saveStatus === 'saving' && (
              <p className="flex items-center gap-2 text-sm font-medium" style={{ color: C.textMid }}>
                <Spinner /> Saving to library…
              </p>
            )}
            {saveStatus === 'saved' && savedId && (
              <p className="text-sm font-medium" style={{ color: C.textMid }}>
                Saved ·{' '}
                <Link href={`/drawing/${savedId}`} className="font-bold underline-offset-2 hover:underline" style={{ color: C.orange }}>
                  View in library →
                </Link>
              </p>
            )}
            {saveStatus === 'error' && (
              <p className="text-sm font-medium text-red-600">
                Could not save to library{saveError ? `: ${saveError}` : ''}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Lightbox ───────────────────────────────────────────────── */}
      {lightboxOpen && artifact && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={() => setLightboxOpen(false)}>
          <div
            className="flex shrink-0 items-center justify-between gap-3 px-4 py-3"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex gap-2">
              <ActionButton onClick={downloadPng} icon={<DownloadIcon />} label="Download PNG" />
              {artifact.kind === 'svg' && (
                <ActionButton onClick={downloadSvg} icon={<DownloadIcon />} label="Export SVG" />
              )}
            </div>
            <button
              onClick={() => setLightboxOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              style={{ border: '1px solid rgba(255,255,255,0.2)' }}
            >
              ✕ Close
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-6" onClick={e => e.stopPropagation()}>
            <div
              style={{ aspectRatio: ar, maxHeight: '100%', maxWidth: '100%' }}
              className="overflow-hidden rounded-xl shadow-2xl"
            >
              {artifact.kind === 'image' ? (
                <img src={`data:image/png;base64,${artifact.imageBase64}`} alt={artifactTitle} className="h-full w-full object-contain" />
              ) : (
                <div dangerouslySetInnerHTML={{ __html: artifact.svg }} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-black/90"
      style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.7)' }}
    >
      {icon}{label}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 4v11" />
    </svg>
  );
}

function RobotDrawingAnimation() {
  return (
    <svg
      width="140"
      height="140"
      viewBox="0 0 140 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Robot drawing"
    >
      <style>{`
        @keyframes arm-draw {
          0%   { transform: rotate(-18deg); }
          50%  { transform: rotate(18deg); }
          100% { transform: rotate(-18deg); }
        }
        @keyframes eye-blink {
          0%, 90%, 100% { transform: scaleY(1); }
          95%            { transform: scaleY(0.1); }
        }
        @keyframes pencil-line {
          0%   { stroke-dashoffset: 60; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes page-float {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-3px); }
        }
        @keyframes antenna-pulse {
          0%, 100% { r: 3; }
          50%       { r: 4.5; }
        }
        .robot-arm {
          transform-origin: 98px 82px;
          animation: arm-draw 1.1s ease-in-out infinite;
        }
        .robot-eye {
          transform-origin: center;
          animation: eye-blink 3.2s ease-in-out infinite;
        }
        .robot-eye-r {
          transform-origin: center;
          animation: eye-blink 3.2s ease-in-out infinite;
          animation-delay: 0.15s;
        }
        .drawing-line {
          stroke-dasharray: 60;
          animation: pencil-line 1.1s ease-in-out infinite;
        }
        .page-group {
          animation: page-float 2.4s ease-in-out infinite;
        }
        .antenna-dot {
          animation: antenna-pulse 1.1s ease-in-out infinite;
        }
      `}</style>

      {/* Page being drawn on */}
      <g className="page-group">
        <rect x="20" y="52" width="58" height="72" rx="4" fill="white" stroke="#ccc7bf" strokeWidth="2"/>
        {/* Scribble lines on the page */}
        <path className="drawing-line" d="M30 72 Q45 65 60 72" stroke="#f97316" strokeWidth="2" strokeLinecap="round" fill="none"/>
        <path d="M30 84 Q50 79 65 84" stroke="#ccc7bf" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        <path d="M30 96 Q48 91 62 96" stroke="#ccc7bf" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        {/* Little smiley being drawn */}
        <circle cx="47" cy="110" r="8" stroke="#f97316" strokeWidth="1.5" fill="none" strokeDasharray="4 50" strokeDashoffset="-3"/>
        <circle cx="44" cy="108" r="1.2" fill="#f97316"/>
        <circle cx="50" cy="108" r="1.2" fill="#f97316"/>
        <path d="M44 112 Q47 115 50 112" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      </g>

      {/* Robot body */}
      <rect x="62" y="72" width="54" height="46" rx="8" fill="#f5f3ee" stroke="#ccc7bf" strokeWidth="2"/>

      {/* Robot head */}
      <rect x="66" y="44" width="46" height="36" rx="10" fill="#f5f3ee" stroke="#ccc7bf" strokeWidth="2"/>

      {/* Antenna */}
      <line x1="89" y1="44" x2="89" y2="32" stroke="#ccc7bf" strokeWidth="2" strokeLinecap="round"/>
      <circle className="antenna-dot" cx="89" cy="29" r="3" fill="#f97316"/>

      {/* Eyes */}
      <g className="robot-eye">
        <rect x="72" y="52" width="12" height="10" rx="3" fill="#f97316" opacity="0.15"/>
        <rect x="74" y="54" width="8" height="6" rx="2" fill="#f97316"/>
      </g>
      <g className="robot-eye-r">
        <rect x="94" y="52" width="12" height="10" rx="3" fill="#f97316" opacity="0.15"/>
        <rect x="96" y="54" width="8" height="6" rx="2" fill="#f97316"/>
      </g>

      {/* Mouth */}
      <path d="M79 70 Q89 76 99 70" stroke="#ccc7bf" strokeWidth="2" strokeLinecap="round" fill="none"/>

      {/* Chest detail */}
      <rect x="74" y="82" width="30" height="18" rx="4" fill="white" stroke="#ede9e3" strokeWidth="1.5"/>
      <circle cx="82" cy="91" r="3" fill="#f97316" opacity="0.6"/>
      <circle cx="89" cy="91" r="3" fill="#facc15" opacity="0.7"/>
      <circle cx="96" cy="91" r="3" fill="#22c55e" opacity="0.6"/>

      {/* Left arm (static) */}
      <rect x="50" y="76" width="14" height="8" rx="4" fill="#f5f3ee" stroke="#ccc7bf" strokeWidth="2"/>

      {/* Right arm (animated — holding pencil) */}
      <g className="robot-arm">
        <rect x="114" y="76" width="14" height="8" rx="4" fill="#f5f3ee" stroke="#ccc7bf" strokeWidth="2"/>
        {/* Pencil */}
        <g transform="translate(126, 78)">
          <rect x="0" y="-2" width="18" height="5" rx="2" fill="#facc15" stroke="#ccc7bf" strokeWidth="1.2"/>
          <polygon points="18,-2 18,3 24,0.5" fill="#f5f3ee" stroke="#ccc7bf" strokeWidth="1"/>
          <line x1="24" y1="0.5" x2="26" y2="0.5" stroke="#2e2a27" strokeWidth="1.5" strokeLinecap="round"/>
        </g>
      </g>

      {/* Feet */}
      <rect x="72" y="116" width="16" height="8" rx="4" fill="#f5f3ee" stroke="#ccc7bf" strokeWidth="2"/>
      <rect x="90" y="116" width="16" height="8" rx="4" fill="#f5f3ee" stroke="#ccc7bf" strokeWidth="2"/>
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
