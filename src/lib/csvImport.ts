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
   *  auto-detect. Phase 2b adds an encoding override too, paired with
   *  a TextDecoder-backed reader path that actually applies it. */
  delimiter?: string;
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
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
    delimiter: options.delimiter ?? "",
  });
  const data = result.data;
  if (data.length === 0) return err("empty");
  const headers = data[0] ?? [];
  if (headers.length === 0) return err("no_headers");
  // Pad ragged rows so every row has exactly headers.length cells.
  // Excel-exported CSVs sometimes omit trailing empty cells; without
  // padding, downstream lookup-by-index would surface `undefined`
  // and force every consumer to guard against it.
  const rows = data.slice(1).map((row) => {
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
      filename: file.name,
      importedAt: new Date().toISOString(),
      encoding: "utf-8",
      delimiter: options.delimiter || result.meta.delimiter || ",",
      rowCount: rows.length,
    },
  });
}

export const csvParseErrors: Record<CsvParseError, string> = {
  read_failed: "Could not read the file.",
  parse_failed: "Could not parse the CSV. Check delimiter and encoding.",
  empty: "The file appears to be empty.",
  no_headers: "First row is empty; CSV needs a header row.",
};
