import type { ObjectGroup } from '../../types/ObjectType';
import type { EllipseProps } from '../../registry/ellipse';

/**
 * Palette-only sugar entries: surface alternative starting configs for a
 * registry type without inflating the type union. The "Circle" entry
 * instantiates an `ellipse` with `lockAspect: true` so the transformer
 * keeps it square; round-trips through ^GC on export and ^GC on import
 * preserve the flag, so the file format stays canonical.
 */
export interface VirtualPaletteEntry {
  /** Unique key inside the palette ("circle"). Does NOT collide with
   *  registry types — those use their own key directly. */
  id: string;
  /** Registry type to instantiate. */
  type: string;
  group: ObjectGroup;
  icon: string;
  /** Key into `t.types` for the visible label. */
  labelKey: string;
  /** Display label fallback when the locale is missing the key. */
  fallbackLabel: string;
  /** Default size used by the drop-on-canvas position centring math. */
  defaultSize: { width: number; height: number };
  /** Merged on top of the registry type's `defaultProps` at creation. */
  propsOverride: object;
}

export const VIRTUAL_PALETTE_ENTRIES: VirtualPaletteEntry[] = [
  {
    id: 'circle',
    type: 'ellipse',
    group: 'shape',
    icon: '●',
    labelKey: 'circle',
    fallbackLabel: 'Circle',
    defaultSize: { width: 100, height: 100 },
    propsOverride: {
      width: 100,
      height: 100,
      lockAspect: true,
    } satisfies Partial<EllipseProps>,
  },
];
