import type { LabelObjectBase } from '../types/LabelObject';
import type { TextProps } from './text.tsx';
import type { Code128Props } from './code128.tsx';
import type { Code39Props } from './code39.tsx';
import type { Ean13Props } from './ean13.tsx';
import type { QrCodeProps } from './qrcode.tsx';
import type { DataMatrixProps } from './datamatrix.tsx';
import type { BoxProps } from './box';
import type { EllipseProps } from './ellipse.tsx';
import type { LineProps } from './line.tsx';
import type { SerialProps } from './serial.tsx';
import type { ImageProps } from './image.tsx';
import type { UpcAProps } from './upca.tsx';
import type { Ean8Props } from './ean8.tsx';
import type { UpcEProps } from './upce.tsx';
import type { Interleaved2of5Props } from './interleaved2of5.tsx';
import type { Code93Props } from './code93.tsx';
import type { Pdf417Props } from './pdf417.tsx';
import type { Code11Props } from './code11.tsx';
import type { Industrial2of5Props } from './industrial2of5.tsx';
import type { Standard2of5Props } from './standard2of5.tsx';
import type { CodabarProps } from './codabar.tsx';
import type { LogmarsProps } from './logmars.tsx';
import type { MsiProps } from './msi.tsx';
import type { PlesseyProps } from './plessey.tsx';
import type { Gs1DatabarProps } from './gs1databar.tsx';
import type { PlanetProps } from './planet.tsx';
import type { PostalProps } from './postal.tsx';
import type { AztecProps } from './aztec.tsx';
import type { MicroPdf417Props } from './micropdf417.tsx';
import type { CodablockProps } from './codablock.tsx';
import type { UpcEanExtensionProps } from './upcEanExtension.tsx';
import type { Code49Props } from './code49.tsx';
import type { MaxicodeProps } from './maxicode.tsx';
import type { SymbolProps } from './symbol.tsx';

/** Single-branch shape for one registry type: the common base plus a
 *  literal `type` discriminator and that type's props. */
type Leaf<T extends string, P extends object> = LabelObjectBase & { type: T; props: P };

/** Discriminated union of every registry-backed leaf type. Lives in a
 *  type-only module so `types/Group.ts` can import it without dragging
 *  the runtime `registry/index.ts` (and its .tsx imports) into the
 *  module graph — at runtime this file resolves to an empty module. */
export type LeafObject =
  | Leaf<'text', TextProps>
  | Leaf<'code128', Code128Props>
  | Leaf<'code39', Code39Props>
  | Leaf<'ean13', Ean13Props>
  | Leaf<'qrcode', QrCodeProps>
  | Leaf<'datamatrix', DataMatrixProps>
  | Leaf<'box', BoxProps>
  | Leaf<'ellipse', EllipseProps>
  | Leaf<'line', LineProps>
  | Leaf<'serial', SerialProps>
  | Leaf<'image', ImageProps>
  | Leaf<'upca', UpcAProps>
  | Leaf<'ean8', Ean8Props>
  | Leaf<'upce', UpcEProps>
  | Leaf<'interleaved2of5', Interleaved2of5Props>
  | Leaf<'code93', Code93Props>
  | Leaf<'pdf417', Pdf417Props>
  | Leaf<'code11', Code11Props>
  | Leaf<'industrial2of5', Industrial2of5Props>
  | Leaf<'standard2of5', Standard2of5Props>
  | Leaf<'codabar', CodabarProps>
  | Leaf<'logmars', LogmarsProps>
  | Leaf<'msi', MsiProps>
  | Leaf<'plessey', PlesseyProps>
  | Leaf<'gs1databar', Gs1DatabarProps>
  | Leaf<'planet', PlanetProps>
  | Leaf<'postal', PostalProps>
  | Leaf<'aztec', AztecProps>
  | Leaf<'micropdf417', MicroPdf417Props>
  | Leaf<'codablock', CodablockProps>
  | Leaf<'upcEanExtension', UpcEanExtensionProps>
  | Leaf<'code49', Code49Props>
  | Leaf<'maxicode', MaxicodeProps>
  | Leaf<'symbol', SymbolProps>;
