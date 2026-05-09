import { describe, it, expect } from 'vitest';
import { kbd } from './kbd';

/** The test environment's navigator has no userAgent/platform, so isMac
 *  resolves to false. We assert the non-Mac branch here; the Mac branch
 *  is exercised by hand in the browser. */
describe('kbd', () => {
  it('uses Ctrl+ on non-Mac platforms', () => {
    expect(kbd('Z')).toBe('Ctrl+Z');
  });

  it('inserts Shift+ when requested', () => {
    expect(kbd('Z', { shift: true })).toBe('Ctrl+Shift+Z');
  });
});
