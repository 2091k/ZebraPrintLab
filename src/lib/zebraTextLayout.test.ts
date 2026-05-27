import { describe, it, expect } from "vitest";
import {
  zebraGlyphAdvanceDots,
  zebraLineWidthDots,
  zebraAlignOffsetDots,
  blockBoundsDots,
  blockLineStepDots,
} from "./zebraTextLayout";

describe("zebraGlyphAdvanceDots", () => {
  it("returns fontWidth when explicitly set", () => {
    expect(zebraGlyphAdvanceDots(30, 20)).toBe(20);
  });

  it("uses the A0 default 5:9 aspect when fontWidth is 0", () => {
    // 30 × 5/9 = 16.666…
    expect(zebraGlyphAdvanceDots(30, 0)).toBeCloseTo(30 * (5 / 9));
    expect(zebraGlyphAdvanceDots(45, 0)).toBeCloseTo(25);
  });
});

describe("zebraLineWidthDots", () => {
  it("multiplies glyph count by the explicit fontWidth", () => {
    expect(zebraLineWidthDots("ABCDE", 30, 20)).toBe(100);
  });

  it("multiplies glyph count by the auto-width when fontWidth is 0", () => {
    expect(zebraLineWidthDots("ABCDE", 30, 0)).toBeCloseTo(5 * 30 * (5 / 9));
  });

  it("returns 0 for empty line", () => {
    expect(zebraLineWidthDots("", 30, 0)).toBe(0);
  });
});

describe("zebraAlignOffsetDots", () => {
  it("L → 0 offset", () => {
    expect(zebraAlignOffsetDots(100, 400, "L")).toBe(0);
  });

  it("C → half the leftover space", () => {
    expect(zebraAlignOffsetDots(100, 400, "C")).toBe(150);
  });

  it("R → all leftover space on the left", () => {
    expect(zebraAlignOffsetDots(100, 400, "R")).toBe(300);
  });

  it("J → same as L (canvas does not visualise inter-word stretch)", () => {
    expect(zebraAlignOffsetDots(150, 400, "J")).toBe(0);
  });

  it("clamps to 0 when the line is wider than the block (no negative offsets)", () => {
    expect(zebraAlignOffsetDots(500, 400, "C")).toBe(0);
    expect(zebraAlignOffsetDots(500, 400, "R")).toBe(0);
  });
});

describe("blockLineStepDots", () => {
  it("adds extra inter-line spacing onto fontHeight", () => {
    expect(blockLineStepDots(30, 0)).toBe(30);
    expect(blockLineStepDots(30, 5)).toBe(35);
  });
});

describe("blockBoundsDots", () => {
  it("anchors at (0, 0) — left edge stays at the FO position regardless of text justify", () => {
    // No justify/text parameter exists on the helper signature, so
    // C/R-justified text can never shift this bbox rightwards.
    // Adding such a parameter would be the regression to catch.
    const r = blockBoundsDots({
      blockWidthDots: 400,
      blockLines: 3,
      blockLineSpacing: 0,
      fontHeight: 30,
    });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it("width = blockWidthDots", () => {
    const r = blockBoundsDots({
      blockWidthDots: 400,
      blockLines: 1,
      blockLineSpacing: 0,
      fontHeight: 30,
    });
    expect(r.width).toBe(400);
  });

  it("height = blockLines × fontHeight when blockLineSpacing is 0", () => {
    const r = blockBoundsDots({
      blockWidthDots: 100,
      blockLines: 3,
      blockLineSpacing: 0,
      fontHeight: 30,
    });
    expect(r.height).toBe(90);
  });

  it("blockLineSpacing widens the row step uniformly", () => {
    const r = blockBoundsDots({
      blockWidthDots: 100,
      blockLines: 3,
      blockLineSpacing: 5,
      fontHeight: 30,
    });
    expect(r.height).toBe(105); // 3 × (30 + 5)
  });
});
