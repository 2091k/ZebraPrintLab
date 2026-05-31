import { createBarcode1DCore, type Barcode1DConfig } from './barcode1d';
import type { ContentSpec } from './contentSpec';
import { formatEan13Hri } from './hriFormatters';
export type { Barcode1DProps as Ean13Props } from './barcode1d';

const ean13Spec: ContentSpec = { charset: '0-9', maxLength: 12 };

export const ean13Config: Barcode1DConfig = {
  label: 'EAN-13',
  icon: 'EAN',
  defaultContent: '590123412345',
  hasCheckDigit: false,
  locale: (t) => t.registry.ean13,
  group: 'code-1d',
  contentSpec: ean13Spec,
  zplCommand: (p) => {
    const interp = p.printInterpretation ? 'Y' : 'N';
    return `^BE${p.rotation},${p.height},${interp},N`;
  },
  hri: { formatHri: formatEan13Hri },
};

export const ean13 = createBarcode1DCore(ean13Config);
