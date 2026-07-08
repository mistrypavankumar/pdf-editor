import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Annotation, PageInfo, TextRun } from "./types";

/**
 * An edited run pre-rendered to a PNG in the browser using the document's own
 * (FontFace-loaded) font. Placed as an image so the export matches the on-screen
 * preview exactly, regardless of whether pdf-lib can embed the font.
 */
export interface RenderedRun {
  dataUrl: string; // PNG, transparent background, coloured text
  xPt: number; // left, PDF units
  yBottomPt: number; // bottom of the image box, PDF units
  wPt: number;
  hPt: number;
}

interface ExportInput {
  original: ArrayBuffer;
  pages: PageInfo[];
  edits: Map<string, string>; // runId -> new text
  annotations: Annotation[];
  /** embedded font bytes keyed by pdf.js fontName (loadedName) */
  fontData: Record<string, Uint8Array | null>;
  /** runId -> pre-rendered text image (preferred over re-typesetting) */
  renderedRuns?: Record<string, RenderedRun>;
}

function pickStandardFont(run: TextRun): StandardFonts {
  const n = (run.realFontName || run.fontName).toLowerCase();
  const bold = run.bold || run.black;
  const italic = run.italic;
  if (/times|serif|georgia|roman|minion/.test(n)) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (/courier|mono|consol/.test(n)) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

export async function buildEditedPdf(input: ExportInput): Promise<Uint8Array> {
  const { original, pages, edits, annotations, fontData } = input;
  const renderedRuns = input.renderedRuns ?? {};
  const doc = await PDFDocument.load(original);
  doc.registerFontkit(fontkit);

  const embeddedCache = new Map<string, PDFFont | null>();
  const standardCache = new Map<StandardFonts, PDFFont>();

  async function standard(name: StandardFonts): Promise<PDFFont> {
    let f = standardCache.get(name);
    if (!f) {
      f = await doc.embedFont(name);
      standardCache.set(name, f);
    }
    return f;
  }

  /** Return an embedded font for the run, or null if it couldn't be embedded. */
  async function embedded(fontName: string): Promise<PDFFont | null> {
    if (embeddedCache.has(fontName)) return embeddedCache.get(fontName)!;
    const bytes = fontData[fontName];
    let font: PDFFont | null = null;
    if (bytes && bytes.length) {
      try {
        font = await doc.embedFont(bytes, { subset: false });
      } catch {
        font = null;
      }
    }
    embeddedCache.set(fontName, font);
    return font;
  }

  const docPages = doc.getPages();
  let zapf: PDFFont | null = null;

  for (const info of pages) {
    const page = docPages[info.pageNumber - 1];
    if (!page) continue;

    // --- edited text runs ---
    for (const run of info.runs) {
      if (!edits.has(run.id)) continue;
      const newText = edits.get(run.id)!;
      if (newText === run.str) continue;
      whiteout(page, run);
      if (!newText) continue;

      // Preferred path: stamp the browser-rendered image so the exported text
      // is pixel-identical to what the user saw (correct embedded font).
      const rr = renderedRuns[run.id];
      if (rr) {
        try {
          const png = await doc.embedPng(rr.dataUrl);
          page.drawImage(png, {
            x: rr.xPt,
            y: rr.yBottomPt,
            width: rr.wPt,
            height: rr.hPt,
          });
          continue;
        } catch {
          /* fall through to font-based typesetting */
        }
      }

      const [r, g, b] = run.color;
      // Prefer the document's own embedded font; fall back to a matched standard font.
      let font = await embedded(run.fontName);
      const draw = (f: PDFFont) =>
        page.drawText(newText, {
          x: run.x,
          y: run.yBaseline,
          size: run.fontSize,
          font: f,
          color: rgb(r, g, b),
          rotate: degrees((run.angle * 180) / Math.PI),
        });
      try {
        if (!font) font = await standard(pickStandardFont(run));
        draw(font);
      } catch {
        // embedded font missing a glyph → retry with standard
        try {
          draw(await standard(pickStandardFont(run)));
        } catch {
          /* give up on this run */
        }
      }
    }
  }

  // --- annotations ---
  for (const a of annotations) {
    const page = docPages[a.page - 1];
    if (!page) continue;
    switch (a.kind) {
      case "highlight":
        page.drawRectangle({
          x: a.x, y: a.y, width: a.w, height: a.h,
          color: hex(a.color), opacity: 0.4,
        });
        break;
      case "erase":
        page.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color: rgb(1, 1, 1) });
        break;
      case "redact":
        page.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color: rgb(0, 0, 0) });
        break;
      case "text": {
        const f = await standard(StandardFonts.Helvetica);
        page.drawText(a.text, { x: a.x, y: a.y, size: a.size, font: f, color: hex(a.color) });
        break;
      }
      case "mark": {
        if (!zapf) zapf = await standard(StandardFonts.ZapfDingbats);
        const glyph = a.glyph === "✓" ? "4" : "8"; // ZapfDingbats check / cross
        page.drawText(glyph, { x: a.x, y: a.y, size: a.size, font: zapf, color: rgb(0.1, 0.5, 0.1) });
        break;
      }
      case "draw": {
        const c = hex(a.color);
        for (let i = 1; i < a.points.length; i++) {
          const p0 = a.points[i - 1];
          const p1 = a.points[i];
          page.drawLine({
            start: { x: p0.x, y: p0.y },
            end: { x: p1.x, y: p1.y },
            thickness: a.width,
            color: c,
          });
        }
        break;
      }
      case "image": {
        try {
          const img = a.dataUrl.startsWith("data:image/png")
            ? await doc.embedPng(a.dataUrl)
            : await doc.embedJpg(a.dataUrl);
          page.drawImage(img, { x: a.x, y: a.y, width: a.w, height: a.h });
        } catch {
          /* unsupported image */
        }
        break;
      }
    }
  }

  return doc.save();
}

function whiteout(page: PDFPage, run: TextRun) {
  const pad = run.fontSize * 0.08;
  page.drawRectangle({
    x: run.x - pad,
    y: run.yBaseline - run.fontSize * 0.25,
    width: run.width + pad * 2,
    height: run.fontSize * 1.3,
    color: rgb(1, 1, 1),
  });
}

function hex(h: string) {
  const m = h.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  return rgb(r || 0, g || 0, b || 0);
}
