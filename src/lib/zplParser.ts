import {
  FN_NUMBER_MIN,
  FN_NUMBER_MAX,
  uniqueVariableName,
  type Variable,
} from "../types/Variable";
import { embedsToMarkers } from "./fnTemplate";
import { DEFAULT_CLOCK_CHARS, tokensToMarkers } from "./fcTemplate";
import { decodeFbContent } from "./fbContent";
import { zplAnchorToModel } from "./labelGeometry/textPositionTransforms";
import { computeTextRenderMetrics } from "./labelGeometry/textRenderMetrics";
import type { TextProps } from "../registry/text";
import type { Code128Props } from "../registry/code128";
import type { Code39Props } from "../registry/code39";
import type { Ean13Props } from "../registry/ean13";
import type { QrCodeProps } from "../registry/qrcode";
import type { DataMatrixProps } from "../registry/datamatrix";
import type { Barcode1DProps } from "../registry/barcode1d";
import type { Gs1DatabarProps } from "../registry/gs1databar";
import type { Pdf417Props } from "../registry/pdf417";
import type { Code49Props } from "../registry/code49";
import { DEFAULT_GS_SYMBOL, GS_SYMBOL_CODES, type SymbolProps } from "../registry/symbol";
import type { SerialProps } from "../registry/serial";
import type { AztecProps } from "../registry/aztec";
import type { MaxicodeProps } from "../registry/maxicode";
import type { MicroPdf417Props } from "../registry/micropdf417";
import type { CodablockProps } from "../registry/codablock";
import { ZPL_BUILTIN_FONT_LETTERS } from "./customFonts";
import {
  tokenize,
  int,
  makeObj,
  variableNameFromComment,
  decodeFH,
  readRotation,
} from "./zplParser/helpers";
import { createParserState, REVERSE_BBOX_TOLERANCE_DOTS } from "./zplParser/context";
import { createBarcodeHandlers } from "./zplParser/handlers/barcodes";
import { createFieldHandlers } from "./zplParser/handlers/fields";
import { createGraphicsHandlers } from "./zplParser/handlers/graphics";
import { createLabelConfigHandlers } from "./zplParser/handlers/labelConfig";
import { createSetupScriptHandlers } from "./zplParser/handlers/setupScript";
import { createUnsupportedHandlers } from "./zplParser/handlers/unsupported";
import type {
  Handler,
  ImportFinding,
  ParsedZPL,
} from "./zplParser/types";
export type {
  ImportFindingKind,
  ImportFinding,
  ImportReport,
  ParsedZPL,
} from "./zplParser/types";

