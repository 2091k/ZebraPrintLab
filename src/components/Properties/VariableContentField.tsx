import { useState } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";
import { useLabelStore } from "../../store/labelStore";
import { useT } from "../../lib/useT";
import { inputCls } from "./styles";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { TemplateContentInput } from "./TemplateContentInput";
import { getObjectStringContent } from "../../lib/variableBinding";
import { extractClockTokens, clockMarkerBody, formatClockLabel } from "../../lib/fcTemplate";
import type { Variable } from "../../types/Variable";
import {
  type BindableLeaf,
  asLabelObject,
  tokenStringForObject,
  normalizeTokenInput,
  fieldMode,
  fieldVariableRefs,
  fieldTokenSummary,
} from "../../lib/variableField";

interface Props {
  /** Raw object (post Stage-3 PropertiesPanel passes the unpatched obj). */
  obj: BindableLeaf;
  multiline?: boolean;
  sanitise?: (raw: string) => string;
  maxLength?: number;
  placeholder?: string;
  /** Extra prop changes derived from the new content (e.g. text ^FB auto-size). */
  extraPatch?: (content: string) => object;
}

const CREATE_NEW = "__create_new__";

// Quieter than the section headers: the inner labels shouldn't shout in the
// same uppercase as CONTENT.
const SUBLABEL_CLS = "font-mono text-[10px] text-muted/70";

const CLOCK_ICON = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    className="inline-block shrink-0"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8V8l2.2 1.4" strokeLinecap="round" />
  </svg>
);

/**
 * Unified token field for a bindable content prop. Variables are always chips;
 * the field shape decides the emit mode (one known chip = Single-Bind, else
 * Template) via `normalizeTokenInput`, the single writer. A disclosure hosts
 * the whole-field bind action and the per-variable default-value inspector.
 */
export function VariableContentField({
  obj,
  multiline,
  sanitise,
  maxLength,
  placeholder,
  extraPatch,
}: Props) {
  const t = useT();
  const variables = useLabelStore((s) => s.variables);
  const updateObject = useLabelStore((s) => s.updateObject);
  const showZpl = useLabelStore((s) => s.showZplCommands);

  const lo = asLabelObject(obj);
  const tokenValue = tokenStringForObject(lo, variables);
  const mode = fieldMode(lo, variables);
  const summary = fieldTokenSummary(lo, variables);
  const boundVar = obj.variableId ? variables.find((v) => v.id === obj.variableId) : undefined;
  // Token counts in the disclosure header, power-user only (ZPL codes).
  const summaryStr = showZpl
    ? [summary.fn ? `${summary.fn}× ^FN` : null, summary.fc ? `${summary.fc}× ^FC` : null]
        .filter(Boolean)
        .join(" · ")
    : "";

  const handleTokenChange = (next: string) => {
    const out = normalizeTokenInput(next, lo, variables);
    const curContent = getObjectStringContent(lo) ?? "";
    if (out.variableId === obj.variableId && out.content === curContent) return;
    const patch = extraPatch ? extraPatch(out.content) : {};
    updateObject(obj.id, {
      variableId: out.variableId,
      props: { ...patch, content: out.content },
    });
  };

  // {x} "Whole field" mode: bind the entire field to one variable (single-bind).
  const handleBindWhole = (name: string) => {
    const v = variables.find((x) => x.name === name);
    if (!v) return;
    const patch = extraPatch ? extraPatch(v.defaultValue) : {};
    updateObject(obj.id, { variableId: v.id, props: { ...patch, content: v.defaultValue } });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <TemplateContentInput
        objectId={obj.id}
        value={tokenValue}
        onChange={handleTokenChange}
        onBindWhole={handleBindWhole}
        sanitise={sanitise}
        maxLength={maxLength}
        placeholder={placeholder}
        multiline={multiline}
      />

      {/* The UI follows the mode: the chip is the binding, so only render what
          the current mode needs (no var_1 shown four times). */}
      {mode === "single" && boundVar && (
        <div className="flex flex-col gap-1.5">
          <SingleBindDefault
            obj={obj}
            variable={boundVar}
            multiline={multiline ?? true}
            sanitise={sanitise}
            maxLength={maxLength}
            extraPatch={extraPatch}
          />
          <p className="font-mono text-[10px] text-muted leading-relaxed">
            {t.variableField.singleHint}
          </p>
        </div>
      )}

      {mode === "template" && (
        <CollapsibleSection
          id={`varopts-${obj.id}`}
          title={t.variableField.optionsTitle}
          defaultOpen={false}
          annotation={summaryStr || undefined}
        >
          <div className="pt-1">
            <FieldVariableInspector obj={obj} />
          </div>
        </CollapsibleSection>
      )}

      {(mode === "literal" || mode === "empty") && (
        <div className="flex flex-col gap-1.5">
          <BindWholeFieldControl obj={obj} extraPatch={extraPatch} />
          <p className="font-mono text-[10px] text-muted leading-relaxed">
            {t.variableField.literalHint}
          </p>
        </div>
      )}
    </div>
  );
}

