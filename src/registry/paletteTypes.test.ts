import { describe, it, expect } from 'vitest';
import { PALETTE_TYPES, variantsOfType, defaultPaletteRows } from './paletteTypes';
import { resolveAddable } from './palettePresets';
import { locales } from '../locales';

const en = locales.en;

describe('paletteTypes', () => {
  it('defaultPaletteRows has one row per type at its first variant', () => {
    const rows = defaultPaletteRows();
    expect(rows.map((r) => r.type)).toEqual(PALETTE_TYPES.map((t) => t.id));
    expect(rows[0]).toMatchObject({ type: 'text', variant: 'text' });
  });

  it('every variant of every type resolves (guards drift vs presets/registry)', () => {
    for (const pt of PALETTE_TYPES)
      for (const v of pt.variants)
        expect(resolveAddable(v, en), `${pt.id}/${v}`).not.toBeNull();
  });

  it('shape carries the line/box presets; 1D expands to many symbologies', () => {
    expect(variantsOfType('shape')).toEqual(['line', 'line-diagonal', 'box', 'box-filled', 'ellipse']);
    expect(variantsOfType('code-1d').length).toBeGreaterThan(5);
    expect(variantsOfType('unknown')).toEqual([]);
  });
});
