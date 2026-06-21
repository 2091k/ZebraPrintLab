import {
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { useAnchoredPosition } from "../../hooks/useAnchoredPosition";
import { Tooltip } from "../ui/Tooltip";
import { useT } from "../../lib/useT";
import { useLabelStore } from "../../store/labelStore";
import {
  CLOCK_TOKEN_LABELS,
  clockMarkerBody,
  formatClockLabel,
  type ClockChannel,
} from "../../lib/fcTemplate";
import { applyClockOffset, clockOffsetIsEmpty, type ClockOffset } from "../../types/LabelConfig";
import {
  findAtomicMarker,
  findMarkerContaining,
  tokeniseMarkers,
  type MarkerSegment,
} from "../../lib/markerTokens";
import {
  domToPlainText,
  findCaretPosition,
  getCaretOffset,
} from "../../lib/contentEditableCaret";
import { getVariableSource } from "../../lib/variableBinding";
import { extractTemplateRefs, capLiteralLength, literalInsertRoom } from "../../lib/fnTemplate";
import { MagnifyingGlassIcon } from "@heroicons/react/16/solid";
import { nextDefaultVariableName, nextFreeFnNumber, type Variable } from "../../types/Variable";

/** Caret offset within `editor`, or null when selection isn't inside it. */
function caretOffsetIn(
  editor: HTMLElement,
  sel: Selection | null,
  which: "anchor" | "focus" = "anchor",
): number | null {
  if (!sel || sel.rangeCount === 0) return null;
  const node = which === "anchor" ? sel.anchorNode : sel.focusNode;
  const offset = which === "anchor" ? sel.anchorOffset : sel.focusOffset;
  if (!node || !editor.contains(node)) return null;
  return getCaretOffset(editor, node, offset);
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** User input only; marker insertions skip sanitise. */
  sanitise?: (raw: string) => string;
  placeholder?: string;
  maxLength?: number;
  /** Scopes editorFocusRequest so only the matching editor focuses. */
  objectId?: string;
  /** False for single-line restricted-charset fields. */
  multiline?: boolean;
  /** When set, the {x} menu offers a "Whole field" mode that binds the entire
   *  field to the picked variable (single-bind) instead of inserting a token. */
  onBindWhole?: (variableName: string) => void;
}

/** contenteditable div with coloured marker spans. Parent owns canonical
 *  plain string; useLayoutEffect rebuilds DOM and restores caret offset. */
const SHARED_CLS =
  "w-full min-h-[1.75rem] bg-surface-2 border border-border rounded px-2 py-1 text-xs font-mono leading-6 whitespace-pre-wrap break-words focus:border-accent focus:outline-none";

// Token chip pills. Variable/clock render as atomic widgets (see segmentsToHTML)
// so the chip can drop the raw `«»` syntax; orphan stays inline-editable text so
// a typo'd marker can be fixed in place. indigo = variable, cyan = clock,
// amber = orphan (soft warning).
const CHIP_BASE = "group inline-flex items-center align-[-3px] rounded-[3px] border px-1 select-none";
const VAR_CLS = `${CHIP_BASE} border-indigo/60 bg-indigo-dim text-indigo`;
const CLOCK_CLS = `${CHIP_BASE} border-info/60 bg-info/15 text-info`;
const ORPHAN_CLS = "rounded-[3px] border border-warning/60 bg-warning/10 px-1 text-warning";
const ZPL_SUB_CLS = "ml-0.5 text-[9px] text-muted/70";

// {x} menu group header (Variablen / Datum & Uhrzeit).
const MENU_HEADER_CLS = "font-mono text-[9px] font-semibold uppercase tracking-wider text-muted";

// Clock glyph; stroke=currentColor so the parent's text-info drives the cyan.
const CLOCK_GLYPH = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    className="inline-block align-[-2px]"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8V8l2.2 1.4" strokeLinecap="round" />
  </svg>
);

// Hover-revealed remove control inside a chip; data-chip-remove is handled by
// a delegated mousedown listener on the editor (atomic marker removal).
const removeBtn = (label: string): string =>
  `<button type="button" data-chip-remove tabindex="-1" contenteditable="false" aria-label="${escapeAttr(label)}" class="ml-0.5 -mr-0.5 leading-none opacity-0 group-hover:opacity-100 focus:opacity-100 hover:opacity-100 cursor-pointer transition-opacity">×</button>`;

