import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PageInfo, TextRun } from "./types";

// Wire up the worker (webpack/Next emits this as an asset).
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
}

export type { PDFDocumentProxy, PDFPageProxy };

export async function loadDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  // Copy — pdf.js transfers/detaches the buffer, and we keep the original for export.
  const buf = data.slice(0);
  const task = pdfjsLib.getDocument({ data: buf });
  return task.promise;
}

export interface RenderedPage {
  info: PageInfo;
  canvas: HTMLCanvasElement;
  scale: number;
  page: PDFPageProxy;
}

/**
 * Render a page to a canvas at the given CSS scale (device pixels use extra DPR),
 * then extract positioned text runs, sampling each run's ink colour from the raster.
 */
export async function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  cssScale: number
): Promise<RenderedPage> {
  const page = await pdf.getPage(pageNumber);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: cssScale * dpr });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  await page.render({ canvasContext: ctx, viewport }).promise;

  // Base viewport (scale 1) gives us PDF-point dimensions.
  const base = page.getViewport({ scale: 1 });
  const widthPt = base.width;
  const heightPt = base.height;

  const runs = await extractRuns(page, pageNumber, ctx, cssScale * dpr, heightPt);

  return {
    info: { pageNumber, widthPt, heightPt, runs },
    canvas,
    scale: cssScale,
    page,
  };
}

/** Re-rasterize a page at a new scale without re-extracting text. Used on zoom. */
export async function rasterizePage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  cssScale: number
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: cssScale * dpr });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function extractRuns(
  page: PDFPageProxy,
  pageNumber: number,
  ctx: CanvasRenderingContext2D,
  pxScale: number,
  heightPt: number
): Promise<TextRun[]> {
  const tc = await page.getTextContent();
  const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const runs: TextRun[] = [];
  const metaCache = new Map<string, FontMeta>();
  let i = 0;

  for (const raw of tc.items) {
    const item = raw as {
      str: string;
      transform: number[];
      width: number;
      height: number;
      fontName: string;
    };
    if (!("str" in item) || !item.str || !item.str.trim()) continue;

    const t = item.transform;
    const angle = Math.atan2(t[1], t[0]);
    const fontSize = Math.hypot(t[2], t[3]) || item.height || 10;
    const x = t[4];
    const yBaseline = t[5];
    const width = item.width || item.str.length * fontSize * 0.5;

    const color = sampleColor(img, pxScale, heightPt, x, yBaseline, width, fontSize);

    let meta = metaCache.get(item.fontName);
    if (!meta) {
      meta = getFontMeta(page, item.fontName);
      metaCache.set(item.fontName, meta);
    }

    runs.push({
      id: `p${pageNumber}-r${i++}`,
      page: pageNumber,
      str: item.str,
      x,
      yBaseline,
      width,
      fontSize,
      angle,
      fontName: item.fontName,
      realFontName: meta.name,
      bold: meta.bold,
      italic: meta.italic,
      black: meta.black,
      color,
    });
  }
  return runs;
}

/** Find the "inkiest" (farthest-from-white) pixel in a run's bbox to approximate text colour. */
function sampleColor(
  img: ImageData,
  pxScale: number,
  heightPt: number,
  x: number,
  yBaseline: number,
  width: number,
  fontSize: number
): [number, number, number] {
  const left = Math.max(0, Math.floor(x * pxScale));
  const right = Math.min(img.width, Math.ceil((x + width) * pxScale));
  const topPt = yBaseline + fontSize * 0.85;
  const botPt = yBaseline - fontSize * 0.2;
  const top = Math.max(0, Math.floor((heightPt - topPt) * pxScale));
  const bot = Math.min(img.height, Math.ceil((heightPt - botPt) * pxScale));

  let best = 0;
  let br = 0,
    bg = 0,
    bb = 0;
  const d = img.data;
  for (let py = top; py < bot; py++) {
    for (let px = left; px < right; px++) {
      const o = (py * img.width + px) * 4;
      const r = d[o],
        g = d[o + 1],
        b = d[o + 2],
        a = d[o + 3];
      if (a < 40) continue;
      const dist = (255 - r) + (255 - g) + (255 - b); // distance from white
      if (dist > best) {
        best = dist;
        br = r;
        bg = g;
        bb = b;
      }
    }
  }
  if (best < 60) return [0, 0, 0]; // nothing dark found → default black
  return [br / 255, bg / 255, bb / 255];
}

/**
 * Register embedded font bytes as browser FontFaces so edited text can be shown
 * in the document's own font. Returns a map of pdf.js fontName -> CSS family name
 * (only for fonts that actually loaded).
 */
