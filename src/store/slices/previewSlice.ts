import type { StateCreator } from 'zustand';
import { fetchPreview, labelaryErrorMessage } from '../../lib/labelary';
import { buildActiveCsvRow } from '../../lib/variableBinding';
import { buildPreviewZpl } from '../../lib/printPreview';
import { currentObjects } from '../labelStore.selectors';
import type { LabelState } from '../labelStore';

/** Labelary-backed canvas overlay. While `active`, the canvas renders
 *  the Labelary-rendered PNG in place of the editor objects so the user
 *  can A/B compare design vs. printed output at the same scale. The
 *  fetch happens on entry and the snapshot is frozen for the lifetime
 *  of the active session — no live refresh — because the comparison
 *  loses meaning if the underlying design shifts under it. */
export type PreviewMode =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'active'; url: string }
  | { status: 'error'; error: string };

/** Single-entry cache for the Labelary preview blob URL, keyed by the
 *  exact ZPL string that produced it. Module-level rather than store-
 *  state because the blob URL is a non-serialisable side-effect handle:
 *  persisting it through `partialize` would resurrect a stale identifier
 *  across reloads, and including it in Zustand state would churn every
 *  selector that observes the store.
 *
 *  The closure owns the URL: `set` revokes the previous blob before
 *  replacing it, so callers can't leak by forgetting to clean up. */
const previewCache = (() => {
  let entry: { zpl: string; url: string } | null = null;
  return {
    get(zpl: string): string | null {
      return entry && entry.zpl === zpl ? entry.url : null;
    },
    set(zpl: string, url: string): void {
      if (entry) URL.revokeObjectURL(entry.url);
      entry = { zpl, url };
    },
    /** Test-only: drop the cached entry without revoking. */
    _resetForTests(): void {
      entry = null;
    },
  };
})();

/** Test-only handle to clear the preview cache between test cases. */
export const __resetPreviewCacheForTests = (): void => previewCache._resetForTests();

export interface PreviewSlice {
  /** `idle` is the editor default; `loading`/`active`/`error` mean the
   *  comparison overlay is in play and editor surfaces are visually locked. */
  previewMode: PreviewMode;
  /** Render the current page to ZPL, fetch the Labelary PNG, swap status
   *  to `active` on success or `error` on failure. Should only be called
   *  when `previewMode.status` is `idle` or `error`. */
  enterPreviewMode: () => Promise<void>;
  /** End the preview session: reset to `idle`. The blob URL stays cached
   *  so a re-toggle skips the fetch. Safe from any non-idle status. */
  exitPreviewMode: () => void;
}

export const createPreviewSlice: StateCreator<LabelState, [], [], PreviewSlice> = (set, get) => ({
  previewMode: { status: 'idle' },

  enterPreviewMode: async () => {
    const state = get();
    if (state.previewMode.status === 'loading' || state.previewMode.status === 'active') {
      return;
    }
    const objs = currentObjects(state);
    const active = buildActiveCsvRow(state.csvDataset, state.csvMapping);
    const zpl = buildPreviewZpl(state.label, objs, state.variables, active);
    // Toggling preview off then on for a side-by-side pixel compare
    // shouldn't burn an API call when nothing changed.
    const cachedUrl = previewCache.get(zpl);
    if (cachedUrl !== null) {
      set({ previewMode: { status: 'active', url: cachedUrl } });
      return;
    }
    set({ previewMode: { status: 'loading' } });
    // Stale-request guard: status check catches an exit mid-fetch; the
    // reference-equality check catches re-entry with a different design
    // (status is `loading` again but for a different request whose result
    // we mustn't overwrite). Refs change on every mutation thanks to
    // immutable updates.
    const isStale = (): boolean =>
      get().previewMode.status !== 'loading' ||
      get().label !== state.label ||
      currentObjects(get()) !== objs;
    try {
      const url = await fetchPreview(zpl, state.label);
      if (isStale()) {
        URL.revokeObjectURL(url);
        return;
      }
      previewCache.set(zpl, url);
      set({ previewMode: { status: 'active', url } });
    } catch (e) {
      if (isStale()) return;
      set({ previewMode: { status: 'error', error: labelaryErrorMessage(e) } });
    }
  },

  exitPreviewMode: () =>
    set((state) => {
      // Blob URL stays in previewCache across exits so a re-toggle skips the fetch.
      if (state.previewMode.status === 'idle') return {};
      return { previewMode: { status: 'idle' } };
    }),
});
