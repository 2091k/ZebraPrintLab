import { useState } from "react";
import {
  currentObjects,
  selectBatchInputs,
  selectCanBatchExport,
  useLabelStore,
} from "../store/labelStore";
import { generateMultiPageZPL, generateBatchZpl } from "../lib/zplGenerator";
import { printLabel } from "../lib/printPreview";
import { triggerDownload } from "../lib/triggerDownload";
import { labelaryErrorMessage } from "../lib/labelary";
import { buildActiveCsvRow } from "../lib/variableBinding";

export function useZplImportExport() {
  // Reactive: only what the UI rendering needs (menu enable +
  // label-count text). Event handlers below all read a fresh
  // snapshot via `useLabelStore.getState()` so generator inputs
  // come from the same point in time and the hook doesn't re-
  // render on every label / page / variable edit.
  const canBatchExport = useLabelStore(selectCanBatchExport);
  const batchRowCount = useLabelStore((s) => s.csvDataset?.rows.length ?? 0);

  const [showZplImport, setShowZplImport] = useState(false);
  const [showZebraPrint, setShowZebraPrint] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  const handleDownload = () => {
    const s = useLabelStore.getState();
    const zpl = generateMultiPageZPL(s.label, s.pages, s.variables);
    triggerDownload(new Blob([zpl], { type: "text/plain" }), "label.zpl");
  };

  const handleExportBatch = () => {
    const s = useLabelStore.getState();
    const batch = selectBatchInputs(s);
    if (!batch) return;
    const zpl = generateBatchZpl(
      s.label, currentObjects(s), s.variables, batch.dataset, batch.mapping,
    );
    triggerDownload(new Blob([zpl], { type: "text/plain" }), "label-batch.zpl");
  };

  // Print previews via Labelary, which renders one image at a time. We send
  // only the current page so the preview matches what the user sees. The
  // active CSV row (if any) is substituted into bound fields so the
  // preview reflects what would actually print for the selected row.
  const handlePrint = async () => {
    const s = useLabelStore.getState();
    try {
      const active = buildActiveCsvRow(s.csvDataset, s.csvMapping);
      await printLabel(s.label, currentObjects(s), s.variables, active);
    } catch (e) {
      setPrintError(labelaryErrorMessage(e));
    }
  };

  // ZPL surfaced to direct-print: batch form when a CSV is in play (so
  // sending to the printer produces N labels), otherwise the same
  // template the editor displays.
  const currentZpl = () => {
    const s = useLabelStore.getState();
    const batch = selectBatchInputs(s);
    return batch
      ? generateBatchZpl(
          s.label, currentObjects(s), s.variables, batch.dataset, batch.mapping,
        )
      : generateMultiPageZPL(s.label, s.pages, s.variables);
  };

  return {
    showZplImport,
    openZplImport: () => setShowZplImport(true),
    closeZplImport: () => setShowZplImport(false),
    showZebraPrint,
    openZebraPrint: () => setShowZebraPrint(true),
    closeZebraPrint: () => setShowZebraPrint(false),
    currentZpl,
    printError,
    dismissPrintError: () => setPrintError(null),
    handleDownload,
    handleExportBatch,
    canBatchExport,
    batchRowCount,
    handlePrint,
  };
}