export async function registerFonts(
  fontData: Record<string, Uint8Array | null>,
  fontMeta: Record<string, FontMeta> = {}
): Promise<Record<string, string>> {
  if (typeof document === "undefined" || !("fonts" in document)) return {};
  const map: Record<string, string> = {};
  const tasks: Promise<void>[] = [];

  for (const [name, bytes] of Object.entries(fontData)) {
    if (!bytes || !bytes.length) continue;
    const family = `pf_${name.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const meta = fontMeta[name];
    try {
      // Copy to a fresh, exact-length ArrayBuffer — the source may be a view
      // into a larger buffer and FontFace needs its own bytes.
      const buf = bytes.slice().buffer;
      // Register the file under its true weight/style so that requesting that
      // weight is an exact match (the file already carries the correct glyphs —
      // no synthetic bolding) and any fallback to a secondary family stays bold.
      const descriptors: FontFaceDescriptors = meta
        ? {
            weight: String(weightFor(meta)),
            style: meta.italic ? "italic" : "normal",
          }
        : {};
      const face = new FontFace(family, buf, descriptors);
      tasks.push(
        face.load().then(
          (loaded) => {
            (document as any).fonts.add(loaded);
            map[name] = family;
          },
          () => {
            /* font couldn't be parsed as a web font — fall back to heuristics */
          }
        )
      );
    } catch {
      /* ignore */
    }
  }
  await Promise.all(tasks);
  return map;
}

export interface RasterizedRun {
  dataUrl: string;
  xPt: number;
  yBottomPt: number;
  wPt: number;
  hPt: number;
}

/**
 * Render replacement text for a run to a transparent PNG using a browser font
 * (typically the document's own FontFace-loaded family). Coordinates come back
 * in PDF user space so the exporter can stamp it exactly over the original.
 * Returns null for rotated runs (handled by the font path instead).
 */
export function rasterizeRunText(
  text: string,
  cssFamily: string,
  fontSizePt: number,
  color: [number, number, number],
  x: number,
  yBaseline: number,
  angle: number,
  weight: number = 400,
  style: "normal" | "italic" = "normal"
): RasterizedRun | null {
  if (Math.abs(angle) > 0.01) return null;
  if (typeof document === "undefined") return null;

  const SS = 6; // supersample for crisp glyphs
  const fontPx = fontSizePt * SS;
  // Weight/style must match how the FontFace was registered, otherwise the
  // browser falls back and (worse) may synthesize a bold that we didn't want.
  const font = `${style} ${weight} ${fontPx}px ${cssFamily}`;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const m = measure.measureText(text);
  const asc =
    m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || fontPx * 0.8;
  const desc =
    m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || fontPx * 0.2;
  const padX = fontPx * 0.15; // room for italic / overhang
  const w = Math.max(1, Math.ceil(m.width + padX));
  const h = Math.max(1, Math.ceil(asc + desc));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = `rgb(${color.map((c) => Math.round(c * 255)).join(",")})`;
  ctx.fillText(text, 0, asc);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    xPt: x,
    yBottomPt: yBaseline - desc / SS,
    wPt: w / SS,
    hPt: h / SS,
  };
}

/** Best-effort extraction of the embedded font file bytes for a run's font. */
export function getEmbeddedFontData(
  page: PDFPageProxy,
  fontName: string
): Uint8Array | null {
  try {
    const obj = (page.commonObjs as any).get(fontName);
    if (obj && obj.data && obj.data.length) return obj.data as Uint8Array;
  } catch {
    /* not resolved / not embedded */
  }
  return null;
}

export interface FontMeta {
  name: string; // real PostScript/base font name, or the loadedName if unknown
  bold: boolean;
  italic: boolean;
  black: boolean;
}

/**
 * Read pdf.js's own metadata for a font. Unlike a regex on the internal
 * loadedName ("g_d0_f1"), pdf.js derives bold/italic/black from the actual
 * base font name and descriptor flags, so it reliably reflects the real weight.
 * Must be called after the page has rendered (font resolved into commonObjs).
 */
export function getFontMeta(page: PDFPageProxy, fontName: string): FontMeta {
  try {
    const obj = (page.commonObjs as any).get(fontName);
    if (obj) {
      return {
        name: obj.name || fontName,
        bold: !!obj.bold,
        italic: !!obj.italic,
        black: !!obj.black,
      };
    }
  } catch {
    /* not resolved / not embedded */
  }
  return { name: fontName, bold: false, italic: false, black: false };
}

/** Numeric CSS weight for a run's font, matching how its FontFace is registered. */
export function weightFor(f: { bold: boolean; black: boolean }): number {
  return f.black ? 900 : f.bold ? 700 : 400;
}
