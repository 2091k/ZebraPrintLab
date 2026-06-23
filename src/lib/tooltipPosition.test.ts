import { describe, it, expect } from "vitest";
import { resolveTooltipPosition, type AnchorRect } from "./tooltipPosition";

const VP = { width: 1000, height: 800 };
const tip = { width: 120, height: 40 };
// Anchor mid-viewport with plenty of room on all sides.
const mid: AnchorRect = { top: 400, left: 500, width: 60, height: 20 };

describe("resolveTooltipPosition", () => {
  it("places above and horizontally centred when there is room", () => {
    const p = resolveTooltipPosition(mid, tip, VP, { preferred: "top" });
    expect(p.placement).toBe("top");
    expect(p.top).toBe(400 - 6 - 40); // anchor.top - gap - tipHeight
    expect(p.left).toBe(530 - 60); // centreX(530) - tipWidth/2
  });

  it("flips to bottom when the anchor hugs the top edge (menu bar)", () => {
    const topBar: AnchorRect = { top: 4, left: 500, width: 60, height: 24 };
    const p = resolveTooltipPosition(topBar, tip, VP, { preferred: "top" });
    expect(p.placement).toBe("bottom");
    expect(p.top).toBe(4 + 24 + 6); // below the anchor
  });

  it("flips a bottom-preferred tip to top when it hugs the bottom edge", () => {
    const bottom: AnchorRect = { top: 780, left: 500, width: 60, height: 16 };
    const p = resolveTooltipPosition(bottom, tip, VP, { preferred: "bottom" });
    expect(p.placement).toBe("top");
  });

  it("clamps a left-edge anchor so the tip stays in the viewport", () => {
    const leftEdge: AnchorRect = { top: 400, left: 0, width: 20, height: 20 };
    const p = resolveTooltipPosition(leftEdge, tip, VP, { margin: 4 });
    expect(p.left).toBe(4); // would be 10 - 60 = -50, clamped to margin
  });

  it("clamps a right-edge anchor so the tip stays in the viewport", () => {
    const rightEdge: AnchorRect = { top: 400, left: 990, width: 10, height: 20 };
    const p = resolveTooltipPosition(rightEdge, tip, VP, { margin: 4 });
    expect(p.left).toBe(VP.width - 4 - tip.width); // 1000 - 4 - 120 = 876
  });

  it("falls back to the roomier side when neither fits", () => {
    const tall = { width: 120, height: 700 };
    const p = resolveTooltipPosition(mid, tall, VP, { preferred: "top" });
    // anchor.top 400 vs spaceBelow 380 -> above has more room
    expect(p.placement).toBe("top");
    expect(p.top).toBeGreaterThanOrEqual(4); // clamped into the viewport
  });
});
