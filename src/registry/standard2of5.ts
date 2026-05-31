import { createBarcode1DCore, type Barcode1DConfig } from './barcode1d';
export type { Barcode1DProps as Standard2of5Props } from "./barcode1d";

export const standard2of5Config: Barcode1DConfig = {
  label: "Standard 2 of 5",
  icon: "S25",
  defaultContent: "12345678",
  hasCheckDigit: false,
  locale: (t) => t.registry.standard2of5,
  group: 'code-1d',
  contentSpec: { charset: '0-9' },
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    return `^BJ${p.rotation},${p.height},${interp},N`;
  },
};

export const standard2of5 = createBarcode1DCore(standard2of5Config);
