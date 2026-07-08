"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Annotation, PageInfo, Tool } from "@/lib/types";

interface Defaults {
  HIGHLIGHT_COLOR: string;
  DRAW_COLOR: string;
  SIGN_COLOR: string;
  TEXT_COLOR: string;
}

const RECT_TOOLS: Tool[] = ["erase", "highlight", "redact", "image"];
const PATH_TOOLS: Tool[] = ["draw", "sign"];
const CLICK_TOOLS: Tool[] = ["text", "cross", "check"];

export function PageView({
  info,
  canvas,
  scale,
  tool,
  edits,
  annotations,
  fontFamilies,
  defaults,
  nextId,
  onCommitEdit,
  onAddAnnotation,
  onUpdateAnnotation,
  onRemoveAnnotation,
  onVisible,
}: {
  info: PageInfo;
  canvas: HTMLCanvasElement | null;
  scale: number;
  tool: Tool;
  edits: Record<string, string>;
  annotations: Annotation[];
  fontFamilies: Record<string, string>;
  defaults: Defaults;
  nextId: () => string;
  onCommitEdit: (runId: string, text: string, original: string) => void;
  onAddAnnotation: (a: Annotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  onRemoveAnnotation: (id: string) => void;
  onVisible: () => void;
}) {
  const W = info.widthPt * scale;
  const H = info.heightPt * scale;

  const containerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingRect = useRef<{ x: number; y: number; w: number; h: number } | null>(
    null
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  );
  const [path, setPath] = useState<{ x: number; y: number }[] | null>(null);

  // report visibility for the pager
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.5) onVisible();
      },
      { threshold: [0.5] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onVisible]);

  const pageAnnos = annotations.filter((a) => a.page === info.pageNumber);
  const creating =
    RECT_TOOLS.includes(tool) || PATH_TOOLS.includes(tool) || CLICK_TOOLS.includes(tool);

  // screen (px, relative to page) -> PDF points (origin bottom-left)
  const toPdf = (sx: number, sy: number) => ({
    x: sx / scale,
    y: info.heightPt - sy / scale,
  });

  const localPoint = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /* ---------------- creation overlay handlers ---------------- */

  const onDown = (e: React.PointerEvent) => {
    const { x, y } = localPoint(e);

    if (CLICK_TOOLS.includes(tool)) {
      // If a text box is currently being edited, the first click just commits it.
      const active = document.activeElement as HTMLElement | null;
      if (tool === "text" && active?.isContentEditable) {
        active.blur();
        return;
      }
      const p = toPdf(x, y);
      if (tool === "text") {
        onAddAnnotation({
          kind: "text",
          id: nextId(),
          page: info.pageNumber,
          x: p.x,
          y: p.y - 14,
          size: 14,
          text: "",
          color: defaults.TEXT_COLOR,
        });
      } else {
        const size = 22;
        onAddAnnotation({
          kind: "mark",
          id: nextId(),
          page: info.pageNumber,
          x: p.x - size * 0.3,
          y: p.y - size * 0.35,
          size,
          glyph: tool === "cross" ? "✕" : "✓",
        });
      }
      return;
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (RECT_TOOLS.includes(tool)) setDrag({ x0: x, y0: y, x1: x, y1: y });
    else if (PATH_TOOLS.includes(tool)) setPath([{ x, y }]);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag && !path) return;
    const { x, y } = localPoint(e);
    if (drag) setDrag((d) => (d ? { ...d, x1: x, y1: y } : d));
    else if (path) setPath((p) => (p ? [...p, { x, y }] : p));
  };

  const onUp = () => {
    if (drag) {
      const sx = Math.min(drag.x0, drag.x1);
      const sy = Math.min(drag.y0, drag.y1);
      const sw = Math.abs(drag.x1 - drag.x0);
      const sh = Math.abs(drag.y1 - drag.y0);
      setDrag(null);
      if (sw > 4 && sh > 4) {
        const rect = {
          x: sx / scale,
          y: info.heightPt - (sy + sh) / scale,
          w: sw / scale,
          h: sh / scale,
        };
        if (tool === "highlight")
          onAddAnnotation({
            kind: "highlight",
            id: nextId(),
            page: info.pageNumber,
            ...rect,
            color: defaults.HIGHLIGHT_COLOR,
          });
        else if (tool === "erase")
          onAddAnnotation({ kind: "erase", id: nextId(), page: info.pageNumber, ...rect });
        else if (tool === "redact")
          onAddAnnotation({ kind: "redact", id: nextId(), page: info.pageNumber, ...rect });
        else if (tool === "image") {
          pendingRect.current = rect;
          imageInputRef.current?.click();
        }
      }
    }

    if (path) {
      const pts = path;
      setPath(null);
      if (pts.length > 1) {
        const points = pts.map((p) => toPdf(p.x, p.y));
        onAddAnnotation({
          kind: "draw",
          id: nextId(),
          page: info.pageNumber,
          points,
          color: tool === "sign" ? defaults.SIGN_COLOR : defaults.DRAW_COLOR,
          width: tool === "sign" ? 2.5 : 2,
        });
      }
    }
  };

  const onImagePicked = (file: File) => {
    const rect = pendingRect.current;
    pendingRect.current = null;
    if (!rect) return;
    const reader = new FileReader();
    reader.onload = () => {
      onAddAnnotation({
        kind: "image",
        id: nextId(),
        page: info.pageNumber,
        ...rect,
        dataUrl: String(reader.result),
      });
    };
    reader.readAsDataURL(file);
  };

  const cursor =
    tool === "select" ? "default" : tool === "editpdf" ? "default" : "crosshair";

  return (
    <div className="flex flex-col items-center">
      <div className="mb-1 flex w-full items-center justify-between px-1 text-sm text-muted">
        <span>#{info.pageNumber}</span>
      </div>
      <div
        ref={containerRef}
        className="relative bg-white shadow-card"
        style={{ width: W, height: H }}
      >
        {/* raster */}
        <CanvasHost canvas={canvas} />

        {/* draw / sign strokes (below text so editing stays crisp) */}
        <svg
          className="anno-layer"
          width={W}
          height={H}
          style={{ pointerEvents: "none" }}
        >
          {pageAnnos
            .filter((a) => a.kind === "draw")
            .map((a) =>
              a.kind === "draw" ? (
                <polyline
                  key={a.id}
                  points={a.points
                    .map((p) => `${p.x * scale},${(info.heightPt - p.y) * scale}`)
                    .join(" ")}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={a.width * scale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ pointerEvents: tool === "select" ? "stroke" : "none", cursor: "pointer" }}
                  onClick={() => tool === "select" && onRemoveAnnotation(a.id)}
                />
              ) : null
            )}
          {path && (
            <polyline
              points={path.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={tool === "sign" ? defaults.SIGN_COLOR : defaults.DRAW_COLOR}
              strokeWidth={(tool === "sign" ? 2.5 : 2) * scale}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        {/* rectangle / mark / text / image annotations */}
        <div className="anno-layer" style={{ pointerEvents: "none" }}>
          {pageAnnos.map((a) => (
            <AnnoView
              key={a.id}
              a={a}
              scale={scale}
              heightPt={info.heightPt}
              tool={tool}
              onUpdate={onUpdateAnnotation}
              onRemove={onRemoveAnnotation}
            />
          ))}
        </div>

        {/* editable text layer */}
        <div className="text-layer" style={{ width: W, height: H }}>
          {info.runs.map((run) => {
            const changed = run.id in edits;
            const value = changed ? edits[run.id] : run.str;
            const fontPx = run.fontSize * scale;
            const baseline = (info.heightPt - run.yBaseline) * scale;
            const f = cssFont(run, fontFamilies);
            const angleDeg = (run.angle * 180) / Math.PI;
            return (
              <span
                key={`${run.id}|${value}`}
                data-changed={changed ? "1" : undefined}
                className={`t${editingId === run.id ? " editing" : ""}`}
                contentEditable={tool === "editpdf"}
                suppressContentEditableWarning
                onFocus={() => setEditingId(run.id)}
                onBlur={(e) => {
                  setEditingId(null);
                  const text = e.currentTarget.textContent ?? "";
                  onCommitEdit(run.id, text, run.str);
                }}
                style={
                  {
                    left: run.x * scale,
                    top: baseline - fontPx * 0.8,
                    // when masked (editing/changed) the white backing must cover the
                    // full original run width so leftover raster ink can't peek out
                    minWidth: run.width * scale,
                    fontSize: fontPx,
                    fontFamily: f.fontFamily,
                    fontWeight: f.fontWeight,
                    fontStyle: f.fontStyle,
                    // Painted only when this run is being edited / has changed (see globals.css).
                    "--ink": `rgb(${run.color
                      .map((c) => Math.round(c * 255))
                      .join(",")})`,
                    transform:
                      Math.abs(angleDeg) > 0.5 ? `rotate(${-angleDeg}deg)` : undefined,
                  } as React.CSSProperties
                }
              >
                {value}
              </span>
            );
          })}
        </div>

        {/* creation surface — only present for a creating tool, on top of all */}
        {creating && (
          <div
            className="anno-layer"
            style={{ cursor, touchAction: "none", zIndex: 10 }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            {drag && (
              <div
                className="absolute border-2 border-accent bg-accent/10"
                style={{
                  left: Math.min(drag.x0, drag.x1),
                  top: Math.min(drag.y0, drag.y1),
                  width: Math.abs(drag.x1 - drag.x0),
                  height: Math.abs(drag.y1 - drag.y0),
                }}
              />
            )}
          </div>
        )}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImagePicked(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Annotation renderer (rect / text / mark / image)                    */
/* ------------------------------------------------------------------ */

function AnnoView({
  a,
  scale,
  heightPt,
  tool,
  onUpdate,
  onRemove,
}: {
  a: Annotation;
  scale: number;
  heightPt: number;
  tool: Tool;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onRemove: (id: string) => void;
}) {
  const selectable = tool === "select";

  const deletable = (children: React.ReactNode, box: React.CSSProperties) => (
    <div
      className="group absolute"
      style={{ ...box, pointerEvents: selectable ? "auto" : "none" }}
    >
      {children}
      {selectable && (
        <button
          onClick={() => onRemove(a.id)}
          className="absolute -right-2 -top-2 hidden h-5 w-5 place-items-center rounded-full bg-danger text-[11px] font-bold text-white shadow group-hover:grid"
          title="Delete"
        >
          ×
        </button>
      )}
    </div>
  );

  switch (a.kind) {
    case "highlight":
      return deletable(
        <div
          className="h-full w-full"
          style={{ background: a.color, opacity: 0.4, mixBlendMode: "multiply" }}
        />,
        rectBox(a, scale, heightPt)
      );
    case "erase":
      return deletable(
        <div className="h-full w-full" style={{ background: "#fff" }} />,
        rectBox(a, scale, heightPt)
      );
    case "redact":
      return deletable(
        <div className="h-full w-full" style={{ background: "#000" }} />,
        rectBox(a, scale, heightPt)
      );
    case "image":
      return deletable(
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.dataUrl} alt="" className="h-full w-full object-contain" />,
        rectBox(a, scale, heightPt)
      );
    case "mark":
      return deletable(
        <span
          style={{
            fontSize: a.size * scale,
            lineHeight: 1,
            color: a.glyph === "✓" ? "#16a34a" : "#dc2626",
            fontWeight: 700,
          }}
        >
          {a.glyph}
        </span>,
        {
          left: a.x * scale,
          top: (heightPt - a.y) * scale - a.size * scale * 0.8,
        }
      );
    case "text":
      return (
        <TextAnno
          a={a}
          scale={scale}
          heightPt={heightPt}
          tool={tool}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      );
    default:
      return null;
  }
}

function TextAnno({
  a,
  scale,
  heightPt,
  tool,
  onUpdate,
  onRemove,
}: {
  a: Extract<Annotation, { kind: "text" }>;
  scale: number;
  heightPt: number;
  tool: Tool;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onRemove: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // focus a freshly-created (empty) text box
  useEffect(() => {
    if (a.text === "") ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editable = tool === "text" || tool === "select";
  const fontPx = a.size * scale;
  return (
    <div
      ref={ref}
      contentEditable={editable}
      suppressContentEditableWarning
      onBlur={(e) => {
        const t = e.currentTarget.textContent ?? "";
        if (!t.trim()) onRemove(a.id);
        else if (t !== a.text) onUpdate(a.id, { text: t });
      }}
      className="absolute whitespace-pre outline-none"
      style={{
        left: a.x * scale,
        top: (heightPt - a.y) * scale - fontPx,
        fontSize: fontPx,
        lineHeight: 1.1,
        color: a.color,
        minWidth: 8,
        pointerEvents: editable ? "auto" : "none",
        outline: tool === "text" ? "1px dashed #94a3b8" : undefined,
        cursor: "text",
      }}
    >
      {a.text}
    </div>
  );
}

function rectBox(
  a: Extract<Annotation, { x: number; y: number; w: number; h: number }>,
  scale: number,
  heightPt: number
): React.CSSProperties {
  return {
    left: a.x * scale,
    top: (heightPt - (a.y + a.h)) * scale,
    width: a.w * scale,
    height: a.h * scale,
  };
}

/* ------------------------------------------------------------------ */
/* Canvas host — mounts the raster <canvas> produced by pdf.js         */
/* ------------------------------------------------------------------ */

function CanvasHost({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren();
    if (canvas) el.appendChild(canvas);
  }, [canvas]);
  return <div ref={ref} className="absolute inset-0" />;
}

/**
 * Choose the CSS font for a run. Weight/style come from pdf.js's own font
 * metadata (derived from the real base-font name and descriptor flags), not a
 * regex on the internal loadedName — so bold/italic survive even when the
 * document's embedded FontFace can't be loaded. The embedded FontFace is
 * registered at this same weight/style, so requesting it is an exact match
 * (no synthetic bolding); family matching for the fallback uses the real name.
 */
function cssFont(
  run: { fontName: string; realFontName: string; bold: boolean; italic: boolean; black: boolean },
  fontFamilies: Record<string, string>
): {
  fontFamily: string;
  fontWeight: number;
  fontStyle: "normal" | "italic";
} {
  const weight = run.black ? 900 : run.bold ? 700 : 400;
  const style: "normal" | "italic" = run.italic ? "italic" : "normal";

  const n = (run.realFontName || run.fontName || "").toLowerCase();
  let fallback = "Helvetica, Arial, sans-serif";
  if (/times|serif|roman|georgia|minion/.test(n)) fallback = "'Times New Roman', Georgia, serif";
  else if (/courier|mono|consol/.test(n)) fallback = "'Courier New', monospace";

  const embedded = fontFamilies[run.fontName];
  if (embedded) {
    // List the real font name as a secondary in case our copy is missing a
    // glyph the typed character needs.
    return {
      fontFamily: `"${embedded}", "${run.realFontName}", ${fallback}`,
      fontWeight: weight,
      fontStyle: style,
    };
  }
  return {
    fontFamily: `"${run.realFontName}", "${run.fontName}", ${fallback}`,
    fontWeight: weight,
    fontStyle: style,
  };
}
