// csvImport.ts is the single source of truth for CSV ingestion. Everything
// that touches CSV data goes through the helpers here — no direct
// `papaparse` import elsewhere. Keeps the strategy-pattern migration to a
// Tauri-streaming backend a single-file refactor (see tauri plan).
import Papa from "papaparse";
import { ok, err, type Result } from "./result";

export interface CsvParseResult {
  /** Header names from the first row, in source order. */
  headers: string[];
  /** Data rows. Each row is an array of strings aligned with `headers`;
   *  ragged rows are padded with empty strings so consumers can index
   *  by column without bounds-checks. */
  rows: string[][];
  source: {
    filename: string;
    /** ISO 8601 UTC timestamp captured at import time. */
    importedAt: string;
    /** Resolved encoding label (e.g. 'utf-8', 'windows-1252'). */
    encoding: string;
    /** Field delimiter auto-detected by PapaParse, or the explicit one
     *  the caller passed. Typical: ',', ';', '\t'. */
    delimiter: string;
    rowCount: number;
  };
}

export type CsvParseError =
  | "read_failed"
  | "parse_failed"
  | "empty"
  | "no_headers";

export interface CsvParseOptions {
  /** Field delimiter override. Empty string (default) lets PapaParse
   *  auto-detect. */
  delimiter?: string;
  /** Pass-through label that ends up in `source.encoding`. Decoding
   *  itself happens before parseCsvText is called (the modal does
   *  it via decodeImportedText); this is purely metadata so the
   *  caller can record which encoding produced the text. */
  encoding?: string;
  /** When false, no row is consumed as header; columns get synthetic
   *  names (`Column 1`, `Column 2`, …) so downstream mapping still
   *  has stable identifiers. Defaults to true. */
  hasHeaderRow?: boolean;
  /** Number of leading rows to discard before the header / first data
   *  row. Lets Excel-exported CSVs with preamble lines parse cleanly.
   *  Defaults to 0. */
  skipRows?: number;
}

/**
 * Parse a CSV file via PapaParse. Returns a Result containing headers,
 * rows, and import metadata. Handles BOM detection, encoding override,
 * and delimiter auto-detection.
 *
 * Design notes:
 * - Header row is required. Files that look truly empty or have only
 *   a header with no data rows still parse successfully (caller can
 *   decide what to do with `rows.length === 0`).
 * - Ragged rows are padded to `headers.length` so downstream code can
 *   index by column without per-row bounds checks.
 * - Whitespace inside cells is preserved verbatim; only trailing CR/LF
 *   from line endings is stripped (PapaParse default).
 */
export async function parseCsvFile(
  file: File,
  options: CsvParseOptions = {},
): Promise<Result<CsvParseResult, CsvParseError>> {
  // Read the file as a string first instead of handing the File to
  // PapaParse's streaming path. Two reasons: (1) modern Blob.text()
  // is universally available and uses the browser's native UTF-8
  // decoder; (2) jsdom's FileReader stub doesn't implement
  // readAsText, which would break unit tests of this helper.
  let text: string;
  try {
    text = await file.text();
  } catch {
    return err("read_failed");
  }
  return parseCsvText(text, { ...options, filename: file.name });
}

/**
 * Parse a CSV string directly. Same output shape as `parseCsvFile`.
 * Exposed so callers that already have the text in hand (the mapping
 * modal re-parses on every options change against the cached raw text)
 * don't pay the file.text() roundtrip again.
 */
export function parseCsvText(
  text: string,
  options: CsvParseOptions & { filename?: string } = {},
): Result<CsvParseResult, CsvParseError> {
  const skipRows = Math.max(0, options.skipRows ?? 0);
  const hasHeaderRow = options.hasHeaderRow !== false;
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
    delimiter: options.delimiter ?? "",
  });
  const dataAll = result.data;
  if (dataAll.length === 0) return err("empty");
  const data = dataAll.slice(skipRows);
  if (data.length === 0) return err("empty");

  let headers: string[];
  let dataRows: string[][];
  if (hasHeaderRow) {
    headers = data[0] ?? [];
    if (headers.length === 0) return err("no_headers");
    dataRows = data.slice(1);
  } else {
    // Synthesise stable column names. Width = max columns across all
    // rows (handles ragged data gracefully).
    const width = Math.max(...data.map((r) => r.length), 0);
    if (width === 0) return err("no_headers");
    headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    dataRows = data;
  }
  // Pad ragged rows so every row has exactly headers.length cells.
  // Excel-exported CSVs sometimes omit trailing empty cells; without
  // padding, downstream lookup-by-index would surface `undefined`
  // and force every consumer to guard against it.
  const rows = dataRows.map((row) => {
    if (row.length === headers.length) return row;
    if (row.length < headers.length) {
      return [...row, ...Array(headers.length - row.length).fill("")];
    }
    return row.slice(0, headers.length);
  });
  return ok({
    headers,
    rows,
    source: {
      filename: options.filename ?? "(pasted)",
      importedAt: new Date().toISOString(),
      encoding: options.encoding ?? "utf-8",
      delimiter: options.delimiter || result.meta.delimiter || ",",
      rowCount: rows.length,
    },
  });
}

/**
 * Module-scope cache for the most-recently-imported CSV's File plus
 * its raw bytes (so encoding changes can re-decode without re-reading
 * the file from disk). `lastImportedText` is the default UTF-8
 * decoding kept around so the common case (no encoding override)
 * doesn't pay a re-decode roundtrip every render.
 *
 * Lives outside the store because (a) File / bytes / text are runtime-
 * only values that can't survive persist/rehydrate, and (b) the
 * mapping modal needs synchronous re-parse on every option-change
 * keystroke. Mirrors the previewCache pattern in labelStore.ts.
 */
let lastImportedFile: File | null = null;
let lastImportedBytes: Uint8Array | null = null;
let lastImportedText: string | null = null;

export function rememberImport(file: File, bytes: Uint8Array, text: string): void {
  lastImportedFile = file;
  lastImportedBytes = bytes;
  lastImportedText = text;
}

export function forgetImport(): void {
  lastImportedFile = null;
  lastImportedBytes = null;
  lastImportedText = null;
}

export function getImportedFile(): File | null {
  return lastImportedFile;
}

export function getImportedText(): string | null {
  return lastImportedText;
}

export function getImportedBytes(): Uint8Array | null {
  return lastImportedBytes;
}

/**
 * Decode the cached raw bytes with the given encoding. Returns null
 * when no CSV is loaded. Uses the platform's TextDecoder so the same
 * set of encodings the browser supports (utf-8, windows-1252,
 * iso-8859-1, utf-16le/be, gbk, shift_jis, …) is available.
 *
 * Invalid encoding labels throw at TextDecoder construction time;
 * the modal validates against a curated dropdown so callers don't
 * surface that path. `fatal: false` (default) means malformed
 * sequences become U+FFFD replacement chars rather than throwing —
 * the UI shows the result and the user adjusts encoding if it looks
 * garbled.
 */
export function decodeImportedText(encoding: string): string | null {
  if (!lastImportedBytes) return null;
  return new TextDecoder(encoding).decode(lastImportedBytes);
}

export const csvParseErrors: Record<CsvParseError, string> = {
  read_failed: "Could not read the file.",
  parse_failed: "Could not parse the CSV. Check delimiter and encoding.",
  empty: "The file appears to be empty.",
  no_headers: "First row is empty; CSV needs a header row.",
};
