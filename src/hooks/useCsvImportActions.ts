import { useRef, useState, type ChangeEvent } from "react";
import { useLabelStore } from "../store/labelStore";
import { parseCsvFile, csvParseErrors } from "../lib/csvImport";

/** File-picker hook for "Import CSV data" in the File menu. Owns the
 *  hidden <input> ref and the parse-error state. Mirrors the shape of
 *  useDesignFileActions for consistency. Mapping UI lives in Phase 2b. */
export function useCsvImportActions() {
  const loadCsv = useLabelStore((s) => s.loadCsv);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  const handleCsvImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCsvError(null);
    const result = await parseCsvFile(file);
    if (!result.ok) {
      setCsvError(csvParseErrors[result.error]);
      return;
    }
    loadCsv(result.value);
  };

  return {
    csvInputRef,
    handleCsvImport,
    csvError,
    dismissCsvError: () => setCsvError(null),
  };
}
