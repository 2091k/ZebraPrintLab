import { createBarcode1DCore, type Barcode1DConfig } from './barcode1d';
export type { Barcode1DProps as CodabarProps } from "./barcode1d";

export const codabarConfig: Barcode1DConfig = {
  label: "Codabar",
  icon: "CBA",
  defaultContent: "A12345A",
  hasCheckDigit: true,
  locale: (t) => t.registry.codabar,
  group: 'code-1d',
  contentSpec: { charset: '0-9A-Da-d\\-$:/.+' },
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    const check = p.checkDigit ? "Y" : "N";
    return `^BK${p.rotation},${check},${p.height},${interp},N`;
  },
};

export const codabar = createBarcode1DCore(codabarConfig);
