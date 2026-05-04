import type { LabelObject } from "../../registry";
import { QR_FO_Y_OFFSET_DOTS } from "./bwipConstants";

/**
 * Convert the rendered top-left of a Konva node back to the object's stored
 * model position, in dots. Inverts per-type render offsets that the renderer
 * adds at draw time.
 *
 * Currently handles:
 * - QR (FO): subtracts the hardcoded +10 dot Y-offset that BarcodeObject adds
 *   to compensate for Zebra firmware artifact.
 *
 * Used by onTransformEnd to mirror the rendered→model conversion that
 * BarcodeObject.handleDragEnd performs for drag.
 *
 * Note: Field-Typeset (FT) corrections for barcode resize are not yet
 * implemented here; FT-mode barcode resize still has known position drift.
 */
export function modelPositionFromRenderedTopLeft(
  obj: LabelObject,
  renderedXDots: number,
  renderedYDots: number,
): { x: number; y: number } {
  if (obj.type === "qrcode" && obj.positionType !== "FT") {
    return { x: renderedXDots, y: renderedYDots - QR_FO_Y_OFFSET_DOTS };
  }
  return { x: renderedXDots, y: renderedYDots };
}
