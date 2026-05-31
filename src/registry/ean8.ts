import { createBarcode1DCore, type Barcode1DConfig } from './barcode1d';
import { formatEan8Hri } from './hriFormatters';
export type { Barcode1DProps as Ean8Props } from './barcode1d';

export const ean8Config: Barcode1DConfig = {
  label: 'EAN-8',
  icon: 'E8',
  defaultContent: '1234567',
  hasCheckDigit: false,
  locale: (t) => t.registry.ean8,
  group: 'code-1d',
  contentSpec: { charset: '0-9', maxLength: 7 },
  zplCommand: (p) => {
    const interp = p.printInterpretation ? 'Y' : 'N';
    return `^B8${p.rotation},${p.height},${interp},N`;
  },
  hri: { formatHri: formatEan8Hri },
};

export const ean8 = createBarcode1DCore(ean8Config);
