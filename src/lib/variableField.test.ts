import { describe, it, expect } from "vitest";
import {
  tokenStringForObject,
  normalizeTokenInput,
  fieldMode,
  fieldHasVariable,
  fieldVariableRefs,
  fieldTokenSummary,
  countBindings,
  boundDefaultOrContent,
} from "./variableField";
import { applyBindingToObject } from "./variableBinding";
import { fdFieldFor } from "../registry/zplHelpers";
import { extractTemplateRefs } from "./fnTemplate";
import type { Variable } from "../types/Variable";
import type { LabelObject } from "../types/Group";
import type { ZplEmitContext } from "../types/ZplEmit";
import type { LabelConfig } from "../types/LabelConfig";

const sku: Variable = { id: "v1", name: "sku", fnNumber: 1, defaultValue: "DEFAULT" };
const lot: Variable = { id: "v2", name: "lot", fnNumber: 7, defaultValue: "L7" };
const vars = [sku, lot];

const obj = (variableId: string | undefined, content: string): LabelObject =>
  ({
    id: "o1",
    type: "text",
    x: 0,
    y: 0,
    ...(variableId ? { variableId } : {}),
    props: { content },
  }) as unknown as LabelObject;

const contentOf = (o: LabelObject): string =>
  (o as unknown as { props: { content: string } }).props.content;

// fdFieldFor only reads variables/embedChar/clockChars; label is unused here.
const ctx: ZplEmitContext = { label: {} as LabelConfig, variables: vars, embedChar: "#" };

describe("tokenStringForObject", () => {
  it("renders single-bind as one chip", () => {
    expect(tokenStringForObject(obj("v1", "DEFAULT"), vars)).toBe("«sku»");
  });
  it("returns raw content when not bound", () => {
    expect(tokenStringForObject(obj(undefined, "«sku» x"), vars)).toBe("«sku» x");
  });
  it("falls through to content for an orphan variableId", () => {
    expect(tokenStringForObject(obj("ghost", "fallback"), vars)).toBe("fallback");
  });
});

describe("normalizeTokenInput transitions", () => {
  const norm = (token: string, o: LabelObject) => normalizeTokenInput(token, o, vars);

  it("empty -> empty", () => {
    expect(norm("", obj(undefined, ""))).toEqual({ variableId: undefined, content: "" });
  });
  it("empty -> single (seeds content from defaultValue)", () => {
    expect(norm("«sku»", obj(undefined, ""))).toEqual({ variableId: "v1", content: "DEFAULT" });
  });
  it("empty -> literal", () => {
    expect(norm("abc", obj(undefined, ""))).toEqual({ variableId: undefined, content: "abc" });
  });
  it("single -> single unchanged preserves existing content (no defaultValue overwrite)", () => {
    // Variable default changed to NEW but the field's fallback stays OLD.
    const newVars = [{ ...sku, defaultValue: "NEW" }, lot];
    const out = normalizeTokenInput("«sku»", obj("v1", "OLD"), newVars);
    expect(out).toEqual({ variableId: "v1", content: "OLD" });
  });
  it("single -> template when literal text is appended", () => {
    expect(norm("«sku» x", obj("v1", "DEFAULT"))).toEqual({
      variableId: undefined,
      content: "«sku» x",
    });
  });
  it("single -> empty drops the binding", () => {
    expect(norm("", obj("v1", "DEFAULT"))).toEqual({ variableId: undefined, content: "" });
  });
  it("single -> rebind to another variable seeds its default", () => {
    expect(norm("«lot»", obj("v1", "DEFAULT"))).toEqual({ variableId: "v2", content: "L7" });
  });
  it("template -> single drops surrounding literal text (expected, lossy)", () => {
    expect(norm("«sku»", obj(undefined, "«sku» «lot»"))).toEqual({
      variableId: "v1",
      content: "DEFAULT",
    });
  });
  it("trailing space keeps it template (no accidental single-bind)", () => {
    expect(norm("«sku» ", obj(undefined, "«sku» "))).toEqual({
      variableId: undefined,
      content: "«sku» ",
    });
  });
  it("orphan-only marker stays template (unknown name)", () => {
    expect(norm("«ghost»", obj(undefined, "«ghost»"))).toEqual({
      variableId: undefined,
      content: "«ghost»",
    });
  });
  it("clock-only marker never single-binds", () => {
    expect(norm("«clock:T»", obj(undefined, "«clock:T»"))).toEqual({
      variableId: undefined,
      content: "«clock:T»",
    });
  });
  it("var + clock stays template", () => {
    expect(norm("«sku»«clock:T»", obj(undefined, "«sku»«clock:T»"))).toEqual({
      variableId: undefined,
      content: "«sku»«clock:T»",
    });
  });
  it("unbalanced marker char stays template", () => {
    expect(norm("«", obj(undefined, "«"))).toEqual({ variableId: undefined, content: "«" });
  });
});

describe("mutual-exclusion invariant (kills preview/export divergence)", () => {
  // A normalized object must never be single-bound AND carry known markers;
  // that is the only state shape where preview and export can disagree.
  const knownNames = new Set(vars.map((v) => v.name));
  const cases: { token: string; start: LabelObject }[] = [
    { token: "«sku»", start: obj(undefined, "") },
    { token: "«sku» x", start: obj("v1", "DEFAULT") },
    { token: "«sku»«lot»", start: obj(undefined, "") },
    { token: "«lot»", start: obj("v1", "DEFAULT") },
    { token: "", start: obj("v1", "DEFAULT") },
    { token: "plain text", start: obj(undefined, "") },
  ];
  for (const { token, start } of cases) {
    it(`normalized "${token}" is never dual-state`, () => {
      const out = normalizeTokenInput(token, start, vars);
      const hasKnownMarker = extractTemplateRefs(out.content).some((n) => knownNames.has(n));
      expect(out.variableId !== undefined && hasKnownMarker).toBe(false);
    });
  }
});

