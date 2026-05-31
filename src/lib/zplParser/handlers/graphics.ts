import type { BoxProps } from "../../../registry/box";
import type { EllipseProps } from "../../../registry/ellipse";
import type { ImageProps } from "../../../registry/image";
import type { LineProps } from "../../../registry/line";
import { loadFontBytesSync } from "../../fontCache";
import { formatStoragePath, parseStoragePath } from "../../storagePath";
import type { ParserState } from "../context";
import { decodeGraphicToImage } from "../decoders/graphic";
import { int, makeObj, readRotation } from "../helpers";
import type { Handler } from "../types";

/** Characters of a `^GF`/`~DY` payload retained in browserLimit/skipped
 *  findings; rest is replaced with an ellipsis so a single multi-KB
 *  base64 blob doesn't drown out the import report. */
const IMPORT_FINDING_PAYLOAD_LIMIT = 80;

/** Helpers exposed back to parseZPL.ts so flushField (which lives
 *  there for now — see epic #4) can drive the reverse-bg collapse
 *  protocol without owning the pushGBObject logic. */
export interface GraphicsExports {
  /** Push a stashed reverse-bg as the GB shape it actually was. Called
   *  when the stash didn't pair with a reverse-text on the next field. */
  commitPendingReverseBg: () => void;
  /** Push a ^GB-derived object using the standard line-vs-box detection. */
  pushGBObject: (
    x: number,
    y: number,
    w: number,
    h: number,
    t: number,
    color: "B" | "W",
    rounding: number,
    reverseFlag: boolean | undefined,
    comment: string | undefined,
  ) => void;
  /** Resolve the currently-active reverse flag from ^LR (label-wide) and
   *  ^FR (per-field) state. Returns `true` if either is on, else
   *  `undefined` (NOT `false`) so emit paths that only set the flag
   *  when truthy don't get a useless `reverse: false` field. */
  getReverseFlag: () => boolean | undefined;
}

export interface GraphicsFamily {
  handlers: Record<string, Handler>;
  helpers: GraphicsExports;
}

/** Handlers for the graphic-primitive family (^GB, ^GC, ^GD, ^GE, ^GF,
 *  ^GS, ^XG) plus the ~DY upload preamble. Owns the reverse-text
 *  background collapse protocol (`pushGBObject` + `commitPendingReverseBg`)
 *  and exports both helpers so flushField (still in parseZPL.ts) can
 *  drive the collapse-or-commit decision on the next field. */
