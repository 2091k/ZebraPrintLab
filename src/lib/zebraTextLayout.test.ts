import { describe, it, expect } from "vitest";
import {
  zebraGlyphAdvanceDots,
  zebraLineWidthDots,
  zebraAlignOffsetDots,
  blockBoundsPx,
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

describe("blockBoundsPx", () => {
  // 8 dpmm @ scale 1 ⇒ 1 dot = 1/8 px; pick numbers that make the
  // expected px values clean.
  const base = { scale: 1, dpmm: 8, fontSizePx: 30 };

  it("anchors at (0, 0) — left edge stays at the FO position", () => {
    const r = blockBoundsPx({
      ...base,
      blockWidthDots: 400,
      blockLines: 3,
      blockLineSpacing: 0,
    });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it("width scales with blockWidthDots / dpmm × scale", () => {
    const r = blockBoundsPx({
      ...base,
      blockWidthDots: 400,
      blockLines: 1,
      blockLineSpacing: 0,
    });
    expect(r.width).toBe(50); // 400 / 8 * 1
  });

  it("height = blockLines × fontSizePx when blockLineSpacing is 0", () => {
    const r = blockBoundsPx({
      ...base,
      blockWidthDots: 100,
      blockLines: 3,
      blockLineSpacing: 0,
    });
    expect(r.height).toBe(90); // 3 × 30
  });

  it("blockLineSpacing widens the row step uniformly", () => {
    const r = blockBoundsPx({
      ...base,
      blockWidthDots: 100,
      blockLines: 3,
      blockLineSpacing: 8, // 8 dots = 1 px at this dpmm
    });
    expect(r.height).toBe(93); // 3 × (30 + 1)
  });

  it("scale multiplies px output linearly (zoom)", () => {
    const r1 = blockBoundsPx({
      ...base,
      blockWidthDots: 400,
      blockLines: 2,
      blockLineSpacing: 0,
    });
    const r2 = blockBoundsPx({
      ...base,
      scale: 2,
      blockWidthDots: 400,
      blockLines: 2,
      blockLineSpacing: 0,
    });
    expect(r2.width).toBe(r1.width * 2);
    // fontSizePx is the caller's px-space input (already zoomed) and
    // is NOT remultiplied by scale; height scales only via the spacing
    // term, which is 0 here.
    expect(r2.height).toBe(r1.height);
  });

  it("ignores text content and justify — bbox is justify-independent (left edge invariant)", () => {
    // The helper has no text/justify args by design: that's the
    // structural guarantee that C/R-justified text inside the block
    // cannot pull the selection bbox rightwards. This test pins that
    // contract — adding a text/justify parameter would break it.
    const args = {
      ...base,
      blockWidthDots: 300,
      blockLines: 2,
      blockLineSpacing: 0,
    };
    expect(blockBoundsPx(args)).toEqual(blockBoundsPx(args));
  });
});
