import { useRef, useState, type ChangeEvent } from "react";
import { useLabelStore } from "../store/labelStore";
import {
  parseCsvText,
  rememberImport,
  csvParseErrors,
} from "../lib/csvImport";

/** File-picker hook for "Import CSV data" in the File menu. Owns the
 *  hidden <input> ref and the parse-error state, plus the auto-open
 *  trigger for the mapping modal: imports whose headers don't match
 *  the saved mapping (or whose design has no mapping yet) pop the
 *  modal automatically. Imports with a valid mapping silent-reuse. */
export function useCsvImportActions() {
  const loadCsv = useLabelStore((s) => s.loadCsv);
  const openCsvMappingModal = useLabelStore((s) => s.openCsvMappingModal);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  const handleCsvImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCsvError(null);
    // Read raw bytes up front so the modal can re-decode with a
    // different encoding later (German Excel ANSI exports, etc.)
    // without re-reading from disk. Default decode is UTF-8.
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setCsvError(csvParseErrors.read_failed);
      return;
    }
    const text = new TextDecoder("utf-8").decode(bytes);
    const result = parseCsvText(text, { filename: file.name });
    if (!result.ok) {
      setCsvError(csvParseErrors[result.error]);
      return;
    }
    rememberImport(file, bytes, text);
    loadCsv(result.value);

    // Decide whether to surface the mapping modal. Snapshot the store
    // state after loadCsv so we see the just-imported headers; the
    // mapping itself doesn't change during loadCsv so reading it
    // before vs after is identical.
    const { csvMapping } = useLabelStore.getState();
    const needsMappingReview =
      !csvMapping ||
      !headerArraysEqual(csvMapping.headerSnapshot, result.value.headers);
    if (needsMappingReview) {
      openCsvMappingModal();
    }
  };

  return {
    csvInputRef,
    handleCsvImport,
    csvError,
    dismissCsvError: () => setCsvError(null),
  };
}

function headerArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