export function createGraphicsHandlers(
  s: ParserState,
  takeComment: () => string | undefined,
): GraphicsFamily {
  const getReverseFlag = () => s.lrActive || s.frActive || undefined;

  const pushGBObject: GraphicsExports["pushGBObject"] = (
    gx, gy, w, h, t, color, rounding, reverseFlag, comment,
  ) => {
    if (h === t && w > t) {
      s.objects.push(
        makeObj(
          "line",
          gx,
          gy,
          { angle: 0, length: w, thickness: t, color, reverse: reverseFlag } satisfies LineProps,
          undefined,
          comment,
        ),
      );
    } else if (w === t && h > t) {
      s.objects.push(
        makeObj(
          "line",
          gx,
          gy,
          { angle: 90, length: h, thickness: t, color, reverse: reverseFlag } satisfies LineProps,
          undefined,
          comment,
        ),
      );
    } else {
      const filled = t >= Math.min(w, h);
      s.objects.push(
        makeObj(
          "box",
          gx,
          gy,
          {
            width: w,
            height: h,
            thickness: t,
            filled,
            color,
            rounding,
            reverse: reverseFlag,
          } satisfies BoxProps,
          undefined,
          comment,
        ),
      );
    }
  };

  const commitPendingReverseBg = () => {
    if (!s.pendingReverseBg) return;
    const bg = s.pendingReverseBg;
    s.pendingReverseBg = null;
    pushGBObject(bg.x, bg.y, bg.w, bg.h, bg.t, bg.color, bg.rounding, bg.reverseFlag, bg.comment);
  };

  const handlers: Record<string, Handler> = {
    GB(p) {
      // ^GB{w},{h},{t},{color},{rounding}
      // ZPL: w=0 or h=0 means "use thickness value" for that dimension
      const t = int(p[2], 3);
      const rawW = int(p[0], t);
      const rawH = int(p[1], t);
      const w = rawW === 0 ? t : rawW;
      const h = rawH === 0 ? t : rawH;
      const color = (p[3] ?? "B") as "B" | "W";
      const rounding = int(p[4], 0);
      const gbComment = takeComment();

      // Filled-black non-rounded ^GBs (no active ^LR/^FR) are candidate
      // reverse-text backgrounds — stash them and let flushField
      // collapse the pair when the next field is an ^FR text at the
      // same anchor with matching bbox. Stash is opaque: it stores the
      // raw GB params so the commit path replays through the same
      // line-vs-box detection a direct parse would use (a fat
      // horizontal line and a reverse-bg banner share the same GB
      // shape; only the following ^FR text disambiguates).
      const filled = t >= Math.min(w, h);
      const reverseFlag = getReverseFlag();
      if (filled && color === "B" && rounding === 0 && !reverseFlag) {
        commitPendingReverseBg();
        s.pendingReverseBg = { x: s.x, y: s.y, w, h, t, color, rounding, reverseFlag, comment: gbComment };
        return;
      }
      commitPendingReverseBg();
      pushGBObject(s.x, s.y, w, h, t, color, rounding, reverseFlag, gbComment);
    },
    GD(p) {
      commitPendingReverseBg();
      // ^GD{w},{h},{t},{color},{orientation}
      // orientation: L = top-left→bottom-right, R = top-right→bottom-left
      const gdW = int(p[0], 1);
      const gdH = int(p[1], 1);
      const gdT = int(p[2], 3);
      const gdColor = (p[3] ?? "B") as "B" | "W";
      const gdOri = (p[4] ?? "L").toUpperCase();
      const gdLen = Math.round(Math.sqrt(gdW * gdW + gdH * gdH));
      // Recover start point and angle from bounding-box FO position
      // 'L': dx>0,dy>0 → obj.x=boxX, angle=atan2(h,w)
      // 'R': dx<0,dy>0 → obj.x=boxX+w, angle=atan2(h,-w)
      const gdObjX = gdOri === "R" ? s.x + gdW : s.x;
      const gdAngle = Math.round(
        gdOri === "R"
          ? (Math.atan2(gdH, -gdW) * 180) / Math.PI
          : (Math.atan2(gdH, gdW) * 180) / Math.PI,
      );
      s.objects.push(
        makeObj(
          "line",
          gdObjX,
          s.y,
          {
            angle: gdAngle,
            length: gdLen,
            thickness: gdT,
            color: gdColor,
            reverse: getReverseFlag(),
          } satisfies LineProps,
          undefined,
          takeComment(),
        ),
      );
    },
    GF(_, rest) {
      commitPendingReverseBg();
      // ^GF{A|B|C},{totalBytes},{totalBytes},{bytesPerRow},{payload}
      //
      // Payload variants the parser understands:
      //   - format=A + raw hex (optionally with G-Y/g-z/!/,/: RLE)
      //   - any format + `:B64:<base64>:<crc>` wrapper (base64-decoded)
      //   - any format + `:Z64:<base64>:<crc>` wrapper (zlib-inflated via
      //     fflate). CRC mismatch → partial finding (printers tolerate),
      //     inflate failure → browserLimit (payload unrecoverable).
      const format = rest[0]?.toUpperCase();
      if (format !== "A" && format !== "B" && format !== "C") {
        s.skipped.push(`^GF${rest}`);
        s.browserLimit.push(`^GF${rest}`);
        return;
      }

      // Extract params: skip "A," then find 3rd comma to separate params from data
      const gfRest = rest.slice(2); // "total,total,bytesPerRow,data..."
      let commaPos = -1;
      for (let n = 0; n < 3; n++) {
        commaPos = gfRest.indexOf(",", commaPos + 1);
        if (commaPos === -1) break;
      }
      if (commaPos === -1) {
        s.skipped.push(`^GF${rest}`);
        return;
      }

      const gfParams = gfRest.slice(0, commaPos).split(",");
      const gfBytesPerRow = int(gfParams[2], 0);
      // Everything after the 3rd comma is the (possibly compressed) graphic data
      const gfRawData = gfRest.slice(commaPos + 1);

      if (gfBytesPerRow <= 0) {
        s.skipped.push(`^GF${rest}`);
        return;
      }

      const gfSummary = `^GF${rest.slice(0, IMPORT_FINDING_PAYLOAD_LIMIT)}…`;
      // Preserve the source bytes-headers verbatim so re-export keeps the
      // firmware's input-buffer hint intact (^GFC/:Z64: has total ≠ data).
      const gfImage = decodeGraphicToImage(
        gfRawData,
        format,
        gfBytesPerRow,
        gfParams[0] ?? "",
        gfParams[1] ?? "",
        `imported_${crypto.randomUUID().slice(0, 8)}.png`,
      );
      if (!gfImage) {
        s.skipped.push(gfSummary);
        s.browserLimit.push(gfSummary);
        return;
      }
      if (!gfImage.crcOk) s.partialCmds.add("^GF");
      const posType: "FT" | "FO" = s.positionIsFT ? "FT" : "FO";
      s.objects.push(
        makeObj(
          "image",
          s.x,
          s.y,
          {
            imageId: gfImage.imageId,
            widthDots: gfImage.widthDots,
            threshold: 128,
            _gfaCache: gfImage.gfaCache,
          } satisfies ImageProps,
          posType,
          takeComment(),
        ),
      );
    },
    GE(p) {
      commitPendingReverseBg();
      // ^GE{w},{h},{t},{color}
      const w = int(p[0], 100);
      const h = int(p[1], 100);
      const t = int(p[2], 3);
      const color = (p[3] ?? "B") as "B" | "W";
      const filled = t >= Math.min(w, h);
      s.objects.push(
        makeObj(
          "ellipse",
          s.x,
          s.y,
          {
            width: w,
            height: h,
            // Preserve the original thickness (same rationale as ^GB) so a
            // ZPL round-trip is lossless. UI sets sensible defaults when
            // the user toggles `filled` off; the parser stays faithful.
            thickness: t,
            filled,
            color,
            reverse: getReverseFlag(),
          } satisfies EllipseProps,
          undefined,
          takeComment(),
        ),
      );
    },
    GC(p) {
      commitPendingReverseBg();
      // ^GC{diameter},{thickness},{color}  → circle = ellipse with equal w/h
      const d = int(p[0], 100);
      const t = int(p[1], 3);
      const color = (p[2] ?? "B") as "B" | "W";
      const filled = t >= d;
      s.objects.push(
        makeObj(
          "ellipse",
          s.x,
          s.y,
          {
            width: d,
            height: d,
            thickness: t,
            filled,
            color,
            lockAspect: true,
            reverse: getReverseFlag(),
          } satisfies EllipseProps,
          undefined,
          takeComment(),
        ),
      );
    },

    // ── Recall stored graphic ──────────────────────────────────────────────
    XG(_, rest) {
      commitPendingReverseBg();
      // ^XGd:f.x,mx,my — references a graphic uploaded earlier via ~DY.
      // Two valid imports:
      //  - With preceding ~DY in the stream: full image (bytes + storedAs
      //    with embedInZpl=true) so re-emit produces the same upload+recall.
      //  - Without ~DY: the printer is assumed to host the file out-of-band
      //    (admin pre-loaded). Object gets storedAs.embedInZpl=false and
      //    no cached bitmap; the canvas falls back to a placeholder, the
      //    emitter skips the ~DY preamble but keeps the ^XG reference.
      const firstComma = rest.indexOf(",");
      const xgPath = firstComma === -1 ? rest : rest.slice(0, firstComma);
      const parsed = parseStoragePath(xgPath);
      if (!parsed) {
        s.skipped.push(`^XG${rest}`);
        s.browserLimit.push(`^XG${rest}`);
        return;
      }
      const uploaded = s.downloadedGraphics.get(formatStoragePath(parsed, true));
      const posType: "FT" | "FO" = s.positionIsFT ? "FT" : "FO";
      if (uploaded) {
        s.objects.push(
          makeObj(
            "image",
            s.x,
            s.y,
            {
              imageId: uploaded.imageId,
              widthDots: uploaded.widthDots,
              threshold: 128,
              _gfaCache: uploaded.gfaCache,
              storedAs: { ...parsed, embedInZpl: true },
            } satisfies ImageProps,
            posType,
            takeComment(),
          ),
        );
        return;
      }
      // Recall-only: no bytes available, but the ZPL is valid and the
      // printer side is assumed to resolve. Surface as partial so the
      // import report flags the degraded preview.
      s.partialCmds.add("^XG");
      s.objects.push(
        makeObj(
          "image",
          s.x,
          s.y,
          {
            imageId: "",
            widthDots: 200,
            threshold: 128,
            storedAs: { ...parsed, embedInZpl: false },
          } satisfies ImageProps,
          posType,
          takeComment(),
        ),
      );
    },

    // ^GS{rotation},{height},{width} — selects the internal-font
    // legal-symbol glyph (^FD picks which: A=®, B=©, C=™, D=UL, E=CSA).
    GS(p) {
      s.fieldType = "symbol";
      s.symRot = readRotation(p[0]);
      s.symH = int(p[1], 30);
      s.symW = int(p[2], s.symH);
    },

    // ── ~DY downloaded TrueType / graphic payload ──────────────────────────
    // ~DY{drive}:{name},{fmt},{ext},{size},{bpr},{data}
    // Decodes ASCII hex (format 'A') TTF/OTF bytes into the font cache
    // so the canvas can preview the embedded font without a separate
    // upload. The path reconstruction (stem + extension code) round-
    // trips the same form the generator emits. Non-TTF extensions and
    // non-hex formats are left untouched and fall through to the
    // browser-limit bucket so the user sees what was dropped.
    DY(_p, rest) {
      // Parse manually because the data segment can be hundreds of
      // KB of hex; we want to avoid splitting that into the rest of
      // the params array. Param layout up to and including bytes-per-
      // row is fixed-arity, so we walk commas until we've found 5.
      const c: number[] = [];
      for (let i = 0; i < rest.length && c.length < 5; i++) {
        if (rest[i] === ",") c.push(i);
      }
      if (c.length < 5) {
        s.browserLimit.push(`~DY${rest}`);
        return;
      }
      const [c0, c1, c2, c3, c4] = c;
      if (
        c0 === undefined ||
        c1 === undefined ||
        c2 === undefined ||
        c3 === undefined ||
        c4 === undefined
      ) {
        s.browserLimit.push(`~DY${rest}`);
        return;
      }
      const path = rest.slice(0, c0);
      const fmt = rest.slice(c0 + 1, c1).toUpperCase();
      const extCode = rest.slice(c1 + 1, c2).toUpperCase();
      const size = parseInt(rest.slice(c2 + 1, c3), 10);
      const dyBytesPerRow = parseInt(rest.slice(c3 + 1, c4), 10);
      const data = rest.slice(c4 + 1);
      const dySummary = `~DY${rest.slice(0, IMPORT_FINDING_PAYLOAD_LIMIT)}…`;

      // Graphic uploads (~DY ...,A/B/C,G,...): decode via the same payload
      // pipeline as ^GF, register the resulting image under the full
      // device:stem.GRF path. A subsequent ^XG can then instantiate it.
      if (extCode === "G" && (fmt === "A" || fmt === "B" || fmt === "C")) {
        if (!path || isNaN(dyBytesPerRow) || dyBytesPerRow <= 0) {
          s.skipped.push(dySummary);
          s.browserLimit.push(dySummary);
          return;
        }
        const sizeStr = size > 0 ? String(size) : "";
        const dyImage = decodeGraphicToImage(
          data,
          fmt,
          dyBytesPerRow,
          sizeStr,
          sizeStr,
          `uploaded_${path.replace(/[:.]/g, "_")}.png`,
        );
        if (!dyImage) {
          s.skipped.push(dySummary);
          s.browserLimit.push(dySummary);
          return;
        }
        if (!dyImage.crcOk) s.partialCmds.add("~DY");
        // Path normalisation: ~DY uses `device:stem` without extension; the
        // ^XG side resolves `device:stem.GRF`. Store the `.GRF` form so the
        // XG lookup is direct.
        const parsedDyPath = parseStoragePath(path);
        if (!parsedDyPath) {
          s.skipped.push(dySummary);
          s.browserLimit.push(dySummary);
          return;
        }
        s.downloadedGraphics.set(formatStoragePath(parsedDyPath, true), {
          imageId: dyImage.imageId,
          widthDots: dyImage.widthDots,
          heightDots: dyImage.heightDots,
          gfaCache: dyImage.gfaCache,
        });
        return;
      }

      // Only ASCII-hex TTF/OTF imports are supported. Z64 / compressed
      // payloads need a CRC-checked decoder and stay out of scope.
      if (fmt !== "A" || (extCode !== "T" && extCode !== "B")) {
        s.browserLimit.push(dySummary);
        return;
      }
      if (!path || isNaN(size) || size <= 0 || data.length < size * 2) {
        s.browserLimit.push(dySummary);
        return;
      }
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        const byteHex = data.slice(i * 2, i * 2 + 2);
        const b = parseInt(byteHex, 16);
        if (isNaN(b)) {
          s.browserLimit.push(dySummary);
          return;
        }
        bytes[i] = b;
      }
      // Reconstruct the full filename with extension so the registered
      // name matches what ^CW points at. Generator emits "{stem}" with
      // the extension stripped, so we re-attach based on the code.
      const ext = extCode === "T" ? ".TTF" : ".BIN";
      const filename = path.includes(".")
        ? path.slice(path.lastIndexOf(":") + 1)
        : `${path.slice(path.indexOf(":") + 1)}${ext}`;
      const fullPath = path.includes(".") ? path : `${path}${ext}`;
      try {
        loadFontBytesSync(bytes, filename);
        s.downloadedFontPaths.add(fullPath);
      } catch {
        // Oversized or otherwise unloadable — surface as browser-limit.
        s.browserLimit.push(`~DY${path}`);
      }
    },
  };

  return {
    handlers,
    helpers: { commitPendingReverseBg, pushGBObject, getReverseFlag },
  };
}