export function parseZPL(zpl: string, dpmm = 8): ParsedZPL {
  const tokens = tokenize(zpl);
  const s = createParserState();
  // Destructured references for sub-state objects whose internal
  // mutations don't need `s.` qualification. Reads via `s.foo` for
  // primitives only; collection references stay bare for terseness.
  // Destructured aliases for high-frequency collection refs so the
  // inline body keeps reading naturally. Primitives stay on `s.foo`
  // (rebound writes need that). The three Map/Set collections that
  // also count as state mutate via method calls so they read cleanest
  // via `s.fontAliases.get(...)` etc — kept on `s.` for consistency.
  const {
    objects, labelConfig, printerProfile, variables,
    skipped, partialCmds, browserLimit, unknown,
  } = s;

  /** Consume and return the pending ^FX comment, then clear it. */
  const takeComment = (): string | undefined => {
    const c = s.pendingComment;
    s.pendingComment = undefined;
    return c;
  };

  // Graphics family owns the GB / GC / GD / GE / GF / GS / XG / ~DY
  // handlers and the reverse-text background collapse protocol
  // (`pushGBObject` + `commitPendingReverseBg`). Construct the family
  // here so `flushField` (below) can close over the same
  // `commitPendingReverseBg` reference the GB handler uses.
  const graphicsFamily = createGraphicsHandlers(s, takeComment);
  const { commitPendingReverseBg, getReverseFlag } = graphicsFamily.helpers;

  const resetFB = () => {
    s.fbWidth = 0;
    s.fbLines = 1;
    s.fbSpacing = 0;
    s.fbJustify = "L";
  };

  /** Get-or-create a Variable for the given FN slot. Three call
   *  sites — bare `^FN^FD^FS` declarations, single-bind fields,
   *  and template-embed references — all funnel through here so
   *  the auto-naming convention (`field_<n>` unless an FX comment
   *  hints otherwise) and the uniqueName collision logic live in
   *  one place. */
  const bootstrapVariable = (
    fnNumber: number,
    defaultValue: string,
    commentHint?: string,
  ): Variable => {
    const existing = variables.find((v) => v.fnNumber === fnNumber);
    if (existing) {
      if (!existing.defaultValue && defaultValue) {
        existing.defaultValue = defaultValue;
      }
      return existing;
    }
    const base = variableNameFromComment(commentHint) ?? `field_${fnNumber}`;
    const v: Variable = {
      id: crypto.randomUUID(),
      name: uniqueVariableName(base, variables),
      fnNumber,
      defaultValue,
    };
    variables.push(v);
    return v;
  };

  // Build a fnNumber→name map from the variables collected so far,
  // bootstrapping Variables for any FN referenced by embeds in the
  // current field's content. Mirrors the single-bind bootstrap at
  // the bottom of flushField — same auto-name convention so embed-
  // referenced FNs and inline-bound FNs share the same Variable
  // entry when they hit the same slot number.
  const applyFnEmbeds = (payload: string): string => {
    // Match the same shape embedsToMarkers expects: `<e><n><e>` or
    // `<e><n>,...<e>`. A naked `<e><digits>` without a closing `<e>`
    // would otherwise bootstrap a phantom Variable from a literal
    // like `#5 special` and then dangle (no marker emitted).
    const e = s.embedChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const embedRe = new RegExp(`${e}(\\d+)(?:,[^${e}]*)?${e}`, "g");
    let m: RegExpExecArray | null;
    const seen = new Set<number>();
    while ((m = embedRe.exec(payload)) !== null) {
      if (!m[1]) continue;
      const n = parseInt(m[1], 10);
      if (n < FN_NUMBER_MIN || n > FN_NUMBER_MAX) continue;
      seen.add(n);
    }
    if (seen.size === 0) return payload;
    for (const n of seen) bootstrapVariable(n, "");
    const fnToName = new Map(variables.map((v) => [v.fnNumber, v.name]));
    return embedsToMarkers(payload, s.embedChar, fnToName);
  };

  const flushField = () => {
    if (!s.fieldType || s.pendingFD === null) {
      // Bare `^FN<n>^FD<default>^FS` (no ^FO / ^A) is a Variable
      // declaration, not a field. Register the Variable so the
      // default reaches the Variables panel + downstream resolves,
      // and clear s.pendingFn so it doesn't leak into the next field.
      if (s.pendingFn !== null && s.pendingFD !== null) {
        const decl = s.fhActive
          ? decodeFH(s.pendingFD, s.fhDelimiter, s.fhDecoder)
          : s.pendingFD;
        bootstrapVariable(s.pendingFn, decl, s.pendingFnComment);
        s.pendingFn = null;
        s.pendingFnComment = undefined;
      }
      s.pendingFD = null;
      // Clear s.fieldType too so a half-formed field (e.g. `^GS…^FS`
      // without `^FD`) doesn't leak its kind into the next ^FD that
      // arrives via an unrelated ^FO.
      s.fieldType = null;
      return;
    }
    const rawDecoded = s.fhActive
      ? decodeFH(s.pendingFD, s.fhDelimiter, s.fhDecoder)
      : s.pendingFD;
    // Two marker conversions, in order:
    //   1. ^FE-style FN embeds (`#1#` → `«variableName»`), bootstrap
    //      Variables when the FN slot is new — same auto-naming as
    //      the single-bind ^FN path below.
    //   2. ^FC clock tokens (`%d`, `%Y`, …) → `«clock:T»`. Runs after
    //      FN embeds so a payload like `%FN#1#%Y` resolves both.
    const afterFn = applyFnEmbeds(rawDecoded);
    const content = tokensToMarkers(afterFn, s.clockChars);
    const posType: "FT" | "FO" = s.positionIsFT ? "FT" : "FO";
    const comment = takeComment();

    // Decode \& line breaks (and \\ escapes) in ^FB text blocks via the
    // shared helper so parser and generator stay symmetric.
    const decoded = s.fbWidth > 0 ? decodeFbContent(content) : content;

    // Non-text fields can never be the second half of a reverse-text
    // pair, so flush the stashed bg as a regular box before pushing.
    // Text handles its own collapse-or-commit inline below.
    if (s.fieldType !== "text") commitPendingReverseBg();
    switch (s.fieldType) {
      case "text": {
        // ZPL anchors ^FO at cap-top and ^FT at baseline; our internal
        // model stores the Konva render position (EM-top-left) so editor
        // interactions stay shift-free. The FO/I and FO/B shifts also
        // need the rendered ink width — measure it the same way the
        // renderer does so the round-trip stays exact.
        const { inkWidthDots } = computeTextRenderMetrics({
          content: s.snPending ? `#${decoded}` : decoded,
          fontHeight: s.textH,
          fontWidth: s.textW,
          printerFontName: s.pendingPrinterFontName,
        });
        const modelPos = zplAnchorToModel(
          s.x,
          s.y,
          { fontHeight: s.textH, rotation: s.textRot },
          posType,
          inkWidthDots,
        );
        // If ^SF was pending, create a serial object instead of text.
        // Serial fields can't be the second half of a reverse-text pair
        // (no reverse-serial use case in our model), so flush any
        // pending bg as a regular box before pushing the serial.
        if (s.snPending) {
          commitPendingReverseBg();
          objects.push(
            makeObj(
              "serial",
              modelPos.x,
              modelPos.y,
              {
                content: decoded,
                increment: s.snIncrement,
                fontHeight: s.textH,
                fontWidth: s.textW,
                rotation: s.textRot,
                zplMode: s.snMode,
              } satisfies SerialProps,
              posType,
              comment,
            ),
          );
          s.snPending = false;
          s.snIncrement = 1;
          s.snMode = "SN";
          resetFB();
          break;
        }
        // Reverse-text collapse: if the previous field was a filled-black
        // ^GB at this same anchor with a matching bbox, and this text is
        // ^FR-flagged, the pair is our white-on-black emit. Drop the
        // stashed bg and surface a single reverse-text object instead of
        // a box + reverse-text. Dim match uses a small dot-tolerance so
        // rounding in the emitter and parser can't unpair a legitimate
        // pair. Anything that doesn't match flushes the stash as a
        // regular box so hand-written ZPL with unrelated ^GB+^FR
        // sequences round-trips unchanged. ^FB block-text isn't part of
        // the reverse-text emit so collapsing is skipped there too.
        const vertical = s.textRot === "R" || s.textRot === "B";
        const expectedW = vertical ? s.textH : Math.max(1, Math.round(inkWidthDots));
        const expectedH = vertical ? Math.max(1, Math.round(inkWidthDots)) : s.textH;
        const collapse =
          s.pendingReverseBg !== null &&
          s.frActive &&
          s.fbWidth === 0 &&
          s.pendingReverseBg.x === s.x &&
          s.pendingReverseBg.y === s.y &&
          Math.abs(s.pendingReverseBg.w - expectedW) <= REVERSE_BBOX_TOLERANCE_DOTS &&
          Math.abs(s.pendingReverseBg.h - expectedH) <= REVERSE_BBOX_TOLERANCE_DOTS;
        // Preserve any comment that was attached to the stashed ^GB
        // (e.g. a `^FX banner` before the bg). Merged with the text's
        // own comment so no import metadata is silently dropped.
        let mergedComment = comment;
        if (collapse) {
          const bgComment = s.pendingReverseBg?.comment;
          if (bgComment) {
            mergedComment = mergedComment ? `${bgComment}\n${mergedComment}` : bgComment;
          }
          s.pendingReverseBg = null;
        } else {
          commitPendingReverseBg();
        }
        const textProps: TextProps = {
          content: decoded,
          fontHeight: s.textH,
          fontWidth: s.textW,
          rotation: s.textRot,
          reverse: collapse ? true : getReverseFlag(),
          printerFontName: s.pendingPrinterFontName,
          fontId: s.pendingFontId,
        };
        s.pendingPrinterFontName = undefined;
        s.pendingFontId = undefined;
        if (s.fbWidth > 0) {
          textProps.blockWidth = s.fbWidth;
          textProps.blockLines = s.fbLines;
          textProps.blockLineSpacing = s.fbSpacing;
          textProps.blockJustify = s.fbJustify;
        }
        objects.push(
          makeObj("text", modelPos.x, modelPos.y, textProps, posType, mergedComment),
        );
        resetFB();
        break;
      }
      case "code128":
        objects.push(
          makeObj(
            "code128",
            s.x,
            s.y,
            {
              content,
              height: s.bcHeight,
              moduleWidth: s.byModuleWidth,
              printInterpretation: s.bcInterp,
              checkDigit: s.bcCheck,
              rotation: s.bcRotation,
            } satisfies Code128Props,
            posType,
            comment,
          ),
        );
        break;
      case "code39":
        objects.push(
          makeObj(
            "code39",
            s.x,
            s.y,
            {
              content,
              height: s.bcHeight,
              moduleWidth: s.byModuleWidth,
              printInterpretation: s.bcInterp,
              checkDigit: s.bcCheck,
              rotation: s.bcRotation,
            } satisfies Code39Props,
            posType,
            comment,
          ),
        );
        break;
      case "ean13":
        objects.push(
          makeObj(
            "ean13",
            s.x,
            s.y,
            {
              content,
              height: s.bcHeight,
              moduleWidth: s.byModuleWidth,
              printInterpretation: s.bcInterp,
              checkDigit: false, // EAN-13 has no user-controlled check digit (^BE auto-appends).
              rotation: s.bcRotation,
            } satisfies Ean13Props,
            posType,
            comment,
          ),
        );
        break;
      case "qrcode": {
        // content format from toZPL: "{ec}A,{data}"  e.g. "QA,https://example.com"
        const ec = (content[0] ?? "Q") as QrCodeProps["errorCorrection"];
        const data = content.slice(3); // skip "{ec}A,"
        objects.push(
          makeObj(
            "qrcode",
            s.x,
            s.y,
            {
              content: data,
              magnification: s.qrMag,
              errorCorrection: ec,
              rotation: s.bcRotation,
            } satisfies QrCodeProps,
            posType,
            comment,
          ),
        );
        break;
      }
      case "datamatrix":
        objects.push(
          makeObj(
            "datamatrix",
            s.x,
            s.y,
            {
              content,
              dimension: s.dmDim,
              quality: s.dmQuality,
              rotation: s.bcRotation,
            } satisfies DataMatrixProps,
            posType,
            comment,
          ),
        );
        break;
      case "upca":
      case "ean8":
      case "upce":
      case "interleaved2of5":
      case "code93":
      case "code11":
      case "industrial2of5":
      case "standard2of5":
      case "codabar":
      case "logmars":
      case "msi":
      case "plessey":
      case "planet":
      case "postal":
      case "upcEanExtension":
        objects.push(
          makeObj(
            s.fieldType,
            s.x,
            s.y,
            {
              content,
              height: s.bcHeight,
              moduleWidth: s.byModuleWidth,
              printInterpretation: s.bcInterp,
              checkDigit: s.bcCheck,
              rotation: s.bcRotation,
            } satisfies Barcode1DProps,
            posType,
            comment,
          ),
        );
        break;
      case "gs1databar":
        objects.push(
          makeObj(
            "gs1databar",
            s.x,
            s.y,
            {
              content,
              moduleWidth: s.byModuleWidth,
              symbology: s.gsSymbology,
              segments: s.gsSegments,
              rotation: s.bcRotation,
            } satisfies Gs1DatabarProps,
            posType,
            comment,
          ),
        );
        break;
      case "pdf417":
        objects.push(
          makeObj(
            "pdf417",
            s.x,
            s.y,
            {
              content,
              rowHeight: s.pdfRowHeight,
              securityLevel: s.pdfSecurity,
              columns: s.pdfColumns,
              moduleWidth: s.byModuleWidth,
              rotation: s.bcRotation,
            } satisfies Pdf417Props,
            posType,
            comment,
          ),
        );
        break;
      case "code49":
        objects.push(
          makeObj(
            "code49",
            s.x,
            s.y,
            {
              content,
              height: s.bcHeight,
              moduleWidth: s.byModuleWidth,
              printInterpretation: s.bcInterp,
              mode: s.bcCode49Mode,
              rotation: s.bcRotation,
            } satisfies Code49Props,
            posType,
            comment,
          ),
        );
        break;
      case "aztec":
        objects.push(
          makeObj(
            "aztec",
            s.x,
            s.y,
            {
              content,
              magnification: s.aztecMag,
              ecLevel: 0,
              rotation: s.bcRotation,
            } satisfies AztecProps,
            posType,
            comment,
          ),
        );
        break;
      case "maxicode":
        objects.push(
          makeObj(
            "maxicode",
            s.x,
            s.y,
            {
              content,
              mode: s.maxicodeMode,
              rotation: s.bcRotation,
            } satisfies MaxicodeProps,
            posType,
            comment,
          ),
        );
        break;
      case "micropdf417":
        objects.push(
          makeObj(
            "micropdf417",
            s.x,
            s.y,
            {
              content,
              moduleWidth: s.byModuleWidth,
              rowHeight: s.mpdfRowHeight,
              mode: 0,
              rotation: s.bcRotation,
            } satisfies MicroPdf417Props,
            posType,
            comment,
          ),
        );
        break;
      case "codablock":
        objects.push(
          makeObj(
            "codablock",
            s.x,
            s.y,
            {
              content,
              moduleWidth: s.byModuleWidth,
              rowHeight: s.cbRowHeight,
              securityLevel: s.cbSecurity,
              rotation: s.bcRotation,
            } satisfies CodablockProps,
            posType,
            comment,
          ),
        );
        break;
      case "symbol": {
        // ^GS payload is a single letter A..E selecting the glyph.
        // Anything else falls back to DEFAULT_GS_SYMBOL so a malformed
        // import still produces a sensible visible object.
        const raw = content.trim().charAt(0).toUpperCase();
        const code = (GS_SYMBOL_CODES.has(raw) ? raw : DEFAULT_GS_SYMBOL) as SymbolProps["symbol"];
        objects.push(
          makeObj(
            "symbol",
            s.x,
            s.y,
            {
              symbol: code,
              height: s.symH,
              width: s.symW,
              rotation: s.symRot,
            } satisfies SymbolProps,
            posType,
            comment,
          ),
        );
        break;
      }
    }

    // Apply the pending `^FN{n}` slot (if any) to the field we just
    // pushed. Reuse an existing Variable when its fnNumber matches —
    // ZPL templates often reference the same slot multiple times,
    // and the binding should funnel to one Variable, not duplicates.
    if (s.pendingFn !== null) {
      const justPushed = objects[objects.length - 1];
      if (justPushed) {
        const variable = bootstrapVariable(s.pendingFn, content, s.pendingFnComment);
        justPushed.variableId = variable.id;
      }
      s.pendingFn = null;
      s.pendingFnComment = undefined;
    }

    s.fieldType = null;
    s.pendingFD = null;
    s.frActive = false;
  };

  // ── Command handler map ────────────────────────────────────────────────────
  const resetComment: Handler = (_, rest) => {
    s.pendingComment = rest.trim() || undefined;
  };
  // Hand-written ZPL often splits a logical comment across several `^FX` lines
  // before the field they describe. Accumulate them so each line survives on
  // the imported object's comment field; XA/XZ still reset at label boundaries.
  const appendComment: Handler = (_, rest) => {
    const next = rest.trim();
    if (!next) return;
    s.pendingComment = s.pendingComment ? `${s.pendingComment}\n${next}` : next;
  };

  const handlers: Record<string, Handler> = {
    // ── Label dimensions ────────────────────────────────────────────────────
    // PW / LL — extracted to handlers/labelConfig.ts (need dpmm).

    // ── Field family — extracted to handlers/fields.ts.
    // FO, FT, A0, A@, TB, CF, FW, FB, FH, FD, FS, SN, SF, LR, FR,
    // LH, LT, CW, FX, CI, FN, FC, FE.

    // ── Barcode defaults + all ^B* — extracted to handlers/barcodes.ts.
    // BY, BC, B3, BE, BU, B8, B9, B2, BA, B1, BI, BJ, BK, BL, BP, B5,
    // BZ, BS, B4, BM, BR, BQ, BX, B7, B0, BO, BV, BF, BB.

    // ── Graphics ────────────────────────────────────────────────────────────
    // GB, GC, GD, GE, GF, GS, XG, ~DY — extracted to handlers/graphics.ts.
    // The family also owns `pushGBObject` + `commitPendingReverseBg`
    // (used by flushField above via the destructured helpers).

    // ── Ignored / structural ────────────────────────────────────────────────
    // ^XA / ^XZ: label start/end. Reset format-scoped directives so a
    // multi-label stream doesn't leak ^FE/^FC overrides from a prior
    // ^XA…^XZ block into the next one — without this `^FC@^...^XZ^XA`
    // would parse later default-char tokens differently.
    XA: (p, rest) => {
      // Defensive: flush any stash that survived a malformed prior
      // label (missing ^XZ) so it doesn't bleed into the new block.
      commitPendingReverseBg();
      s.embedChar = "#";
      s.clockChars = { ...DEFAULT_CLOCK_CHARS };
      resetComment(p, rest);
    },
    XZ(_, rest) {
      // Flush any orphan reverse-bg before the label boundary so it
      // doesn't leak across labels in a multi-label stream.
      commitPendingReverseBg();
      resetComment(_, rest);
    },
    // FV / FM / FP / JA / JM / JC / JD / JE / JI / JR / JS / JU / PP —
    // noops; FL / HT / LF / IM / ~DG — browser-limit factories. All
    // extracted to handlers/unsupported.ts.
  };

  Object.assign(handlers, createBarcodeHandlers(s));
  Object.assign(handlers, createFieldHandlers(s, labelConfig, { flushField, appendComment }));
  Object.assign(handlers, graphicsFamily.handlers);
  Object.assign(handlers, createSetupScriptHandlers(printerProfile));
  Object.assign(handlers, createLabelConfigHandlers(labelConfig, dpmm));
  Object.assign(handlers, createUnsupportedHandlers({ skipped, browserLimit }));

  // ── Main dispatch loop ─────────────────────────────────────────────────────
  for (const { cmd, rest } of tokens) {
    const p = rest.split(",");
    const handler = handlers[cmd];
    if (handler) {
      handler(p, rest);
      continue;
    }

    // ^A{font}{rotation},{height},{width} — general font command (A0 and A@ are in the map;
    // remaining ^A* variants are dynamic keys that cannot be static map entries).
    if (cmd[0] === "A" && cmd.length === 2) {
      s.fieldType = "text";
      s.textRot = readRotation(rest[0], s.fwRotation);
      s.textH = int(p[1], s.cfHeight || 30);
      s.textW = int(p[2], s.cfWidth || 0);
      const fontChar = cmd[1] ?? "";
      // Round-trip semantics: when the font character matches the
      // current ^CF, treat the field as "use the label default" and
      // leave s.pendingFontId undefined so the model carries no per-field
      // override. Otherwise pin the alias on the field so re-emitting
      // produces the same ^A{id} short form. Unknown aliases (no ^CW
      // and not a built-in) still go through — the printer would fall
      // back to font 0 at print, but storing the user's choice keeps
      // the import lossless for editing.
      if (s.cfFontId && fontChar === s.cfFontId) {
        s.pendingFontId = undefined;
      } else {
        s.pendingFontId = fontChar;
      }
      if (
        !s.fontAliases.has(fontChar) &&
        !ZPL_BUILTIN_FONT_LETTERS.includes(fontChar)
      ) {
        partialCmds.add(`^${cmd}`);
      }
      continue;
    }

    // Record unknown commands (excluding pure whitespace tokens)
    if (rest.trim() || cmd.trim()) {
      const token = `^${cmd}${rest}`;
      skipped.push(token);
      unknown.push(token);
    }
  }

  // Build findings list. `partialCmds` is deduplicated by command code;
  // the others are per-occurrence in encounter order. pageIndex stays 0
  // here; `zplImportService.importZplText` fills it once it knows which
  // ^XA…^XZ block this came from.
  const findings: ImportFinding[] = [
    ...[...partialCmds].map(
      (command): ImportFinding => ({ kind: "partial", command, pageIndex: 0 }),
    ),
    ...browserLimit.map(
      (command): ImportFinding => ({
        kind: "browserLimit",
        command,
        pageIndex: 0,
      }),
    ),
    ...unknown.map(
      (command): ImportFinding => ({ kind: "unknown", command, pageIndex: 0 }),
    ),
  ];

  return {
    labelConfig,
    printerProfile,
    objects,
    variables,
    skipped,
    importReport: {
      findings,
      partial: [...partialCmds],
      browserLimit,
      unknown,
    },
  };
}
