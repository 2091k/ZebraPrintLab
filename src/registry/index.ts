import type { ObjectTypeCore, ObjectTypeUi } from '../types/ObjectType';

export type { LeafObject } from './leafObject';

import { text } from './text.tsx';
import { code128 } from './code128.tsx';
import { code39 } from './code39.tsx';
import { ean13 } from './ean13.tsx';
import { qrcode } from './qrcode.tsx';
import { datamatrix } from './datamatrix.tsx';
import { box } from './box';
import { boxPanel } from './box.panel';
import { ellipse } from './ellipse.tsx';
import { line } from './line.tsx';
import { serial } from './serial.tsx';
import { image } from './image.tsx';
import { upca } from './upca.tsx';
import { ean8 } from './ean8.tsx';
import { upce } from './upce.tsx';
import { interleaved2of5 } from './interleaved2of5.tsx';
import { code93 } from './code93.tsx';
import { pdf417 } from './pdf417.tsx';
import { code11 } from './code11.tsx';
import { industrial2of5 } from './industrial2of5.tsx';
import { standard2of5 } from './standard2of5.tsx';
import { codabar } from './codabar.tsx';
import { logmars } from './logmars.tsx';
import { msi } from './msi.tsx';
import { plessey } from './plessey.tsx';
import { gs1databar } from './gs1databar.tsx';
import { planet } from './planet.tsx';
import { postal } from './postal.tsx';
import { aztec } from './aztec.tsx';
import { micropdf417 } from './micropdf417.tsx';
import { codablock } from './codablock.tsx';
import { upcEanExtension } from './upcEanExtension.tsx';
import { code49 } from './code49.tsx';
import { maxicode } from './maxicode.tsx';
import { symbol } from './symbol.tsx';

export const BARCODE_1D_TYPES = new Set([
  'code128', 'code39', 'ean13', 'ean8', 'upca', 'upce', 'interleaved2of5', 'code93',
  'code11', 'industrial2of5', 'standard2of5', 'codabar', 'logmars', 'msi', 'plessey',
  'gs1databar', 'planet', 'postal', 'upcEanExtension', 'code49',
]);

export const STACKED_2D_TYPES = new Set(['pdf417', 'micropdf417', 'codablock']);

// `any`: each entry has a different concrete `P`. Bundled `.tsx` entries
// satisfy both maps via structural typing; discriminated map deferred until
// all entries split (Stage 7).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ObjectRegistry: Record<string, ObjectTypeCore<any>> = {
  // text
  text,
  symbol,
  // code-1d (frequency order)
  code128,
  ean13,
  upca,
  code39,
  interleaved2of5,
  gs1databar,
  ean8,
  upce,
  upcEanExtension,
  code49,
  logmars,
  code93,
  codabar,
  code11,
  industrial2of5,
  standard2of5,
  msi,
  plessey,
  // code-2d (frequency order)
  qrcode,
  datamatrix,
  pdf417,
  aztec,
  maxicode,
  micropdf417,
  codablock,
  // code-postal
  planet,
  postal,
  // shape
  box,
  ellipse,
  line,
  serial,
  image,
};

/** Per-type PropertiesPanel components, keyed by registry type. Same
 *  key set as {@link ObjectRegistry}; parity enforced by
 *  `registry-isolation.test.ts`. Lives separate so the Core registry
 *  stays React-shape-free (zplGenerator imports Core without UI). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ObjectPanels: Record<string, ObjectTypeUi<any>> = {
  text,
  symbol,
  code128,
  ean13,
  upca,
  code39,
  interleaved2of5,
  gs1databar,
  ean8,
  upce,
  upcEanExtension,
  code49,
  logmars,
  code93,
  codabar,
  code11,
  industrial2of5,
  standard2of5,
  msi,
  plessey,
  qrcode,
  datamatrix,
  pdf417,
  aztec,
  maxicode,
  micropdf417,
  codablock,
  planet,
  postal,
  box: boxPanel,
  ellipse,
  line,
  serial,
  image,
};