/** Single-bind: the whole field is one variable, so the only extra control is
 *  its GLOBAL default value, shown directly (no dropdown, no used-list). For a
 *  text field it is multiline and keeps the object's content mirrored to the
 *  default so the ^FB block re-derives via `extraPatch` (preview sizing). */
function SingleBindDefault({
  obj,
  variable,
  multiline,
  sanitise,
  maxLength,
  extraPatch,
}: {
  obj: BindableLeaf;
  variable: Variable;
  multiline: boolean;
  sanitise?: (raw: string) => string;
  maxLength?: number;
  extraPatch?: (content: string) => object;
}) {
  const t = useT();
  const setBoundDefault = useLabelStore((s) => s.setBoundDefault);
  const onChange = (raw: string) => {
    // The default IS the printed value for a single-bind field, so it obeys the
    // field's charset/length rules (a literal value, no marker exemption).
    let val = sanitise ? sanitise(raw) : raw;
    if (maxLength !== undefined && val.length > maxLength) val = val.slice(0, maxLength);
    // One write: the variable's default AND the mirrored object content (the
    // fallback for unbind, and the ^FB source via extraPatch) in a single
    // undo entry.
    const props = extraPatch ? { ...extraPatch(val), content: val } : { content: val };
    setBoundDefault(variable.id, val, obj.id, { props });
  };
  const cls = `${inputCls}${multiline ? " resize-y min-h-16" : ""}`;
  return (
    <div className="flex flex-col gap-1">
      <span className={SUBLABEL_CLS}>
        {t.variables.defaultLabel} <span className="text-muted/50">· {t.variableField.global}</span>
      </span>
      {multiline ? (
        <textarea
          className={cls}
          aria-label={t.variables.defaultLabel}
          placeholder={t.variables.emptyDefault}
          value={variable.defaultValue}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={cls}
          aria-label={t.variables.defaultLabel}
          placeholder={t.variables.emptyDefault}
          value={variable.defaultValue}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

interface SubProps {
  obj: BindableLeaf;
  extraPatch?: (content: string) => object;
}

/** Pick or create a variable to bind the WHOLE field (canonical single-bind:
 *  variableId set + content replaced by the variable's default). */
function BindWholeFieldControl({ obj, extraPatch }: SubProps) {
  const t = useT();
  const tv = t.variables;
  const variables = useLabelStore((s) => s.variables);
  const updateObject = useLabelStore((s) => s.updateObject);
  const addVariable = useLabelStore((s) => s.addVariable);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const bound = obj.variableId ? variables.find((v) => v.id === obj.variableId) : undefined;

  const bindTo = (variableId: string, content: string) => {
    const patch = extraPatch ? extraPatch(content) : {};
    updateObject(obj.id, { variableId, props: { ...patch, content } });
  };

  const handleSelect = (value: string) => {
    setError(null);
    if (value === "") {
      // Unbind: drop variableId, keep the fallback content as literal text.
      if (obj.variableId) updateObject(obj.id, { variableId: undefined });
      return;
    }
    if (value === CREATE_NEW) {
      setCreating(true);
      setNewName("");
      return;
    }
    const v = variables.find((x) => x.id === value);
    if (v) bindTo(v.id, v.defaultValue);
  };

  const commitCreate = () => {
    const trimmed = newName.trim();
    if (trimmed === "") {
      setError(tv.nameRequired);
      return;
    }
    // Seed the default from the field's current literal so the value carries
    // over into the new variable.
    const defaultValue = getObjectStringContent(asLabelObject(obj)) ?? "";
    const id = addVariable({ name: trimmed, defaultValue });
    if (id === null) {
      setError(variables.some((v) => v.name === trimmed) ? tv.nameInUse : tv.noSlotsLeft);
      return;
    }
    bindTo(id, defaultValue);
    setCreating(false);
    setNewName("");
    setError(null);
  };

  if (creating) {
    return (
      <div className="flex flex-col gap-1">
        <input
          autoFocus
          className={inputCls}
          placeholder={tv.newNamePlaceholder}
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitCreate();
            if (e.key === "Escape") setCreating(false);
          }}
        />
        {error && <p className="font-mono text-[10px] text-amber-400">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={commitCreate}
            className="px-2 py-1 rounded text-xs font-mono bg-accent text-bg hover:opacity-90 transition-opacity"
          >
            {tv.create}
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="px-2 py-1 rounded text-xs font-mono text-muted hover:text-text transition-colors"
          >
            {tv.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className={SUBLABEL_CLS}>{t.variableField.bindWholeField}</span>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <Select<string>
            aria-label={t.variableField.bindWholeField}
            value={bound?.id ?? ""}
            onChange={handleSelect}
            groups={[
              {
                options: [
                  { value: "", label: tv.notBound },
                  ...variables.map((v) => ({ value: v.id, label: v.name })),
                  { value: CREATE_NEW, label: tv.createNew },
                ],
              },
            ]}
          />
        </div>
        {bound && (
          <Tooltip content={tv.unbindAria}>
            <button
              type="button"
              onClick={() => updateObject(obj.id, { variableId: undefined })}
              aria-label={tv.unbindAria}
              className="p-1 rounded text-muted hover:text-amber-400 hover:bg-surface-2 transition-colors"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** Template disclosure body: the field's ^FN variables with their GLOBAL
 *  default (editable), plus clock tokens as a read-only note (they resolve
 *  from the real-time clock, no default). */
function FieldVariableInspector({ obj }: SubProps) {
  const t = useT();
  const variables = useLabelStore((s) => s.variables);
  const updateVariable = useLabelStore((s) => s.updateVariable);
  const lo = asLabelObject(obj);
  const refs = fieldVariableRefs(lo, variables);
  const content = getObjectStringContent(lo) ?? "";
  // Dedupe clock tokens by body so a token used twice lists once.
  const clockBodies = [
    ...new Set(extractClockTokens(content).map((c) => clockMarkerBody(c.channel, c.token))),
  ];

  if (refs.length === 0 && clockBodies.length === 0) {
    return <p className="font-mono text-[10px] text-muted">{t.variableField.noVarsHere}</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {refs.map((v) => (
        <div
          key={v.id}
          className="flex items-center gap-2 rounded border border-border bg-bg px-2 py-1.5"
        >
          <span className="font-mono text-[10px] text-indigo shrink-0">{v.name}</span>
          <input
            className={`${inputCls} flex-1 min-w-0`}
            aria-label={`${v.name} ${t.variables.defaultLabel}`}
            placeholder={t.variables.emptyDefault}
            value={v.defaultValue}
            onChange={(e) => updateVariable(v.id, { defaultValue: e.target.value })}
          />
          <span className="font-mono text-[9px] text-muted/60 border border-border rounded px-1 shrink-0">
            {t.variableField.global}
          </span>
        </div>
      ))}
      {clockBodies.map((body) => (
        <div
          key={body}
          className="flex items-center gap-2 px-2 py-1 font-mono text-[10px] text-muted"
        >
          <span className="inline-flex items-center gap-1 text-info shrink-0">
            {CLOCK_ICON}
            {formatClockLabel(body, (k) => t.app[k])}
          </span>
          <span className="min-w-0">{t.variableField.clockFromRtc}</span>
        </div>
      ))}
    </div>
  );
}
