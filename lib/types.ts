export type Tool =
  | "select"
  | "editpdf"
  | "sign"
  | "text"
  | "erase"
  | "highlight"
  | "redact"
  | "image"
  | "draw"
  | "cross"
  | "check";

/** A run of text extracted from the PDF, positioned in PDF user space (origin bottom-left). */
export interface TextRun {
  id: string;
  page: number; // 1-based
  str: string;
  x: number; // left, PDF units
  yBaseline: number; // baseline y from bottom, PDF units
  width: number; // advance width, PDF units
  fontSize: number; // PDF units
  angle: number; // radians
  fontName: string; // pdf.js loadedName (key into commonObjs)
  realFontName: string; // actual PostScript/base font name (e.g. "Arial-BoldMT")
  bold: boolean; // from the font's own metadata, not a name guess
  italic: boolean;
  black: boolean; // heavy/black weight
  color: [number, number, number]; // 0..1 rgb, sampled from raster
}

/** Free-form annotation added on top of the page. */
export type Annotation =
  | { kind: "highlight"; id: string; page: number; x: number; y: number; w: number; h: number; color: string }
  | { kind: "erase"; id: string; page: number; x: number; y: number; w: number; h: number }
  | { kind: "redact"; id: string; page: number; x: number; y: number; w: number; h: number }
  | { kind: "text"; id: string; page: number; x: number; y: number; size: number; text: string; color: string }
  | { kind: "mark"; id: string; page: number; x: number; y: number; size: number; glyph: "✕" | "✓" }
  | { kind: "draw"; id: string; page: number; points: { x: number; y: number }[]; color: string; width: number }
  | { kind: "image"; id: string; page: number; x: number; y: number; w: number; h: number; dataUrl: string };

export interface PageInfo {
  pageNumber: number;
  widthPt: number; // page width in PDF points
  heightPt: number; // page height in PDF points
  runs: TextRun[];
}
