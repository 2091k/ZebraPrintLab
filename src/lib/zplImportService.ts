import { parseZPL, type ImportFinding, type ImportReport } from "./zplParser";
import type { LabelConfig } from "../types/ObjectType";
import type { LabelObject } from "../registry";

export interface ZplImportResult {
  labelConfig: Partial<LabelConfig>;
  pages: { objects: LabelObject[] }[];
  report: ImportReport;
}

/**
 * Splits a ZPL stream into one block per `^XA...^XZ` document. Anything before
 * the first `^XA` is discarded. ZPL commands are case-insensitive per spec.
 */
function splitIntoLabelBlocks(zpl: string): string[] {
  // Capture group preserves the matched delimiter so mixed-case (^xa) survives.
  const parts = zpl.split(/(\^XA)/i).slice(1);
  const blocks: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    blocks.push(parts[i] + (parts[i + 1] ?? ''));
  }
  return blocks;
}

export function importZplText(zpl: string, dpmm: number): ZplImportResult {
  const blocks = splitIntoLabelBlocks(zpl);

  if (blocks.length === 0) {
    return {
      labelConfig: {},
      pages: [],
      report: { findings: [], partial: [], browserLimit: [], unknown: [] },
    };
  }

  let labelConfig: Partial<LabelConfig> = {};
  const pages: { objects: LabelObject[] }[] = [];
  const findings: ImportFinding[] = [];

  blocks.forEach((block, i) => {
    const result = parseZPL(block, dpmm);
    pages.push({ objects: result.objects });
    if (i === 0) {
      labelConfig = result.labelConfig;
    }
    // Per-block findings come from the parser with pageIndex=0; stamp the
    // real page index here so the UI can navigate to them.
    for (const f of result.importReport.findings) {
      findings.push({ ...f, pageIndex: i });
    }
  });

  const report: ImportReport = {
    findings,
    // Bucket views stay per-occurrence too (no Set dedup): the modal lists
    // findings one-per-row so it can navigate to each affected page, and
    // legacy text reports / parser tests read these arrays unchanged.
    partial: findings.filter((f) => f.kind === 'partial').map((f) => f.command),
    browserLimit: findings.filter((f) => f.kind === 'browserLimit').map((f) => f.command),
    unknown: findings.filter((f) => f.kind === 'unknown').map((f) => f.command),
  };

  return { labelConfig, pages, report };
}
