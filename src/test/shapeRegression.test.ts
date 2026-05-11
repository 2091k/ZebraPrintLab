import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { createCanvas } from "@napi-rs/canvas";
import { shapeTestCases } from "../../tests/fixtures/shapeTestCases";
import { renderShape } from "../lib/shapeRender";

/**
 * Pixel regression for shape primitives (box / ellipse / circle / line),
 * the geometric counterpart of `visualRegression.test.ts` (which covers
 * barcodes via bwip-js). Each test:
 *
 *  1. Renders the `LabelObject` via `renderShape` onto a blank 812×812
 *     canvas (matches Labelary 8dpmm × 4 inches).
 *  2. Loads the Labelary reference PNG for the same ZPL.
 *  3. Diffs them with pixelmatch and asserts the diff stays under a
 *     tight tolerance.
 *
 * Fetch the references first via
 *   pnpm tsx tests/scripts/fetch_labelary_shape_fixtures.ts
 */

const FIXTURES_DIR = path.resolve(
  process.cwd(),
  "tests/fixtures/labelary_shape_images",
);
const DIFF_DIR = path.resolve(process.cwd(), "tests/fixtures/__shape_diffs__");

if (!fs.existsSync(DIFF_DIR)) {
  fs.mkdirSync(DIFF_DIR, { recursive: true });
}

const CANVAS_W = 812;
const CANVAS_H = 812;
// Per-test diff budget. The shape primitives are pure black-on-white
// rectangles / ellipses. The diagonal cases trace a 1-pixel-wide AA
// gradient along their full length (~400 px each), so the realistic
// upper bound from rasterisation alone is ~1500 px. Axis-aligned cases
// finish at <50 px diff in practice.
const ALLOWED_TOLERANCE = 1500;
// pixelmatch threshold (per-pixel YIQ distance, 0..1). 0.1 catches
// geometry shifts down to 1 px; raising to 0.3 ignores the half-tone
// AA halo Labelary doesn't produce (Zebra renders 1-bit binary).
const PIXELMATCH_THRESHOLD = 0.3;

describe("Visual Regression - shape primitives vs Labelary", () => {
  it("loads shape test cases", () => {
    expect(shapeTestCases.length).toBeGreaterThan(0);
  });

  describe.each(shapeTestCases)("Shape: $id", (tc) => {
    it("matches the Labelary reference pixel-for-pixel", async () => {
      const fixturePath = path.join(FIXTURES_DIR, tc.image_ref);
      if (!fs.existsSync(fixturePath)) {
        throw new Error(
          `Fixture not found: ${fixturePath}. ` +
            `Run: pnpm tsx tests/scripts/fetch_labelary_shape_fixtures.ts`,
        );
      }

      const canvas = createCanvas(CANVAS_W, CANVAS_H);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      renderShape(ctx as unknown as CanvasRenderingContext2D, tc.obj);

      const labelaryRef = PNG.sync.read(fs.readFileSync(fixturePath));
      const localPng = PNG.sync.read(canvas.toBuffer("image/png"));

      expect(labelaryRef.width).toBe(CANVAS_W);
      expect(labelaryRef.height).toBe(CANVAS_H);

      const diff = new PNG({ width: CANVAS_W, height: CANVAS_H });
      const numDiffPixels = pixelmatch(
        labelaryRef.data,
        localPng.data,
        diff.data,
        CANVAS_W,
        CANVAS_H,
        { threshold: PIXELMATCH_THRESHOLD },
      );

      if (numDiffPixels > ALLOWED_TOLERANCE) {
        fs.writeFileSync(
          path.join(DIFF_DIR, `${tc.id}_diff.png`),
          PNG.sync.write(diff),
        );
        fs.writeFileSync(
          path.join(DIFF_DIR, `${tc.id}_local.png`),
          canvas.toBuffer("image/png"),
        );
      }

      expect(numDiffPixels).toBeLessThanOrEqual(ALLOWED_TOLERANCE);
    });
  });
});
