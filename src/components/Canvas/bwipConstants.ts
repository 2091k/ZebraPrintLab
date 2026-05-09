export const QR_FO_Y_OFFSET_DOTS = 10;
export const QR_FT_MODULE_OFFSET = 3;

// Zebra/Labelary always reserves a mandatory text zone below EAN/UPC barcodes
// (even with printInterpretation=false). Verified at 8 and 12 dpmm: constant 13 dots.
export const EAN_TEXT_ZONE_DOTS = 13;

// LOGMARS renders the human-readable line ABOVE the bars (per spec).
// Empirically Labelary leaves ~10 dots between visible text bottom and bar top,
// wider than the standard textGap used for text below other 1D barcodes.
export const LOGMARS_TEXT_ABOVE_GAP_DOTS = 10;

// Total LOGMARS text-zone reserved by firmware (regardless of printInterpretation):
// glyph height + LOGMARS_TEXT_ABOVE_GAP_DOTS. Empirically 20 dots — used as part
// of the ZPL-correct bbox so selection-handles match the printed footprint.
export const LOGMARS_TEXT_ZONE_DOTS = 20;

// bwip-js adds 3 quiet-zone rows to MicroPDF417 canvas output.
export const MICROPDF417_QUIET_ZONE_ROWS = 3;

// Per-symbology spec module heights for GS1 DataBar. bwip-js renders most
// non-stacked variants at the same canvas height as the omni form (33 modules)
// regardless of the actual variant, which doesn't match Zebra firmware. Use
// these spec values to compute the ZPL-correct bbox height instead of trusting
// the bwip canvas dims. Sym 7 (Expanded Stacked) is segments-dependent and
// falls back to the bwip-natural height.
//   1 Omnidirectional, 2 Truncated, 3 Stacked, 4 Stacked Omnidirectional,
//   5 Limited, 6 Expanded — modules from GS1 General Specifications.
export const GS1_DATABAR_SPEC_HEIGHT_MODULES: Partial<
  Record<1 | 2 | 3 | 4 | 5 | 6 | 7, number>
> = {
  1: 33,
  2: 13,
  3: 14,
  4: 72,
  5: 10,
  6: 34,
};

export const EAN_UPC_TYPES = new Set<string>([
  "ean13",
  "ean8",
  "upca",
  "upce",
]);
