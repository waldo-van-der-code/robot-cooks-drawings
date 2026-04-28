// SERVER-SIDE ONLY — never import in client components
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type GenerateContentRequest,
} from '@google/generative-ai';
import type { Orientation, Preset, DrawingMetadata } from './types';
import { normalizeSVG, hasOpenPaths } from './svg-normalize';
import { generateWithGroq, isGroqAvailable } from './groq';
import { generateImageWithHf, isHfImageAvailable } from './hf-image';

// Image generation models — ranked best→worst for coloring page illustration quality.
const IMAGE_CANDIDATE_MODELS = [
  'gemini-3-pro-image-preview',     // Best illustration quality
  'gemini-3.1-flash-image-preview', // Fast fallback
  'gemini-2.5-flash-image',         // Stable fallback
];

// Text generation models ranked best→worst for SVG generation (activity_dots).
const CANDIDATE_MODELS = [
  'gemini-3.1-pro-preview',   // Latest flagship — best instruction following + long output
  'gemini-3-pro-preview',     // Gemini 3 Pro stable preview
  'gemini-2.5-pro',           // Stable 2.5 Pro — excellent SVG/structured output (before Flash)
  'gemini-3-flash-preview',   // Gemini 3 Flash — fast fallback
  'gemini-2.5-flash',         // 2.5 Flash — fast, good quality
  'gemini-2.0-flash',         // 2.0 Flash — reliable fallback
  'gemini-2.0-flash-lite',    // Lightweight fallback
  'gemini-pro-latest',        // Alias fallback
];

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  return key;
}

function getClient() {
  return new GoogleGenerativeAI(getApiKey());
}

let _availableModels: string[] | null = null;

