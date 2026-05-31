import type { Code49Props } from "../../../registry/code49";
import type { DataMatrixProps } from "../../../registry/datamatrix";
import type { Gs1DatabarProps } from "../../../registry/gs1databar";
import type { MaxicodeProps } from "../../../registry/maxicode";
import { GS1_DATABAR_DEFAULT_SEGMENTS } from "../../gs1";
import type { ParserState } from "../context";
import { int, readRotation } from "../helpers";
import type { Handler } from "../types";

/** Handlers for every ^B* barcode-family command plus the shared
 *  ^BY defaults. Each handler only mutates the per-field caching
 *  slice on `ParserState` (s.fieldType + s.bcRotation, s.bcHeight,
 *  s.bcInterp, s.bcCheck, s.byModuleWidth, plus per-symbology
 *  pendings like s.qrMag / s.dmDim / s.aztecMag). flushField (kept
 *  in parseZPL.ts) is what actually emits the LabelObject once the
 *  closing ^FS arrives. */
export function createBarcodeHandlers(s: ParserState): Record<string, Handler> {
  // Factory for standard 1D barcode commands that share the same state
  // variables. hIdx/iIdx/cIdx are the comma-split parameter indices for
  // height / printInterpretation / checkDigit.
  const mkBarcode =
    (
      type: string,
      hIdx: number,
      iIdx: number,
      iDefault = "Y",
      cIdx = -1,
    ): Handler =>
    (p) => {
      s.fieldType = type;
      s.bcRotation = readRotation(p[0]);
      s.bcHeight = int(p[hIdx], s.byHeight || 100);
      s.bcInterp = (p[iIdx] ?? iDefault) === "Y";
      if (cIdx >= 0) s.bcCheck = (p[cIdx] ?? "N") === "Y";
    };

  const handleAztec: Handler = (p) => {
    s.fieldType = "aztec";
    s.bcRotation = readRotation(p[0]);
    s.aztecMag = int(p[1], 4);
  };

  return {
    // ── Barcode defaults ──────────────────────────────────────────────────
    // ^BY{moduleWidth},{ratio},{height}
    BY(p) {
      s.byModuleWidth = int(p[0], 2);
      s.byHeight = int(p[2], 0);
    },

    // ── 1D barcodes via mkBarcode(type, hIdx, iIdx, iDefault?, cIdx?) ─────
    BC: mkBarcode("code128", 1, 2, "Y", 4), // ^BCN,h,i,N,c
    B3: mkBarcode("code39", 2, 3, "Y", 1), // ^B3N,c,h,i,N
    BE: mkBarcode("ean13", 1, 2), // ^BEN,h,i,N
    BU: mkBarcode("upca", 1, 2), // ^BUN,h,i,N,N
    B8: mkBarcode("ean8", 1, 2), // ^B8N,h,i,N
    B9: mkBarcode("upce", 1, 2), // ^B9N,h,i,N
    B2: mkBarcode("interleaved2of5", 1, 2, "Y", 4), // ^B2N,h,i,N,c
    BA: mkBarcode("code93", 1, 2, "Y", 4), // ^BAN,h,i,N,c
    B1: mkBarcode("code11", 2, 3, "Y", 1), // ^B1N,c,h,i,N
    BI: mkBarcode("industrial2of5", 1, 2), // ^BIN,h,i,N
    BJ: mkBarcode("standard2of5", 1, 2), // ^BJN,h,i,N
    BK: mkBarcode("codabar", 2, 3, "Y", 1), // ^BKN,c,h,i,N
    BL: mkBarcode("logmars", 1, 2, "N"), // ^BLN,h,i — interp default N
    BP: mkBarcode("plessey", 2, 3, "Y", 1), // ^BPN,c,h,i,N
    B5: mkBarcode("planet", 1, 2), // ^B5N,h,i,N
    BZ: mkBarcode("postal", 1, 2), // ^BZN,h,i,N
    BS: mkBarcode("upcEanExtension", 1, 2), // ^BSo,h,f (UPC/EAN supplement)

    // ^B4o,h,f,m — Code 49. Custom handler for the extra mode parameter.
    B4(p) {
      s.fieldType = "code49";
      s.bcRotation = readRotation(p[0]);
      s.bcHeight = int(p[1], s.byHeight || 20);
      s.bcInterp = (p[2] ?? "N") === "Y";
      const m = (p[3] ?? "A").toUpperCase();
      s.bcCode49Mode = /^[A0-5]$/.test(m)
        ? (m as Code49Props["mode"])
        : "A";
    },

    // MSI: check logic is "any letter except N" (not simple "Y") — keep inline.
    // ^BMN,{checkType},{height},{interp},N  (checkType: A/B/C/D=enabled, N=none)
    BM(p) {
      s.fieldType = "msi";
      s.bcRotation = readRotation(p[0]);
      s.bcCheck = (p[1] ?? "N") !== "N";
      s.bcHeight = int(p[2], s.byHeight || 100);
      s.bcInterp = (p[3] ?? "Y") === "Y";
    },

    // GS1 Databar: different param layout, also updates s.byModuleWidth.
    // ^BRo,{symbology},{magnification},{separator},{height},{segments}
    BR(p) {
      s.fieldType = "gs1databar";
      s.bcRotation = readRotation(p[0]);
      s.byModuleWidth = int(p[2], s.byModuleWidth);
      s.gsSymbology = (int(p[1], 1) as Gs1DatabarProps["symbology"]) || 1;
      s.gsSegments =
        p[5] !== undefined
          ? int(p[5], GS1_DATABAR_DEFAULT_SEGMENTS)
          : undefined;
    },

    // ^BQN,2,{magnification} — QR Code
    BQ(p) {
      s.fieldType = "qrcode";
      s.bcRotation = readRotation(p[0]);
      s.qrMag = int(p[2], 4);
    },

    // ^BXN,{dimension},{quality} — DataMatrix
    BX(p) {
      s.fieldType = "datamatrix";
      s.bcRotation = readRotation(p[0]);
      s.dmDim = int(p[1], 5);
      s.dmQuality = int(p[2], 200) as DataMatrixProps["quality"];
    },

    // ^B7N,{rowHeight},{securityLevel},{columns},,, — PDF417
    B7(p) {
      s.fieldType = "pdf417";
      s.bcRotation = readRotation(p[0]);
      s.pdfRowHeight = int(p[1], 10);
      s.pdfSecurity = int(p[2], 0);
      s.pdfColumns = int(p[3], 0);
    },

    // ^B0N,{magnification},... / ^BON,... — Aztec (^B0 and ^BO are synonyms)
    B0: handleAztec,
    BO: handleAztec,

    // ^BVo,{mode},{symbolNumber},{totalSymbols} — Maxicode (fixed
    // physical size, no magnification). symbolNumber/totalSymbols
    // describe structured-append composition; we don't expose that
    // in the editor, so the params are read but the emitted form
    // pins them to (1, 1).
    BV(p) {
      s.fieldType = "maxicode";
      s.bcRotation = readRotation(p[0]);
      const m = int(p[1], 4);
      s.maxicodeMode = (m >= 2 && m <= 6 ? m : 4) as MaxicodeProps["mode"];
    },

    // ^BFN,{rowHeight} — MicroPDF417
    BF(p) {
      s.fieldType = "micropdf417";
      s.bcRotation = readRotation(p[0]);
      s.mpdfRowHeight = int(p[1], 10);
    },

    // ^BBN,{rowHeight},{security},{numCharsPerRow},{numRows},{mode} — CODABLOCK
    BB(p) {
      s.fieldType = "codablock";
      s.bcRotation = readRotation(p[0]);
      s.cbRowHeight = int(p[1], 10);
      s.cbSecurity = (p[2] ?? "Y") === "N" ? "N" : "Y";
    },
  };
}
