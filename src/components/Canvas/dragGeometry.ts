// Pure drag-snap geometry, shared by the Konva drag controller. Keeps the
// snap policy (grid vs smart, single vs multi) testable without a stage:
// every function takes plain numbers and returns a delta to apply to the
// whole drag, so the controller stays a thin imperative layer.

import { computeSnap, type SnapGuide, type SnapRect } from "../../lib/snapGuides";
import type { BoundingBoxDots } from "../../lib/objectBounds";

/** Round to the nearest grid multiple; identity when the grid is off. */
export function snapToGrid(value: number, gridDots: number): number {
  return gridDots > 0 ? Math.round(value / gridDots) * gridDots : value;
}

/**
 * Grid-snap delta for a box's top-left (dots): the offset that lands the box on
 * the nearest grid line. The caller applies this single delta to the whole drag
 * (the controller snaps the grabbed object and shifts the rest by the same
 * amount), so a multi-selection keeps its relative offsets.
 */
export function gridSnapDelta(box: BoundingBoxDots, gridDots: number): { dx: number; dy: number } {
  return {
    dx: snapToGrid(box.x, gridDots) - box.x,
    dy: snapToGrid(box.y, gridDots) - box.y,
  };
}

/**
 * Smart-snap delta for one rect against the other objects + label. All inputs
 * share a single coordinate space (the controller passes stage pixels so the
 * returned guides line up with the rendered guide layer). One delta for the
 * whole drag; the union rect snaps as a unit.
 */
export function smartSnapDelta(
  box: SnapRect,
  others: SnapRect[],
  labelRect: SnapRect | undefined,
  threshold: number,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const r = computeSnap(box, others, threshold, labelRect, labelRect);
  return { dx: r.x - box.x, dy: r.y - box.y, guides: r.guides };
}
