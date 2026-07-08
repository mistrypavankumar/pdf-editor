"use client";

import React from "react";
import type { Tool } from "@/lib/types";

interface ToolDef {
  tool: Tool;
  label: string;
  icon: React.ReactNode;
}

const GROUP_A: ToolDef[] = [
  { tool: "select", label: "Selection", icon: <SelectionIcon /> },
  { tool: "editpdf", label: "Edit PDF", icon: <EditIcon /> },
  { tool: "sign", label: "Sign", icon: <SignIcon /> },
];
const GROUP_B: ToolDef[] = [
  { tool: "text", label: "Text", icon: <TextIcon /> },
  { tool: "erase", label: "Erase", icon: <EraseIcon /> },
  { tool: "highlight", label: "Highlight", icon: <HighlightIcon /> },
  { tool: "redact", label: "Redact", icon: <RedactIcon /> },
];
const GROUP_C: ToolDef[] = [
  { tool: "image", label: "Image", icon: <ImageIcon /> },
  { tool: "draw", label: "Draw", icon: <DrawIcon /> },
  { tool: "cross", label: "Cross", icon: <CrossIcon /> },
  { tool: "check", label: "Check", icon: <CheckMarkIcon /> },
];

export function Toolbar({
  tool,
  setTool,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  disabled,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  disabled: boolean;
}) {
  const btn = (d: ToolDef) => {
    const active = tool === d.tool;
    return (
      <button
        key={d.tool}
        onClick={() => setTool(d.tool)}
        disabled={disabled}
        className={`flex w-16 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition disabled:opacity-30 ${
          active
            ? "bg-accent-soft text-accent"
            : "text-ink hover:bg-canvas"
        }`}
      >
        <span className="grid h-6 w-6 place-items-center">{d.icon}</span>
        {d.label}
      </button>
    );
  };

  return (
    <div className="flex h-[74px] shrink-0 items-center gap-3 border-b border-line bg-white px-4">
      {/* undo / redo */}
      <div className="flex items-center gap-1">
        <HistBtn label="Undo" onClick={onUndo} disabled={disabled || !canUndo}>
          <UndoIcon />
        </HistBtn>
        <HistBtn label="Redo" onClick={onRedo} disabled={disabled || !canRedo}>
          <RedoIcon />
        </HistBtn>
      </div>

      <Divider />
      <div className="flex items-center gap-1 rounded-xl border border-line px-1.5 py-1">
        {GROUP_A.map(btn)}
      </div>
      <div className="flex items-center gap-1 rounded-xl border border-line px-1.5 py-1">
        {GROUP_B.map(btn)}
      </div>
      <div className="flex items-center gap-1 rounded-xl border border-line px-1.5 py-1">
        {GROUP_C.map(btn)}
      </div>

      <div className="ml-auto text-[11px] text-muted">
        {toolHint(tool)}
      </div>
    </div>
  );
}

function toolHint(tool: Tool): string {
  switch (tool) {
    case "select":
      return "Click annotations to select · drag the page to scroll";
    case "editpdf":
      return "Click any text to edit it — original fonts are preserved";
    case "sign":
      return "Draw your signature on the page";
    case "text":
      return "Click to add a text box";
    case "erase":
      return "Drag over content to white it out";
    case "highlight":
      return "Drag to highlight";
    case "redact":
      return "Drag to redact (permanent black box)";
    case "image":
      return "Drag a box, then choose an image";
    case "draw":
      return "Draw freehand";
    case "cross":
      return "Click to place ✕";
    case "check":
      return "Click to place ✓";
    default:
      return "";
  }
}

function HistBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-12 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium text-ink transition hover:bg-canvas disabled:opacity-30"
    >
      <span className="grid h-6 w-6 place-items-center">{children}</span>
      {label}
    </button>
  );
}

function Divider() {
  return <span className="h-10 w-px bg-line" />;
}

/* ------------------------------------------------------------------ */
/* Icons — 24x24, 1.6 stroke                                           */
/* ------------------------------------------------------------------ */

const S = (p: { d: string; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]">
    <path
      d={p.d}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill={p.fill ? "currentColor" : "none"}
    />
  </svg>
);

function SelectionIcon() {
  return <S d="M5 4l6 15 2-6 6-2z" />;
}
function EditIcon() {
  return <S d="M4 20h4L18 10l-4-4L4 16zM14 6l4 4" />;
}
function SignIcon() {
  return <S d="M4 17c3 0 4-9 6-9s1 6 3 6 3-4 5-4M4 20h16" />;
}
function TextIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]">
      <path
        d="M5 6h11M10.5 6v13M14 11h6M17 11v8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function EraseIcon() {
  return <S d="M7 17l-3-3a2 2 0 010-3l6-6a2 2 0 013 0l4 4a2 2 0 010 3l-5 5H8zM4 20h16" />;
}
function HighlightIcon() {
  return <S d="M9 14l-2 5 5-2 8-8-3-3zM14 6l3 3M4 21h6" />;
}
function RedactIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]">
      <rect
        x="4"
        y="8"
        width="16"
        height="8"
        rx="1"
        fill="currentColor"
      />
    </svg>
  );
}
function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]">
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="9" cy="10" r="1.6" fill="currentColor" />
      <path
        d="M5 17l4-4 3 3 3-4 4 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
function DrawIcon() {
  return <S d="M4 20c0-3 2-4 4-4s2 2 4 2 3-11 5-11 3 4 3 6" />;
}
function CrossIcon() {
  return <S d="M6 6l12 12M18 6L6 18" />;
}
function CheckMarkIcon() {
  return <S d="M5 13l4 4L19 7" />;
}
function UndoIcon() {
  return <S d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-1" />;
}
function RedoIcon() {
  return <S d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h1" />;
}