describe("preview/export agree on normalized state", () => {
  it("single-bind: preview default, export clean ^FN", () => {
    const out = normalizeTokenInput("«sku»", obj(undefined, ""), vars);
    const o = obj(out.variableId, out.content);
    expect(contentOf(applyBindingToObject(o, vars, null, "preview"))).toBe("DEFAULT");
    expect(fdFieldFor(o, out.content, ctx)).toBe("^FN1^FDDEFAULT^FS");
  });
  it("template: preview resolves markers, export uses embeds", () => {
    const out = normalizeTokenInput("«sku» x", obj("v1", "DEFAULT"), vars);
    const o = obj(out.variableId, out.content);
    expect(contentOf(applyBindingToObject(o, vars, null, "preview"))).toBe("DEFAULT x");
    expect(fdFieldFor(o, out.content, ctx)).toBe("^FD#1# x^FS");
  });
});

describe("fieldMode", () => {
  it("single / template / literal / empty", () => {
    expect(fieldMode(obj("v1", "DEFAULT"), vars)).toBe("single");
    expect(fieldMode(obj(undefined, "«sku» x"), vars)).toBe("template");
    expect(fieldMode(obj(undefined, "plain"), vars)).toBe("literal");
    expect(fieldMode(obj(undefined, ""), vars)).toBe("empty");
  });
  it("orphan variableId is not single", () => {
    expect(fieldMode(obj("ghost", "fallback"), vars)).toBe("literal");
  });
});

describe("fieldHasVariable", () => {
  // Gates literal-only affordances in the panels (length/EAN checks,
  // typed-content builders) which must not fire once a variable is present.
  it("true for single-bind and template, false for literal and empty", () => {
    expect(fieldHasVariable(obj("v1", "DEFAULT"), vars)).toBe(true);
    expect(fieldHasVariable(obj(undefined, "«sku» x"), vars)).toBe(true);
    expect(fieldHasVariable(obj(undefined, "plain"), vars)).toBe(false);
    expect(fieldHasVariable(obj(undefined, ""), vars)).toBe(false);
  });
});

describe("fieldVariableRefs", () => {
  it("returns the single-bind variable", () => {
    expect(fieldVariableRefs(obj("v1", "DEFAULT"), vars)).toEqual([sku]);
  });
  it("returns deduped known marker refs, excluding clock and orphan", () => {
    expect(fieldVariableRefs(obj(undefined, "«sku»«lot»«sku»«clock:T»«ghost»"), vars)).toEqual([
      sku,
      lot,
    ]);
  });
});

describe("fieldTokenSummary", () => {
  it("single-bind counts one ^FN", () => {
    expect(fieldTokenSummary(obj("v1", "DEFAULT"), vars)).toEqual({ fn: 1, fc: 0 });
  });
  it("template counts known vars and clock tokens", () => {
    expect(fieldTokenSummary(obj(undefined, "«sku»«lot»«clock:T»«ghost»"), vars)).toEqual({
      fn: 2,
      fc: 1,
    });
  });
});

describe("boundDefaultOrContent", () => {
  it("returns the variable's CURRENT default for a single-bind field (ignores stale content)", () => {
    // content mirrors an old default; the variable default changed elsewhere.
    expect(boundDefaultOrContent(obj("v1", "12345670"), vars)).toBe("DEFAULT");
  });
  it("returns content for a literal field", () => {
    expect(boundDefaultOrContent(obj(undefined, "98765432"), vars)).toBe("98765432");
  });
  it("falls back to content when the bound id is an orphan", () => {
    expect(boundDefaultOrContent(obj("ghost", "literal"), vars)).toBe("literal");
  });
});

describe("countBindings", () => {
  const page = (objects: LabelObject[]) => ({ objects });

  it("counts a single-bind reference", () => {
    const counts = countBindings([page([obj("v1", "DEFAULT")])], vars);
    expect(counts.get("v1")).toBe(1);
    expect(counts.has("v2")).toBe(false);
  });

  it("counts a template marker reference by name", () => {
    const counts = countBindings([page([obj(undefined, "«sku» «lot»")])], vars);
    expect(counts.get("v1")).toBe(1);
    expect(counts.get("v2")).toBe(1);
  });

  it("counts one field that both single-binds and markers the same var once", () => {
    const counts = countBindings([page([obj("v1", "«sku»")])], vars);
    expect(counts.get("v1")).toBe(1);
  });

  it("ignores orphan ids and unknown marker names", () => {
    const counts = countBindings([page([obj("ghost", "«missing»")])], vars);
    expect(counts.size).toBe(0);
  });

  it("tallies across multiple pages and objects", () => {
    const counts = countBindings(
      [page([obj("v1", "x"), obj(undefined, "«sku»")]), page([obj(undefined, "«lot»")])],
      vars,
    );
    expect(counts.get("v1")).toBe(2);
    expect(counts.get("v2")).toBe(1);
  });

  it("descends into nested groups", () => {
    const group = {
      id: "g1",
      type: "group",
      x: 0,
      y: 0,
      children: [obj("v1", "x"), { id: "g2", type: "group", x: 0, y: 0, children: [obj(undefined, "«lot»")] }],
    } as unknown as LabelObject;
    const counts = countBindings([page([group])], vars);
    expect(counts.get("v1")).toBe(1);
    expect(counts.get("v2")).toBe(1);
  });
});