async function getAvailableModels(): Promise<string[]> {
  if (_availableModels) return _availableModels;

  const key = getApiKey();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`
  );
  if (!res.ok) {
    console.warn('[gemini] ListModels failed, will try candidates in order');
    return CANDIDATE_MODELS;
  }

  const data = await res.json() as { models: { name: string; supportedGenerationMethods?: string[] }[] };
  _availableModels = (data.models ?? [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace('models/', ''));

  console.log('[gemini] Available models:', _availableModels.join(', '));
  return _availableModels;
}

async function generateWithFallback(
  label: string,
  buildRequest: () => GenerateContentRequest
): Promise<string> {
  const available = await getAvailableModels();
  const client = getClient();

  const toTry = CANDIDATE_MODELS.filter(c => available.includes(c));
  if (toTry.length === 0) toTry.push(...CANDIDATE_MODELS);

  const request = buildRequest();

  // Log the full request so you can see exactly what is sent
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[gemini:${label}] REQUEST`);
  if (request.systemInstruction) {
    console.log('[gemini] systemInstruction:\n', typeof request.systemInstruction === 'string'
      ? request.systemInstruction
      : JSON.stringify(request.systemInstruction, null, 2));
  }
  if (Array.isArray(request.contents)) {
    for (const c of request.contents) {
      console.log(`[gemini] content role=${c.role}:`);
      for (const p of (c.parts ?? [])) {
        if ('text' in p) console.log(String(p.text).slice(0, 1200) + (String(p.text).length > 1200 ? '\n…(truncated)' : ''));
      }
    }
  }
  console.log('[gemini] generationConfig:', JSON.stringify(request.generationConfig));
  console.log('─'.repeat(60));

  let lastError: unknown;
  for (const modelName of toTry) {
    try {
      console.log(`[gemini:${label}] Trying model: ${modelName}`);
      const model = client.getGenerativeModel({ model: modelName, safetySettings: SAFETY_SETTINGS });
      const result = await model.generateContent(request);
      const text = result.response.text().trim();
      console.log(`[gemini:${label}] SUCCESS with ${modelName} — output length: ${text.length} chars`);
      console.log(`[gemini:${label}] Output preview:\n${text.slice(0, 400)}${text.length > 400 ? '\n…' : ''}`);
      console.log('─'.repeat(60) + '\n');
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetriable = msg.includes('404') || msg.includes('503') || (msg.includes('429') && msg.includes('limit: 0'));
      if (isRetriable) {
        console.warn(`[gemini:${label}] Model ${modelName} unavailable, trying next. Reason: ${msg.slice(0, 150)}`);
        lastError = err;
        continue;
      }
      console.error(`[gemini:${label}] Non-retriable error from ${modelName}: ${msg}`);
      throw err;
    }
  }
  throw new Error(`All Gemini models failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

const PRESET_STYLE_HINTS: Record<Preset, string> = {
  coloring_book: `professional kids coloring book page (think published Scholastic/Dover coloring book):
- CARTOON ILLUSTRATION style — expressive characters, full background scene with trees/ground/sky/props
- Characters drawn with ORGANIC BEZIER CURVES: smooth rounded bodies, expressive faces, chubby limbs
- DO NOT build characters from geometric primitives (no ellipse heads, no rectangle torsos, no circle eyes alone) — use <path> contours
- Bold closed outlines: stroke-width="1.5" stroke="#000000" fill="none", paths end with Z
- Interior detail lines: stroke-width="0.8" stroke="#000000" fill="none"
- stroke-linecap="round" stroke-linejoin="round" throughout
- Include a rich background: ground, sky hints, foliage, props — at least 3 background elements
- Large colorable regions (minimum 10mm across) — easy for children with crayons
- No shading, no hatching, no gradients, no colour fills`,

  story_sketch: `expressive kids cartoon storybook illustration (think classic picture-book line art):
- CARTOON ILLUSTRATION style — lively characters with personality, interesting background scene
- Characters drawn with ORGANIC BEZIER CURVES: smooth rounded bodies, expressive faces, chubby limbs
- DO NOT build characters from geometric primitives — use flowing <path> contours for faces and bodies
- Primary outlines: stroke-width="1.5" stroke="#000000" fill="none", closed paths end with Z
- Interior details: stroke-width="0.8" stroke="#000000" fill="none"
- stroke-linecap="round" stroke-linejoin="round" throughout
- Include a visible background scene with ground, environment, props
- No shading, no fills beyond white background`,

  activity_dots: `connect-the-dots activity page:
- Primary subject is only dots and numbers, no continuous outline of the subject
- Place 20 to 30 dots: <circle r="2" fill="#000" stroke="none"/> along the subject contour
- Add sequential labels 1..N using <text> with font-family="monospace" font-size="4" fill="#333"
- Place each number offset by 3 units from its dot center, avoid overlaps
- Background scene elements optional: stroke="#cccccc" stroke-width="0.4" fill="none"
- Subject must rest on a visible ground baseline, no floating elements`,
};

const A4_DIMENSIONS: Record<Orientation, { w: string; h: string; vw: number; vh: number }> = {
  portrait:  { w: '210mm', h: '297mm', vw: 210, vh: 297 },
  landscape: { w: '297mm', h: '210mm', vw: 297, vh: 210 },
};

function buildKidFriendlyPrompt(userInput: string, preset: Preset, orientation: Orientation): string {
  const dim = A4_DIMENSIONS[orientation];
  return `Draw a ${preset === 'activity_dots' ? 'connect-the-dots activity page' : 'professional kids coloring book page'} of: ${userInput}

Style: ${PRESET_STYLE_HINTS[preset]}

Hard constraints:
- Canvas: width="${dim.w}" height="${dim.h}" viewBox="0 0 ${dim.vw} ${dim.vh}"
- 1 user unit = 1mm
- GROUNDING: every character/object physically touches a surface — no floating elements
- ORGANIC PATHS: character faces, bodies, ears, paws must use smooth cubic Bezier <path> elements (C/Q commands) — NOT raw <circle> or <ellipse> for body parts
- At least 70% of outline elements must be <path> elements with curve commands (C, Q, S, T)
- SCENE: include a full background — ground plane, sky/environment, at least 3 supporting scene elements (trees, grass, clouds, buildings, furniture, etc.)
- Allowed elements: <svg> <g> <defs> <path> <circle> <rect> <polygon> <text> <use> <symbol>
- Forbidden: <line> <polyline> <ellipse> <image> <linearGradient> <radialGradient>
- No adult content, violence, or scary imagery`;
}

function assessSvgQuality(svg: string): { pass: boolean; reason: string } {
  const pathCount = (svg.match(/<path\b/gi) ?? []).length;
  const ellipseCount = (svg.match(/<ellipse\b/gi) ?? []).length;
  const circleCount = (svg.match(/<circle\b/gi) ?? []).length;
  const rectCount = (svg.match(/<rect\b/gi) ?? []).length;

  // Background rect doesn't count as a primitive — subtract 1 for it.
  const primitiveDominated = rectCount + ellipseCount > pathCount;
  const tooFewPaths = pathCount < 10;
  // Bare circles/ellipses dominating strongly indicates stick-figure output.
  const excessivePrimitives = ellipseCount >= 3 || (circleCount > 8 && pathCount < 8);

  if (tooFewPaths) {
    return { pass: false, reason: `too few paths (${pathCount})` };
  }
  if (primitiveDominated) {
    return { pass: false, reason: `primitives dominate (ellipse=${ellipseCount} rect=${rectCount} vs path=${pathCount})` };
  }
  if (excessivePrimitives) {
    return { pass: false, reason: `excessive primitives (ellipse=${ellipseCount} circle=${circleCount} path=${pathCount})` };
  }
  return { pass: true, reason: `path=${pathCount} ellipse=${ellipseCount} circle=${circleCount}` };
}

function buildSvgSystemInstruction(
  dim: { w: string; h: string; vw: number; vh: number },
  m: number,
): string {
  const drawX = m, drawY = m;
  const drawW = dim.vw - m * 2;
  const drawH = dim.vh - m * 2;
  return `You are a professional children's book illustrator creating high-quality A4 coloring pages in the style of published Scholastic or Dover kids coloring books.

OUTPUT RULES — follow exactly:
1. Output ONLY the raw SVG element. No markdown fences, no prose, no XML comments outside the SVG.
2. Start your response with <svg and end with </svg>. Nothing before or after.
3. The SVG must be valid, well-formed XML.
4. Do NOT emit any <style> blocks. Use inline SVG attributes only.

CANVAS:
- width="${dim.w}" height="${dim.h}" viewBox="0 0 ${dim.vw} ${dim.vh}"
- White background: <rect width="${dim.vw}" height="${dim.vh}" fill="white" stroke="none"/>
- Safe drawing area: x=${drawX} y=${drawY} width=${drawW} height=${drawH} (${m}mm margin)
- All elements must stay within the safe area

ILLUSTRATION QUALITY — this is critical:
- Draw CARTOON CHARACTERS with organic, hand-drawn-looking Bezier curves — smooth rounded bodies, chubby paws, expressive faces
- DO NOT construct characters from raw geometric primitives (no <ellipse> heads, no <rect> torsos, no plain <circle> eyes as the sole face elements)
- Character outlines, faces, ears, bodies, and limbs MUST use <path> elements with cubic or quadratic Bezier curves (C, Q, S commands)
- Faces must have personality: curved smile path, curved brow paths, pupils as small filled circles inside larger eye-outline paths
- Include a FULL BACKGROUND SCENE: ground plane with texture, sky or environment, foliage/trees/buildings/water as appropriate — minimum 3 distinct background elements
- Fill the entire canvas — no large empty white regions

STROKE RULES:
- Primary character outlines: stroke-width="1.5" stroke="#000000" fill="none"
- Interior details (fur lines, face features, clothing folds): stroke-width="0.8" stroke="#000000" fill="none"
- Background scene elements: stroke-width="1.2" stroke="#000000" fill="none"
- All primary outlines must be CLOSED paths ending with Z
- stroke-linecap="round" stroke-linejoin="round" on every element
- No gradients, no shading, no hatching, no colour fills (white background only)

ORGANIC PATH ASSEMBLY:
- Characters must be constructed using multiple distinct <path> elements layered logically: separate paths for head outline, torso, each limb, tail, and facial features
- Prioritize smooth Bezier curves (C and Q commands) for all biological subjects — rounded, child-friendly appearance
- <circle>, <ellipse>, and <rect> are PROHIBITED for organic body parts; they are only permitted for perfect geometric details (eye pupils, buttons, wheels) or mechanical background elements
- NEVER draw construction lines, baseline guides, dimension triangles, or schematic annotations
- Ground terrain should be an organic curved path, not a straight horizontal line

ALLOWED ELEMENTS: svg, g, defs, path, circle, rect, polygon, text, use, symbol
FORBIDDEN ELEMENTS: ellipse, image, line, polyline, linearGradient, radialGradient, style

REQUIRED STRUCTURE:
<svg xmlns="http://www.w3.org/2000/svg" width="${dim.w}" height="${dim.h}" viewBox="0 0 ${dim.vw} ${dim.vh}">
  <rect width="${dim.vw}" height="${dim.vh}" fill="white" stroke="none"/>
  <g id="background">
    <!-- sky, ground, trees, environment elements -->
  </g>
  <g id="characters">
    <!-- all character artwork using organic Bezier paths -->
  </g>
</svg>`;
}

export async function generateSVG(params: {
  prompt: string;
  preset: Preset;
  orientation: Orientation;
  margin_mm: number;
  line_weight_mm: number;
}): Promise<string> {
  const dim = A4_DIMENSIONS[params.orientation];
  const m = params.margin_mm;
  const systemInstruction = buildSvgSystemInstruction(dim, m);
  const userPrompt = buildKidFriendlyPrompt(params.prompt, params.preset, params.orientation);

  const buildRequest = (): GenerateContentRequest => ({
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 32768,
    },
  });

  function extractAndNormalize(raw: string): string | null {
    const m = raw.match(/<svg[\s\S]*<\/svg>/);
    if (!m) return null;
    return normalizeSVG(m[0], params.orientation, params.preset);
  }

  let rawText: string;
  try {
    rawText = await generateWithFallback('generateSVG', buildRequest);
  } catch (geminiErr) {
    if (isGroqAvailable()) {
      console.warn('[generateSVG] All Gemini models failed, falling back to Groq');
      rawText = await generateWithGroq(systemInstruction, userPrompt);
    } else {
      throw geminiErr;
    }
  }

  let finalSvg = extractAndNormalize(rawText);
  if (!finalSvg) {
    throw new Error(`No valid SVG returned. Raw output (first 500 chars): ${rawText.slice(0, 500)}`);
  }

  // Quality gate: retry if the output looks like stick-figure / geometric diagram output.
  if (params.preset !== 'activity_dots') {
    const quality = assessSvgQuality(finalSvg);
    if (!quality.pass) {
      console.warn(`[gemini:generateSVG] Quality gate failed (${quality.reason}) — retrying with stronger nudge`);
      const retryRequest = (): GenerateContentRequest => ({
        systemInstruction: buildRequest().systemInstruction,
        contents: [{
          role: 'user',
          parts: [{ text: buildRequest().contents[0].parts[0].text +
            '\n\nCRITICAL: The previous attempt produced stick-figure / geometric-diagram output. ' +
            'This time you MUST draw the characters with smooth organic Bezier curves (<path> with C and Q commands). ' +
            'Do NOT use <ellipse> or simple <rect> for any body part. ' +
            'Draw a full illustrated scene that fills the canvas — not a diagram.' }],
        }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 32768 },
      });
      const retryText = await generateWithFallback('generateSVG-retry', retryRequest);
      const retrySvg = extractAndNormalize(retryText);
      if (retrySvg) {
        finalSvg = retrySvg;
        console.log('[gemini:generateSVG] Using retry result');
      }
    } else {
      console.log(`[gemini:generateSVG] Quality gate passed (${quality.reason})`);
    }
  }

  if (params.preset !== 'activity_dots' && hasOpenPaths(finalSvg)) {
    console.warn('[gemini:generateSVG] open paths detected in final SVG');
  }

  return finalSvg;
}

const IMAGE_PRESET_PROMPTS: Record<string, string> = {
  coloring_book: 'classic kids coloring book page, bold black outlines, large colorable regions, white fill, full background scene with ground and environment',
  story_sketch:  'expressive kids storybook illustration, clean black outlines, charming characters, full background scene',
};

export async function generateImage(params: {
  prompt: string;
  preset: Preset;
  orientation: Orientation;
}): Promise<{ imageBase64: string; mimeType: 'image/png' }> {
  const orientationHint = params.orientation === 'portrait' ? 'portrait A4 page' : 'landscape A4 page';
  const presetHint = IMAGE_PRESET_PROMPTS[params.preset] ?? IMAGE_PRESET_PROMPTS.coloring_book;

  const userPrompt = `${presetHint}, ${orientationHint}: ${params.prompt}. Black and white line art only, no color fills, no shading, no gradients, pure white background, kid-friendly cartoon style, printable coloring page.`;

  const available = await getAvailableModels();
  const client = getClient();
  const toTry = IMAGE_CANDIDATE_MODELS.filter(m => available.includes(m));
  if (toTry.length === 0) toTry.push(...IMAGE_CANDIDATE_MODELS);

  console.log(`[gemini:generateImage] prompt: ${userPrompt.slice(0, 200)}`);

  let lastError: unknown;
  for (const modelName of toTry) {
    try {
      console.log(`[gemini:generateImage] Trying model: ${modelName}`);
      const model = client.getGenerativeModel({ model: modelName, safetySettings: SAFETY_SETTINGS });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } as any,
      });

      const parts = result.response.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p: { inlineData?: { mimeType?: string; data?: string } }) => p.inlineData?.data);
      if (!imagePart?.inlineData?.data) {
        throw new Error('No image data in response');
      }

      console.log(`[gemini:generateImage] SUCCESS with ${modelName} — image size: ${imagePart.inlineData.data.length} base64 chars`);
      return { imageBase64: imagePart.inlineData.data, mimeType: 'image/png' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404') || msg.includes('429') || msg.includes('503')) {
        console.warn(`[gemini:generateImage] Model ${modelName} unavailable: ${msg.slice(0, 150)}`);
        lastError = err;
        continue;
      }
      console.error(`[gemini:generateImage] Non-retriable error from ${modelName}: ${msg}`);
      throw err;
    }
  }
  // Fallback to HuggingFace if Gemini image models are unavailable (pay-only / region-blocked)
  if (isHfImageAvailable()) {
    console.warn('[gemini:generateImage] All Gemini image models failed, falling back to HuggingFace');
    return generateImageWithHf(params);
  }

  throw new Error(`All image models failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function extractMetadata(params: {
  prompt: string;
  svg?: string;
  imageBase64?: string;
}): Promise<Omit<DrawingMetadata, 'drawing_id' | 'raw_model_output'> & { raw_model_output: unknown }> {
  const systemInstruction = `You are a visual analysis assistant.
Analyze the provided drawing and return ONLY a valid JSON object — no markdown, no explanation.

JSON schema:
{
  "depiction_summary": "string — one sentence describing what is depicted",
  "tags": ["array", "of", "lowercase", "descriptive", "tags"],
  "objects": [
    { "name": "string", "description": "string", "position": "string" }
  ],
  "style": {
    "stroke_style": "string",
    "fill_style": "string",
    "complexity": "simple|moderate|complex",
    "aesthetic": "string"
  },
  "page": {
    "orientation": "portrait|landscape",
    "layout": "string",
    "composition": "string"
  }
}`;

  // Build user content parts — inline image if available, SVG text otherwise.
  type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };
  const parts: ContentPart[] = [{ text: `Original prompt: "${params.prompt}"\n\nAnalyze the drawing:` }];
  if (params.imageBase64) {
    parts.push({ inlineData: { mimeType: 'image/png', data: params.imageBase64 } });
  } else if (params.svg) {
    parts.push({ text: `SVG content (first 8000 chars):\n${params.svg.slice(0, 8000)}` });
  }

  const text = await generateWithFallback('extractMetadata', () => ({
    systemInstruction,
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  }));

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Gemini did not return valid JSON metadata');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    depiction_summary: parsed.depiction_summary ?? '',
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    objects: Array.isArray(parsed.objects) ? parsed.objects : [],
    style: parsed.style ?? {},
    page: parsed.page ?? {},
    raw_model_output: parsed,
  };
}
