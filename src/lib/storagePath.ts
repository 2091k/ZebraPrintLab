/**
 * Helpers for Zebra storage paths: `device:name` (no extension) and
 * `device:name.ext` (with extension). The two forms appear in different
 * ZPL commands — `~DY` headers use the bare form (extension is encoded
 * in a separate param), `^XG` references use the dot-suffixed form.
 *
 * Keeping the parse/format pair in one place stops the two forms from
 * drifting apart across the parser, emitter, and image registry.
 */

/** Storage device prefixes Zebra firmware recognises. R: volatile RAM
 *  (default, fastest); E: non-volatile flash; B: alternate flash;
 *  A: alias drive on some models. All four round-trip through `~DY` and
 *  `^XG`; the parser accepts them and the UI exposes them in the device
 *  picker. */
export const STORAGE_DEVICES = ["R", "E", "B", "A"] as const;
export type StorageDevice = (typeof STORAGE_DEVICES)[number];

/** Zebra DOS-style filename: up to 8 chars, uppercase alphanumeric +
 *  underscore. Both constants are exported so input filters in the UI
 *  and the parser stay in lockstep. */
export const MAX_STORAGE_NAME_LEN = 8;
export const STORAGE_NAME_FILTER_RE = /[^A-Z0-9_]/g;

/** Default name when the user first enables printer-storage on an image.
 *  Short UUID slice avoids collisions across multiple images on the same
 *  label without forcing the user to pick a name up front. */
export function defaultStorageName(): string {
  return `IMG_${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

export interface StoragePath {
  /** Storage device prefix without trailing colon: "R", "E", "B", "A". */
  device: string;
  /** Filename stem (no extension). */
  name: string;
}

/** Extension paired with `^GF`-shaped graphic uploads. Zebra firmware
 *  persists `~DY{path},*,G,...` as `{path}.GRF` on the device. */
const GRAPHIC_EXT = "GRF";

/**
 * Parse a `device:name` or `device:name.ext` storage path into structured
 * parts. The extension (if any) is dropped — callers re-attach via
 * `formatStoragePath` when emitting. Returns null when the input lacks a
 * `:` separator, signalling a malformed path.
 */
export function parseStoragePath(raw: string): StoragePath | null {
  const colonAt = raw.indexOf(":");
  if (colonAt <= 0) return null;
  const device = raw.slice(0, colonAt);
  const stemWithExt = raw.slice(colonAt + 1);
  // Drop everything from the last `.` onwards. dotAt === 0 means the
  // stem starts with a dot (only an extension) — treat as malformed via
  // the empty-name guard below.
  const dotAt = stemWithExt.lastIndexOf(".");
  const name = dotAt === -1 ? stemWithExt : stemWithExt.slice(0, dotAt);
  if (!name) return null;
  return { device, name };
}

/**
 * Render a storage path back to its ZPL form. `withExt: true` produces
 * `device:name.GRF` (for `^XG` recalls); `withExt: false` produces the
 * bare `device:name` (for `~DY` headers, where the extension is encoded
 * in the next param instead).
 */
export function formatStoragePath(p: StoragePath, withExt: boolean): string {
  return withExt ? `${p.device}:${p.name}.${GRAPHIC_EXT}` : `${p.device}:${p.name}`;
}
