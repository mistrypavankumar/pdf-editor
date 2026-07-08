"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  loadDocument,
  renderPage,
  rasterizePage,
  getEmbeddedFontData,
  registerFonts,
  rasterizeRunText,
  type RasterizedRun,
  type FontMeta,
  type PDFDocumentProxy,
} from "@/lib/pdfEngine";
import { buildEditedPdf } from "@/lib/exportPdf";
import type { Annotation, PageInfo, Tool } from "@/lib/types";
import { Toolbar } from "./Toolbar";
import { PageView } from "./PageView";

/** History snapshot of everything a user can change. */
interface Snapshot {
  edits: Record<string, string>;
  annotations: Annotation[];
}

let uid = 0;
const nextId = () => `a${Date.now().toString(36)}-${uid++}`;

/** Default colour/size per tool. */
const HIGHLIGHT_COLOR = "#ffe14d";
const DRAW_COLOR = "#e11d48";
const SIGN_COLOR = "#1d4ed8";
const TEXT_COLOR = "#1c1e21";

export default function PdfEditor() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState("Untitled");
  const originalRef = useRef<ArrayBuffer | null>(null);

  const [pages, setPages] = useState<PageInfo[]>([]);
  const [canvases, setCanvases] = useState<(HTMLCanvasElement | null)[]>([]);
  const fontDataRef = useRef<Record<string, Uint8Array | null>>({});
  const [fontFamilies, setFontFamilies] = useState<Record<string, string>>({});

  const [scale, setScale] = useState(1.5);
  const rasterScaleRef = useRef(1.5);
  const [tool, setTool] = useState<Tool>("select");

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(1);

  // --- history (undo / redo) ---
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const [histVersion, setHistVersion] = useState(0);

  const snapshot = useCallback(
    (): Snapshot => ({ edits: { ...edits }, annotations: [...annotations] }),
    [edits, annotations]
  );

  const pushHistory = useCallback(() => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setHistVersion((v) => v + 1);
  }, [snapshot]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(snapshot());
    setEdits(prev.edits);
    setAnnotations(prev.annotations);
    setHistVersion((v) => v + 1);
  }, [snapshot]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(snapshot());
    setEdits(next.edits);
    setAnnotations(next.annotations);
    setHistVersion((v) => v + 1);
  }, [snapshot]);

  // Reflect current tool on <body> so CSS can flip the text layer to editable.
  useEffect(() => {
    document.body.dataset.mode = tool;
    return () => {
      delete document.body.dataset.mode;
    };
  }, [tool]);

  // --- loading a document ---
  const openBytes = useCallback(async (bytes: ArrayBuffer, name: string) => {
    setBusy(true);
    try {
      originalRef.current = bytes.slice(0);
      const doc = await loadDocument(bytes);
      const infos: PageInfo[] = [];
      const cnv: HTMLCanvasElement[] = [];
      const fonts: Record<string, Uint8Array | null> = {};
      const meta: Record<string, FontMeta> = {};
      const initialScale = 1.5;
      for (let n = 1; n <= doc.numPages; n++) {
        const r = await renderPage(doc, n, initialScale);
        infos.push(r.info);
        cnv.push(r.canvas);
        for (const run of r.info.runs) {
          if (!(run.fontName in fonts)) {
            fonts[run.fontName] = getEmbeddedFontData(r.page, run.fontName);
            meta[run.fontName] = {
              name: run.realFontName,
              bold: run.bold,
              italic: run.italic,
              black: run.black,
            };
          }
        }
      }
      fontDataRef.current = fonts;
      // Load the document's own fonts into the browser — registered at their
      // true weight/style — so edited text matches the original.
      setFontFamilies(await registerFonts(fonts, meta));
      rasterScaleRef.current = initialScale;
      setScale(initialScale);
      setPdf(doc);
      setPages(infos);
      setCanvases(cnv);
      setEdits({});
      setAnnotations([]);
      undoStack.current = [];
      redoStack.current = [];
      setFileName(name.replace(/\.pdf$/i, ""));
      setCurrent(1);
    } finally {
      setBusy(false);
    }
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      const buf = await file.arrayBuffer();
      await openBytes(buf, file.name);
    },
    [openBytes]
  );

  // --- re-rasterize on zoom (text extraction is scale-independent) ---
  useEffect(() => {
    if (!pdf || pages.length === 0) return;
    if (rasterScaleRef.current === scale) return;
    let cancelled = false;
    rasterScaleRef.current = scale;
    (async () => {
      for (let n = 1; n <= pdf.numPages; n++) {
        const c = await rasterizePage(pdf, n, scale);
        if (cancelled) return;
        setCanvases((prev) => {
          const copy = prev.slice();
          copy[n - 1] = c;
          return copy;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scale, pdf, pages.length]);

  // --- mutations that record history ---
  const addAnnotation = useCallback(
    (a: Annotation) => {
      pushHistory();
      setAnnotations((prev) => [...prev, a]);
    },
    [pushHistory]
  );

  const updateAnnotation = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a))
    );
  }, []);

  const removeAnnotation = useCallback(
    (id: string) => {
      pushHistory();
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [pushHistory]
  );

  const commitEdit = useCallback(
    (runId: string, text: string, original: string) => {
      pushHistory();
      setEdits((prev) => {
        const copy = { ...prev };
        if (text === original) delete copy[runId];
        else copy[runId] = text;
        return copy;
      });
    },
    [pushHistory]
  );

  // --- export ---
  const doExport = useCallback(async () => {
    if (!originalRef.current) return;
    setBusy(true);
    try {
      // Pre-render each edited run to an image using the document's own font,
      // so the exported text is identical to the on-screen preview.
      await (document as any).fonts?.ready;
      const renderedRuns: Record<string, RasterizedRun> = {};
      for (const info of pages) {
        for (const run of info.runs) {
          const nt = edits[run.id];
          if (nt === undefined || nt === run.str || nt === "") continue;
          const fam = fontFamilies[run.fontName];
          if (!fam) continue; // no embedded font → let pdf-lib typeset it
          const stack = `"${fam}", "${run.realFontName}", sans-serif`;
          const weight = run.black ? 900 : run.bold ? 700 : 400;
          const style = run.italic ? "italic" : "normal";
          const r = rasterizeRunText(
            nt,
            stack,
            run.fontSize,
            run.color,
            run.x,
            run.yBaseline,
            run.angle,
            weight,
            style
          );
          if (r) renderedRuns[run.id] = r;
        }
      }

      const bytes = await buildEditedPdf({
        original: originalRef.current.slice(0),
        pages,
        edits: new Map(Object.entries(edits)),
        annotations,
        fontData: fontDataRef.current,
        renderedRuns,
      });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName || "document"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }, [pages, edits, annotations, fileName, fontFamilies]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void doExport();
      } else if (!typing && (e.key === "=" || e.key === "+")) {
        setScale((s) => Math.min(4, +(s + 0.15).toFixed(2)));
      } else if (!typing && e.key === "-") {
        setScale((s) => Math.max(0.4, +(s - 0.15).toFixed(2)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, doExport]);

  const toolDefaults = useMemo(
    () => ({
      HIGHLIGHT_COLOR,
      DRAW_COLOR,
      SIGN_COLOR,
      TEXT_COLOR,
    }),
    []
  );

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  // histVersion is only referenced to force re-eval of canUndo/canRedo above.
  void histVersion;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas">
      <TopBar
        fileName={fileName}
        onRename={setFileName}
        onDownload={doExport}
        onPrint={() => window.print()}
        busy={busy}
        hasDoc={!!pdf}
      />

      <Toolbar
        tool={tool}
        setTool={setTool}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        disabled={!pdf}
      />

      {!pdf ? (
        <DropZone onFile={openFile} busy={busy} />
      ) : (
        <div className="workspace flex-1 overflow-auto">
          <div className="mx-auto flex max-w-[1000px] flex-col items-center gap-8 py-10">
            {pages.map((info, i) => (
              <PageView
                key={info.pageNumber}
                info={info}
                canvas={canvases[i] ?? null}
                scale={scale}
                tool={tool}
                edits={edits}
                annotations={annotations}
                fontFamilies={fontFamilies}
                defaults={toolDefaults}
                nextId={nextId}
                onCommitEdit={commitEdit}
                onAddAnnotation={addAnnotation}
                onUpdateAnnotation={updateAnnotation}
                onRemoveAnnotation={removeAnnotation}
                onVisible={() => setCurrent(info.pageNumber)}
              />
            ))}
          </div>
        </div>
      )}

      {pdf && (
        <Pager
          current={current}
          total={pdf.numPages}
          scale={scale}
          onZoom={(s) => setScale(s)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

function TopBar({
  fileName,
  onRename,
  onDownload,
  onPrint,
  busy,
  hasDoc,
}: {
  fileName: string;
  onRename: (s: string) => void;
  onDownload: () => void;
  onPrint: () => void;
  busy: boolean;
  hasDoc: boolean;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-white px-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded bg-danger text-[10px] font-bold text-white">
            PDF
          </span>
          <span className="text-[15px]">Files Editor</span>
        </div>
        {hasDoc && (
          <div className="ml-4 flex items-center gap-2 text-muted">
            <CloudIcon />
            <input
              value={fileName}
              onChange={(e) => onRename(e.target.value)}
              className="w-48 rounded px-1 text-[15px] text-ink outline-none focus:bg-canvas"
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <IconBtn title="Print" onClick={onPrint} disabled={!hasDoc}>
          <PrintIcon />
        </IconBtn>
        <IconBtn title="Download" onClick={onDownload} disabled={!hasDoc || busy}>
          <DownloadIcon />
        </IconBtn>
        <button
          onClick={onDownload}
          disabled={!hasDoc || busy}
          className="ml-2 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-40"
        >
          <CheckIcon className="h-4 w-4" />
          {busy ? "Working…" : "DONE"}
        </button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Drop zone                                                           */
/* ------------------------------------------------------------------ */

function DropZone({
  onFile,
  busy,
}: {
  onFile: (f: File) => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && f.type === "application/pdf") onFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed bg-white p-16 text-center transition ${
          over ? "border-accent bg-accent-soft" : "border-line"
        }`}
      >
        <div className="grid h-16 w-16 place-items-center rounded-full bg-accent-soft text-accent">
          <UploadIcon />
        </div>
        <div className="text-lg font-semibold">
          {busy ? "Opening…" : "Drop a PDF here"}
        </div>
        <div className="text-sm text-muted">
          or click to browse. Everything stays in your browser.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pager / zoom                                                        */
/* ------------------------------------------------------------------ */

function Pager({
  current,
  total,
  scale,
  onZoom,
}: {
  current: number;
  total: number;
  scale: number;
  onZoom: (s: number) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-white px-4 py-2 shadow-card">
        <span className="min-w-[48px] text-center text-sm tabular-nums text-muted">
          {current} / {total}
        </span>
        <span className="h-4 w-px bg-line" />
        <button
          className="grid h-7 w-7 place-items-center rounded-full text-lg text-muted hover:bg-canvas"
          onClick={() => onZoom(Math.max(0.4, +(scale - 0.15).toFixed(2)))}
        >
          −
        </button>
        <span className="min-w-[52px] text-center text-sm tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <button
          className="grid h-7 w-7 place-items-center rounded-full text-lg text-muted hover:bg-canvas"
          onClick={() => onZoom(Math.min(4, +(scale + 0.15).toFixed(2)))}
        >
          +
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function IconBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-canvas disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function CheckIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M7 18a4 4 0 010-8 5 5 0 019.6-1.3A3.5 3.5 0 0117 18H7z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}
function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M6 9V4h12v5M6 18H4v-6h16v6h-2M8 14h8v6H8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
      <path
        d="M12 16V5m0 0L8 9m4-4l4 4M5 19h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