// Inline so `currentColor` (the chip's cyan) drives the stroke in both themes;
// it lives inside a data-m widget, so it never enters the editor's plain text.
const CLOCK_ICON =
  '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="inline-block mr-0.5 shrink-0" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 5V8l2 1.3"/></svg>';

interface ChipDeco {
  /** showZplCommands: appends the chip's ^FN/^FC code. */
  show: boolean;
  fnByName: ReadonlyMap<string, number>;
  /** Localised clock label for a marker body like `clock:Y` / `clock2:m`. */
  clockLabel: (body: string) => string;
  /** aria-label for the per-chip remove button. */
  removeLabel: string;
}

/** Variable/clock chips are atomic widgets: the canonical `«…»` lives in
 *  `data-m` (read back by domToPlainText) while the visible content drops the
 *  raw syntax. Trailing `<br>` gives Chrome a caret target on the empty last
 *  line; domToPlainText strips it symmetrically. */
function segmentsToHTML(segments: MarkerSegment[], deco: ChipDeco): string {
  const parts: string[] = [];
  for (const s of segments) {
    if (s.kind === "text") {
      const lines = s.text.split("\n");
      lines.forEach((line, i) => {
        if (i > 0) parts.push("<br>");
        if (line !== "") parts.push(escapeHTML(line));
      });
      continue;
    }
    if (s.kind === "orphan") {
      parts.push(`<span class="${ORPHAN_CLS}">${escapeHTML(s.text)}</span>`);
      continue;
    }
    const body = s.text.slice(1, -1);
    const dm = `data-m="${escapeAttr(s.text)}" contenteditable="false"`;
    const x = removeBtn(deco.removeLabel);
    if (s.kind === "var") {
      const fn = deco.show ? deco.fnByName.get(body) : undefined;
      const zpl = fn !== undefined ? `<span class="${ZPL_SUB_CLS}">^FN${fn}</span>` : "";
      parts.push(`<span class="${VAR_CLS}" ${dm}>${escapeHTML(body)}${zpl}${x}</span>`);
    } else {
      const zpl = deco.show ? `<span class="${ZPL_SUB_CLS}">^FC</span>` : "";
      parts.push(
        `<span class="${CLOCK_CLS}" ${dm}>${CLOCK_ICON}${escapeHTML(deco.clockLabel(body))}${zpl}${x}</span>`,
      );
    }
  }
  // Trailing newline anchor (stripped by domToPlainText). Skip it when empty so
  // the editor stays `:empty` and the CSS placeholder can render.
  if (parts.length > 0) parts.push("<br>");
  return parts.join("");
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function TemplateContentInput({
  value,
  onChange,
  sanitise,
  placeholder,
  maxLength,
  objectId,
  multiline = true,
  onBindWhole,
}: Props) {
  const t = useT();
  const variables = useLabelStore((s) => s.variables);
  const showZpl = useLabelStore((s) => s.showZplCommands);
  const editorFocusRequest = useLabelStore((s) => s.editorFocusRequest);
  const secondaryOffset = useLabelStore((s) => s.label.secondaryClockOffset);
  const tertiaryOffset = useLabelStore((s) => s.label.tertiaryClockOffset);
  const setLabelConfig = useLabelStore((s) => s.setLabelConfig);
  const csvDataset = useLabelStore((s) => s.csvDataset);
  const csvMapping = useLabelStore((s) => s.csvMapping);
  const addVariable = useLabelStore((s) => s.addVariable);
  const [channel, setChannel] = useState<ClockChannel>(1);
  // {x} menu action: insert tokens (build a template) vs bind the whole field
  // to one variable (single-bind / switch). Only meaningful when onBindWhole.
  const [menuMode, setMenuMode] = useState<"insert" | "bind">("insert");
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [search, setSearch] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const [open, setOpen] = useState(false);
  // Bumped to force the rebuild effect when a sanitiser/cap rejects an edit
  // back to the current value (no value change, but stale chars in the DOM).
  const [resyncNonce, setResyncNonce] = useState(0);
  // Menu is portaled to body so the sidebar's overflow clip and stacking
  // context can't hide it; anchor it to the field rect (fixed coords).
  const menuPos = useAnchoredPosition(rootRef, open, (r) => ({
    top: r.bottom + 4,
    right: window.innerWidth - r.right,
  }));

  const variableNames = new Set(variables.map((v: Variable) => v.name));
  const segments = tokeniseMarkers(value, variableNames);

  // Skip rebuild when DOM plain text already matches; avoids clobbering caret.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const deco: ChipDeco = {
      show: showZpl,
      fnByName: new Map(variables.map((v: Variable) => [v.name, v.fnNumber])),
      clockLabel: (body: string) => formatClockLabel(body, (k) => t.app[k]),
      removeLabel: t.variables.unbindAria,
    };
    const currentText = domToPlainText(editor);
    if (currentText === value) {
      // Classification may shift (new variable defined elsewhere).
      const desired = segmentsToHTML(segments, deco);
      if (editor.innerHTML === desired) return;
    }
    const caretOffset = caretOffsetIn(editor, window.getSelection());
    editor.innerHTML = segmentsToHTML(segments, deco);
    if (caretOffset !== null && document.activeElement === editor) {
      const selAfter = window.getSelection();
      if (selAfter) {
        const pos = findCaretPosition(editor, caretOffset);
        const range = document.createRange();
        range.setStart(pos.node, pos.offset);
        range.collapse(true);
        selAfter.removeAllRanges();
        selAfter.addRange(range);
      }
    }
  }, [value, segments, showZpl, variables, t, resyncNonce]);

  // External focus request (canvas dblclick): focus + selectAll for rename.
  useEffect(() => {
    if (!editorFocusRequest || editorFocusRequest.id !== objectId) return;
    const editor = editorRef.current;
    if (!editor) return;
    if (document.activeElement === editor) return;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editorFocusRequest, objectId]);

  // Click-outside + Esc close. Mounted only while the {x} menu is open.
  // The menu lives in a body portal, so it counts as "inside" too.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target))
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const restoreCaret = (offset: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const pos = findCaretPosition(editor, offset);
    const range = document.createRange();
    range.setStart(pos.node, pos.offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  /** React-event path; microtask defers caret restore after React render. */
  const commit = (next: string, nextCaret: number) => {
    onChange(next);
    queueMicrotask(() => restoreCaret(nextCaret));
  };

  const getCaretOffsetInEditor = (): number => {
    const editor = editorRef.current;
    if (!editor) return value.length;
    return caretOffsetIn(editor, window.getSelection()) ?? value.length;
  };

  const insertMarker = (markerBody: string) => {
    const editor = editorRef.current;
    const marker = `«${markerBody}»`;
    const start = getCaretOffsetInEditor();
    const end = editor
      ? (caretOffsetIn(editor, window.getSelection(), "focus") ?? start)
      : start;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const next = value.slice(0, lo) + marker + value.slice(hi);
    setOpen(false);
    commit(next, lo + marker.length);
  };

  // React 19 onBeforeInput is unreliable on contenteditable; native listener
  // with latest-state ref so closure stays stable.
  const stateRef = useRef({ value, onChange, sanitise, maxLength, multiline });
  useLayoutEffect(() => {
    stateRef.current = { value, onChange, sanitise, maxLength, multiline };
  });

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    /** Sync render+restore so follow-up keys land on the rebuilt DOM. */
    const commitInline = (next: string, nextCaret: number) => {
      flushSync(() => stateRef.current.onChange(next));
      restoreCaret(nextCaret);
    };
    const selectionRange = (fallbackLen: number) => {
      const sel = window.getSelection();
      const start = caretOffsetIn(editor, sel, "anchor") ?? fallbackLen;
      const end = caretOffsetIn(editor, sel, "focus") ?? start;
      return { lo: Math.min(start, end), hi: Math.max(start, end) };
    };
    /** Delete the whole `«...»` marker atomically rather than eroding mid-token. */
    const handleAtomicDelete = (direction: "backspace" | "delete") => {
      const { value } = stateRef.current;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
      const caret = caretOffsetIn(editor, sel);
      if (caret === null) return false;
      const m = findAtomicMarker(value, caret, direction);
      if (!m) return false;
      commitInline(value.slice(0, m.start) + value.slice(m.end), m.start);
      return true;
    };
    const handleParagraph = () => {
      const { value } = stateRef.current;
      const { lo, hi } = selectionRange(value.length);
      commitInline(value.slice(0, lo) + "\n" + value.slice(hi), lo + 1);
    };
    /** ClipboardEvent for cross-engine plain-text paste; FF/Safari lack
     *  dataTransfer on beforeinput insertFromPaste. */
    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const { value, sanitise, maxLength } = stateRef.current;
      const data = e.clipboardData?.getData("text/plain") ?? "";
      if (!data) return;
      const clean = sanitise ? sanitise(data) : data;
      const { lo, hi } = selectionRange(value.length);
      const room = literalInsertRoom(value, hi - lo, clean, maxLength);
      const toInsert = room === Infinity ? clean : clean.slice(0, room);
      commitInline(value.slice(0, lo) + toInsert + value.slice(hi), lo + toInsert.length);
    };
    /** Per-chip ✕: remove that marker atomically. mousedown (not click) so we
     *  preventDefault before the browser moves the caret into the widget. */
    const handleChipRemove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-chip-remove]")) return;
      const widget = target.closest("[data-m]");
      if (!widget || widget.parentNode !== editor) return;
      e.preventDefault();
      const dm = widget.getAttribute("data-m") ?? "";
      const idx = Array.prototype.indexOf.call(editor.childNodes, widget);
      const start = getCaretOffset(editor, editor, idx);
      const { value } = stateRef.current;
      commitInline(value.slice(0, start) + value.slice(start + dm.length), start);
    };
    const handler = (e: InputEvent) => {
      if (composingRef.current) return;
      switch (e.inputType) {
        case "historyUndo":
        case "historyRedo":
          // Drop browser undo/redo; zundo owns history.
          e.preventDefault();
          return;
        case "insertParagraph":
          // Single-line drops Enter; sanitise would otherwise flicker a stray <br>.
          e.preventDefault();
          if (stateRef.current.multiline) handleParagraph();
          return;
        case "deleteContentBackward":
        case "deleteContentForward": {
          const direction = e.inputType === "deleteContentBackward" ? "backspace" : "delete";
          if (handleAtomicDelete(direction)) e.preventDefault();
          return;
        }
      }
    };
    editor.addEventListener("beforeinput", handler);
    editor.addEventListener("paste", handlePaste);
    editor.addEventListener("mousedown", handleChipRemove);
    return () => {
      editor.removeEventListener("beforeinput", handler);
      editor.removeEventListener("paste", handlePaste);
      editor.removeEventListener("mousedown", handleChipRemove);
    };
  }, []);

  const onInput = () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (composingRef.current) return;
    const raw = domToPlainText(editor);
    let next = raw;
    if (sanitise) next = sanitise(next);
    next = capLiteralLength(next, maxLength);
    if (next === value) {
      // Sanitiser/cap rejected the edit back to the current value: the DOM
      // still shows the rejected chars, so force a rebuild to the canonical.
      if (raw !== next) setResyncNonce((n) => n + 1);
      return;
    }
    onChange(next);
  };

  const onCompositionEnd = () => {
    composingRef.current = false;
    onInput();
  };

  /** Select the whole `«...»` instead of word-boundary fragment. */
  const onDoubleClick = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const caret = getCaretOffsetInEditor();
    const m = findMarkerContaining(value, caret);
    if (!m) return;
    const startPos = findCaretPosition(editor, m.start);
    const endPos = findCaretPosition(editor, m.end);
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const isEmpty = value.length === 0;
  const inBindMode = !!onBindWhole && menuMode === "bind";
  // Variables already placed in this field (marker refs / single-bind chip).
  const usedNames = new Set(extractTemplateRefs(value));
  const q = search.trim().toLowerCase();
  const shownVars = q
    ? variables.filter((v) => v.name.toLowerCase().includes(q))
    : variables;
  const channelOffset =
    channel === 2 ? secondaryOffset : channel === 3 ? tertiaryOffset : undefined;
  const channelName =
    channel === 1
      ? t.app.clockChannelPrimary
      : channel === 2
        ? t.app.clockChannelSecondary
        : t.app.clockChannelTertiary;

  /** CSV column (accent) when mapped, else the muted default value preview. */
  const previewFor = (v: Variable): { text: string; cls: string } => {
    if (getVariableSource(v, csvDataset, csvMapping) === "csv") {
      return { text: `${csvMapping?.bindings[v.id]} · CSV`, cls: "text-accent" };
    }
    return { text: v.defaultValue ? `"${v.defaultValue}"` : "", cls: "text-muted" };
  };

  // Hide "new variable" when no ^FN slot is free, so the create can't be a
  // silent no-op (addVariable would return null).
  const slotsLeft = nextFreeFnNumber(variables.map((v) => v.fnNumber)) !== null;

  const createAndInsert = () => {
    const id = addVariable({ name: nextDefaultVariableName(variables) });
    if (!id) return;
    const created = useLabelStore.getState().variables.find((v) => v.id === id);
    if (created) insertMarker(created.name);
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={multiline}
        aria-label={placeholder ?? t.app.insertVariable}
        data-placeholder={isEmpty ? placeholder : undefined}
        spellCheck={false}
        className={`${SHARED_CLS} relative block caret-text empty:before:content-[attr(data-placeholder)] empty:before:text-muted empty:before:pointer-events-none`}
        onInput={onInput}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={onCompositionEnd}
        onDoubleClick={onDoubleClick}
      />
      <Tooltip className="self-start" content={t.app.insertVariable}>
        <button
          type="button"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface border border-border text-muted hover:text-text hover:border-accent transition-colors"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            if (!open) setMenuMode("insert");
            setOpen((o) => !o);
          }}
        >
          {"{x}"}
          <span>{t.app.insertVariable}</span>
        </button>
      </Tooltip>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-[17rem] overflow-y-auto rounded border border-border bg-surface shadow-lg"
          style={{
            top: menuPos.top,
            right: menuPos.right,
            // Cap to the space below the trigger so a tall menu scrolls
            // internally instead of overflowing the viewport (it is fixed);
            // keep a usable floor when the field sits near the bottom.
            maxHeight: Math.max(120, Math.min(448, window.innerHeight - menuPos.top - 8)),
          }}
        >
          {/* Named mode: insert tokens (build a template) vs bind the whole
              field to one variable (single-bind / switch). */}
          {onBindWhole && variables.length > 0 && (
            <div className="flex gap-1 p-1.5 border-b border-border bg-surface-2/50">
              {(["insert", "bind"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`flex-1 px-2 py-1 rounded text-[10px] font-mono transition-colors ${
                    menuMode === mode
                      ? "bg-accent text-bg"
                      : "text-muted hover:text-text hover:bg-surface-2"
                  }`}
                  onClick={() => setMenuMode(mode)}
                >
                  {mode === "insert" ? t.variableField.xInsert : t.variableField.xBindWhole}
                </button>
              ))}
            </div>
          )}

          {/* Variables: dot + name + value/source preview + "in field" + ^FN. */}
          <div className="py-1.5">
            <div className={`px-2 pb-1 ${MENU_HEADER_CLS}`}>
              {inBindMode ? t.variableField.bindWholeField : t.variableField.groupVariables}
            </div>
            {variables.length > 5 && (
              <div className="relative mx-2 mb-1">
                <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted pointer-events-none" />
                <input
                  className="w-full bg-surface-2 border border-border rounded pl-7 pr-2 py-1 text-[11px] font-mono text-text focus:border-accent focus:outline-none"
                  placeholder={t.variableField.searchVariable}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
            {shownVars.map((v) => {
              const pv = previewFor(v);
              return (
                <button
                  key={v.id}
                  type="button"
                  className="flex items-center gap-2 w-full text-left px-2 py-1 hover:bg-surface-2 transition-colors"
                  onClick={() => {
                    if (inBindMode && onBindWhole) {
                      onBindWhole(v.name);
                      setOpen(false);
                    } else {
                      insertMarker(v.name);
                    }
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-sm bg-indigo shrink-0" />
                  <span className="text-xs font-mono text-text shrink-0">{v.name}</span>
                  {pv.text && (
                    <span className={`flex-1 min-w-0 truncate text-[10px] font-mono ${pv.cls}`}>
                      {pv.text}
                    </span>
                  )}
                  {usedNames.has(v.name) && (
                    <span className="ml-auto shrink-0 text-[8.5px] font-mono text-muted/70 border border-border rounded px-1">
                      {t.variableField.inField}
                    </span>
                  )}
                  {showZpl && (
                    <span className="shrink-0 text-[9px] font-mono text-muted/70">^FN{v.fnNumber}</span>
                  )}
                </button>
              );
            })}
            {!inBindMode && slotsLeft && (
              <button
                type="button"
                className="flex items-center gap-2 w-full text-left px-2 py-1 text-muted hover:text-text hover:bg-surface-2 transition-colors"
                onClick={createAndInsert}
              >
                <span className="w-1.5 flex justify-center text-sm leading-none">+</span>
                <span className="text-xs">{t.variables.createNew}</span>
              </button>
            )}
          </div>

          {/* Date & time (insert mode only): label-first, raw token gated. */}
          {!inBindMode && (
            <div className="border-t border-border py-1.5">
              <div className="flex items-center gap-2 px-2 pb-1.5">
                <span className={MENU_HEADER_CLS}>{t.variableField.groupDateTime}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <span className="text-[10px] text-muted">{t.variableField.channelLabel}</span>
                  <button
                    type="button"
                    className="flex items-center gap-1 bg-surface-2 border border-border rounded px-2 py-0.5 text-[11px] text-text hover:border-accent transition-colors"
                    onClick={() => {
                      setChannel((c) => (((c % 3) + 1) as ClockChannel));
                      setOffsetOpen(false);
                    }}
                  >
                    {channelName}
                    <span className="text-muted text-[9px]">▾</span>
                  </button>
                </span>
              </div>

              {channel !== 1 && (
                <div className="mx-2 mb-1.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 rounded border border-info/35 bg-info/10 px-2 py-1.5">
                    <span className="text-info shrink-0">{CLOCK_GLYPH}</span>
                    <span className="flex-1 min-w-0 text-[11px] text-text">
                      {t.variableField.offsetSummary}:{" "}
                      <span className="text-info">{offsetSummaryText(channelOffset, t)}</span>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-muted underline hover:text-text transition-colors"
                      onClick={() => setOffsetOpen((o) => !o)}
                    >
                      {offsetOpen ? t.variableField.offsetClose : t.variableField.offsetEdit}
                    </button>
                  </div>
                  {offsetOpen && (
                    <ClockOffsetEditor
                      channel={channel === 2 ? 2 : 3}
                      value={channelOffset}
                      onChange={(next) =>
                        setLabelConfig(
                          channel === 2
                            ? { secondaryClockOffset: next }
                            : { tertiaryClockOffset: next },
                        )
                      }
                      t={t}
                    />
                  )}
                </div>
              )}

              {CLOCK_TOKEN_LABELS.map(({ token, labelKey }) => (
                <button
                  key={token}
                  type="button"
                  className="flex items-center gap-2 w-full text-left px-2 py-1 hover:bg-surface-2 transition-colors"
                  onClick={() => insertMarker(clockMarkerBody(channel, token))}
                >
                  <span className="text-info shrink-0">{CLOCK_GLYPH}</span>
                  <span className="flex-1 min-w-0 text-xs text-text">{t.app[labelKey]}</span>
                  {showZpl && (
                    <span className="shrink-0 text-[9px] font-mono text-muted/70">^FC</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {inBindMode && (
            <div className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted">
              {t.variableField.singleHint}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

const hasNonZero = (o: ClockOffset | undefined): boolean => !!o && !clockOffsetIsEmpty(o);

/** Short "+2 Jahre · +3 Tage" summary of a channel's offset for the collapsed
 *  row; "0" when empty. */
function offsetSummaryText(
  offset: ClockOffset | undefined,
  t: ReturnType<typeof useT>,
): string {
  if (!offset) return "0";
  const parts = OFFSET_FIELDS.filter(({ key }) => offset[key]).map(
    ({ key, labelKey }) => `+${offset[key]} ${t.app[labelKey]}`,
  );
  return parts.length ? parts.join(" · ") : "0";
}

interface OffsetEditorProps {
  channel: 2 | 3;
  value: ClockOffset | undefined;
  onChange: (next: ClockOffset | undefined) => void;
  t: ReturnType<typeof useT>;
}

const OFFSET_FIELDS = [
  { key: "years", labelKey: "clockOffsetYears" },
  { key: "months", labelKey: "clockOffsetMonths" },
  { key: "days", labelKey: "clockOffsetDays" },
  { key: "hours", labelKey: "clockOffsetHours" },
  { key: "minutes", labelKey: "clockOffsetMinutes" },
  { key: "seconds", labelKey: "clockOffsetSeconds" },
] as const satisfies readonly { key: keyof ClockOffset; labelKey: string }[];

const QUICK_SETS = [
  { labelKey: "clockOffsetPlus1Month", offset: { months: 1 } },
  { labelKey: "clockOffsetPlus3Months", offset: { months: 3 } },
  { labelKey: "clockOffsetPlus6Months", offset: { months: 6 } },
  { labelKey: "clockOffsetPlus1Year", offset: { years: 1 } },
  { labelKey: "clockOffsetPlus2Years", offset: { years: 2 } },
] as const satisfies readonly { labelKey: string; offset: ClockOffset }[];

function ClockOffsetEditor({ channel, value, onChange, t }: OffsetEditorProps) {
  const v = value ?? {};
  const headingKey = channel === 2
    ? "clockOffsetSecondaryHeading"
    : "clockOffsetTertiaryHeading";
  // Local draft buffer so intermediate states like "-" or "" don't
  // collapse to undefined and clear the input mid-typing.
  const externalText = (key: keyof ClockOffset) => v[key]?.toString() ?? "";
  const [draft, setDraft] = useState<Partial<Record<keyof ClockOffset, string>>>({});
  const [lastExternal, setLastExternal] = useState<Partial<Record<keyof ClockOffset, string>>>({});
  const currentExternal: Partial<Record<keyof ClockOffset, string>> = {
    years: externalText("years"), months: externalText("months"), days: externalText("days"),
    hours: externalText("hours"), minutes: externalText("minutes"), seconds: externalText("seconds"),
  };
  // Resync the draft when the external offset changes. This is React's
  // "adjusting state during render" pattern (guarded same-component setState,
  // no extra commit); a useEffect here would flash the stale draft for a frame.
  if (
    OFFSET_FIELDS.some(({ key }) => lastExternal[key] !== currentExternal[key])
  ) {
    setLastExternal(currentExternal);
    setDraft(currentExternal);
  }
  const update = (key: keyof ClockOffset, raw: string) => {
    setDraft((d) => ({ ...d, [key]: raw }));
    // Empty or sign-only stays in the draft; don't commit yet.
    if (raw === "" || raw === "-") {
      const next = { ...v, [key]: undefined };
      const allZero = Object.values(next).every((x) => x === undefined || x === 0);
      onChange(allZero ? undefined : next);
      return;
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    const next = { ...v, [key]: n === 0 ? undefined : n };
    const allZero = Object.values(next).every((x) => x === undefined || x === 0);
    onChange(allZero ? undefined : next);
  };
  const preview = hasNonZero(value)
    ? applyClockOffset(new Date(), value).toISOString().replace("T", " ").slice(0, 19)
    : null;
  return (
    <div className="border-t border-border bg-surface-2/30 px-2 py-2 flex flex-col gap-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted">
        {t.app[headingKey]}
        <span className="ml-1 text-muted/60">^SO{channel}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {OFFSET_FIELDS.map(({ key, labelKey }) => (
          <label key={key} className="flex flex-col gap-0.5">
            <span className="text-[9px] font-mono uppercase tracking-wider text-muted/70">
              {t.app[labelKey]}
            </span>
            <input
              type="number"
              className="w-full bg-surface border border-border rounded px-1.5 py-0.5 text-xs font-mono text-text focus:border-accent focus:outline-none"
              value={draft[key] ?? ""}
              placeholder="0"
              onChange={(e) => update(key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {QUICK_SETS.map(({ labelKey, offset }) => (
          <button
            key={labelKey}
            type="button"
            className="px-1.5 py-0.5 text-[10px] font-mono border border-border rounded text-muted hover:text-text hover:border-accent transition-colors"
            onClick={() => onChange(offset)}
          >
            {t.app[labelKey]}
          </button>
        ))}
        <button
          type="button"
          className="px-1.5 py-0.5 text-[10px] font-mono border border-border rounded text-muted hover:text-error hover:border-error transition-colors"
          onClick={() => onChange(undefined)}
        >
          {t.app.clockOffsetClear}
        </button>
      </div>
      {preview && (
        <div className="text-[10px] font-mono text-muted">
          {t.app.clockOffsetPreview}: <span className="text-text">{preview}</span>
        </div>
      )}
    </div>
  );
}
