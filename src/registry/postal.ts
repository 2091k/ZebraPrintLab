import { createBarcode1DCore, type Barcode1DConfig } from './barcode1d';
export type { Barcode1DProps as PostalProps } from "./barcode1d";

export const postalConfig: Barcode1DConfig = {
  label: "POSTNET",
  icon: "✉Z",
  defaultContent: "12345",
  hasCheckDigit: false,
  locale: (t) => t.registry.postal,
  group: 'code-postal',
  contentSpec: { charset: '0-9' },
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    // ^BZ{orientation},{height},{interp},{startStop}
    return `^BZ${p.rotation},${p.height},${interp},N`;
  },
};

export const postal = createBarcode1DCore(postalConfig);
