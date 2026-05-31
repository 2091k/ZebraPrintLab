import { createBarcode1DCore, type Barcode1DConfig } from './barcode1d';
export type { Barcode1DProps as PlanetProps } from "./barcode1d";

export const planetConfig: Barcode1DConfig = {
  label: "Planet Code",
  icon: "✉P",
  defaultContent: "12345678901",
  hasCheckDigit: false,
  locale: (t) => t.registry.planet,
  group: 'code-postal',
  contentSpec: { charset: '0-9' },
  zplCommand: (p) => {
    const interp = p.printInterpretation ? "Y" : "N";
    return `^B5${p.rotation},${p.height},${interp},N`;
  },
};

export const planet = createBarcode1DCore(planetConfig);
