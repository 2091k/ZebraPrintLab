import { walkObjects, type LabelObject } from "../types/Group";
import type { LabelObjectBase } from "../types/LabelObject";
import type { Variable } from "../types/Variable";
import { getObjectStringContent } from "./variableBinding";
import { extractTemplateRefs } from "./fnTemplate";
import { extractClockTokens } from "./fcTemplate";

/** Any bindable leaf: a base object with a string `content` prop. The registry
 *  panels' narrowed obj types satisfy this structurally; `asLabelObject` is the
 *  one documented seam for passing it to the union-typed helpers below. */
export type BindableLeaf = LabelObjectBase & { props: { content: string } };
export const asLabelObject = (obj: BindableLeaf): LabelObject => obj as unknown as LabelObject;

/**
 * Single source of truth for the unified token field. A bindable field is
 * either Single-Bind (`variableId` set, content is a stale fallback) or
 * Template (`«name»`/`«clock:T»` markers in content). These are mutually
 * exclusive: exactly one known variable chip and nothing else means
 * Single-Bind; anything else means Template. That invariant is the only state
 * shape where preview (`applyBindingToObject`) and export (`fdFieldFor`) agree.
 */

/** Matches a token string that is exactly one marker, no surrounding text. */
const SINGLE_MARKER_RE = /^«([^»]+)»$/;

export type FieldMode = "single" | "template" | "literal" | "empty";

export interface NormalizedTokenInput {
  variableId: string | undefined;
  content: string;
}

/** Edit value for the field: the bound variable as one chip, else raw content
 *  (orphan `variableId` falls through to content so the stale chip vanishes). */
export function tokenStringForObject(
  obj: LabelObject,
  variables: readonly Variable[],
): string {
  const id = obj.variableId;
  if (id) {
    const v = variables.find((x) => x.id === id);
    if (v) return `«${v.name}»`;
  }
  return getObjectStringContent(obj) ?? "";
}

/** Derive the canonical {variableId, content} from an edited token string. */
export function normalizeTokenInput(
  tokenString: string,
  obj: LabelObject,
  variables: readonly Variable[],
): NormalizedTokenInput {
  const m = SINGLE_MARKER_RE.exec(tokenString);
  if (m && m[1] !== undefined) {
    const name = m[1];
    const v = variables.find((x) => x.name === name);
    if (v) {
      // Keep the existing fallback when the binding is unchanged: a no-op edit
      // must not overwrite content with a (possibly newer) defaultValue, which
      // would drift the fallback and push a phantom undo entry.
      const content =
        obj.variableId === v.id
          ? getObjectStringContent(obj) ?? ""
          : v.defaultValue;
      return { variableId: v.id, content };
    }
  }
  return { variableId: undefined, content: tokenString };
}

/** Drives the always-visible mode badge. */
export function fieldMode(
  obj: LabelObject,
  variables: readonly Variable[],
): FieldMode {
  if (obj.variableId && variables.some((v) => v.id === obj.variableId)) {
    return "single";
  }
  const content = getObjectStringContent(obj) ?? "";
  if (content === "") return "empty";
  return extractTemplateRefs(content).length > 0 ? "template" : "literal";
}

/** The literal value a field prints absent a CSV row: a single-bind field
 *  prints its variable's CURRENT default (the object's `content` is only a
 *  mirror that can go stale when the default is edited in the Variables panel),
 *  everything else prints its own content. Template content is markers with no
 *  fixed length, so callers gate length/charset checks to non-template modes. */
export function boundDefaultOrContent(
  obj: LabelObject,
  variables: readonly Variable[],
): string {
  if (obj.variableId) {
    const v = variables.find((x) => x.id === obj.variableId);
    if (v) return v.defaultValue;
  }
  return getObjectStringContent(obj) ?? "";
}

/** True when the field carries a variable (single-bind or template); callers
 *  use this to gate literal-only affordances (length checks, typed-content
 *  builders) that don't apply once a binding is present. */
export function fieldHasVariable(
  obj: LabelObject,
  variables: readonly Variable[],
): boolean {
  const m = fieldMode(obj, variables);
  return m === "single" || m === "template";
}

/** The field's ^FN variables (single-bind ∪ marker refs), deduped; excludes
 *  clock tokens and orphan markers. Feeds the "used in this field" inspector. */
export function fieldVariableRefs(
  obj: LabelObject,
  variables: readonly Variable[],
): Variable[] {
  const byId = new Map(variables.map((v) => [v.id, v]));
  const byName = new Map(variables.map((v) => [v.name, v]));
  const out: Variable[] = [];
  const seen = new Set<string>();
  const push = (v: Variable | undefined) => {
    if (v && !seen.has(v.id)) {
      seen.add(v.id);
      out.push(v);
    }
  };
  if (obj.variableId) push(byId.get(obj.variableId));
  const content = getObjectStringContent(obj) ?? "";
  for (const name of extractTemplateRefs(content)) push(byName.get(name));
  return out;
}

/** Walk every page (groups too) and tally how many fields reference each
 *  variable, either via single-bind `variableId` OR via inline `«name»`
 *  template markers in their content. Returns a Map keyed by variable.id.
 *  Variables with no bindings are absent; callers default to 0. */
export function countBindings(
  pages: readonly { objects: LabelObject[] }[],
  variables: readonly Variable[],
): Map<string, number> {
  const known = new Set(variables.map((v) => v.id));
  const byName = new Map(variables.map((v) => [v.name, v.id]));
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const obj of walkObjects(page.objects)) {
      // De-dupe per OBJECT across both binding styles: a field with both
      // `variableId === V` and `«V»` in its content counts as one usage of V,
      // not two. One field = one place, mirroring how the user thinks about it.
      const refsInThisObj = new Set<string>();
      if (obj.variableId && known.has(obj.variableId)) {
        refsInThisObj.add(obj.variableId);
      }
      const c = getObjectStringContent(obj);
      if (c !== undefined) {
        for (const name of extractTemplateRefs(c)) {
          const id = byName.get(name);
          if (id) refsInThisObj.add(id);
        }
      }
      for (const id of refsInThisObj) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Token counts for the disclosure header ("2× ^FN · 1× ^FC"). */
export function fieldTokenSummary(
  obj: LabelObject,
  variables: readonly Variable[],
): { fn: number; fc: number } {
  if (obj.variableId && variables.some((v) => v.id === obj.variableId)) {
    // Single-bind content is a pure fallback with no markers by invariant
    // (see normalizeTokenInput), so there are no clock tokens to count here.
    return { fn: 1, fc: 0 };
  }
  const content = getObjectStringContent(obj) ?? "";
  const names = new Set(variables.map((v) => v.name));
  const fn = extractTemplateRefs(content).filter((n) => names.has(n)).length;
  const fc = extractClockTokens(content).length;
  return { fn, fc };
}
