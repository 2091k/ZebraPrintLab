import { createBarcode1DCore, type Barcode1DConfig } from './barcode1d';
export type { Barcode1DProps as PlesseyProps } from "./barcode1d";

export const plesseyConfig: Barcode1DConfig = {
  label: "Plessey",
  icon: "PLS",
  defaultContent: "12345678",
  hasCheckDigit: true,
  locale: (t) => t.registry.plessey,
  group: 'code-1d',
  contentSpec: { charset: '0-9A-Fa-f' },
  // Plessey uses 2:1 wide:narrow ratio (same as MSI); override ZPL default of 3.0
  byRatio: 2,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    const check = p.checkDigit ? "Y" : "N";
    return `^BP${p.rotation},${check},${p.height},${interp},N`;
  },
};

export const plessey = createBarcode1DCore(plesseyConfig);
