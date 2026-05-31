import { create, useStore } from 'zustand';
import { temporal } from 'zundo';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ObjectChanges } from '../types/LabelObject';
import { PRINTER_PROFILE_FIELDS } from '../types/PrinterProfile';
import { getEntry } from '../registry';
import {
  isGroup,
  mapObjectById,
  detachObjectById,
  findObjectById,
  findAncestors,
  isSelfOrDescendant,
  type GroupObject,
  type LabelObject,
  type Page,
} from '../types/Group';
import {
  applyObjectChanges,
  insertAt,
  DUPLICATE_OFFSET_DOTS,
  buildOffsetCopies,
  cloneChildrenFresh,
  updateCurrentObjects,
} from './labelStore.internals';
import {
  createPrinterProfileSlice,
  type PrinterProfileSlice,
} from './slices/printerProfileSlice';
import { createUiSlice, type UiSlice } from './slices/uiSlice';
import { createSelectionSlice, type SelectionSlice } from './slices/selectionSlice';
import { createPreviewSlice, type PreviewSlice } from './slices/previewSlice';
import { createCsvSlice, type CsvSlice } from './slices/csvSlice';
import { createVariablesSlice, type VariablesSlice } from './slices/variablesSlice';
import { createLabelConfigSlice, type LabelConfigSlice } from './slices/labelConfigSlice';
import type { Variable, VariableInput } from '../types/Variable';

export { __resetPreviewCacheForTests } from './slices/previewSlice';
export type { ObjectChanges };
export type { Variable, VariableInput };

interface LabelStateBase {
  pages: Page[];
  currentPageIndex: number;

  clipboard: LabelObject[];
  pasteCount: number;

  addObject: (
    type: string,
    position?: { x: number; y: number },
    propsOverride?: object,
  ) => void;
  updateObject: (id: string, changes: ObjectChanges) => void;
  updateObjects: (updates: { id: string; changes: ObjectChanges }[]) => void;
  removeObject: (id: string) => void;
  duplicateObject: (id: string) => void;
  duplicateSelectedObjects: () => void;
  copySelectedObjects: () => void;
  pasteObjects: () => void;
  /** Wraps every selected top-level, unlocked object in a new GroupObject
   *  at the position of the topmost (last-in-array) selected item.
   *  No-op if fewer than one such object is selected. */
  groupSelection: () => void;
  /** Replaces every selected top-level group with its children, splicing
   *  them in at the group's former index. No-op on non-group selections. */
  ungroup: () => void;
  /** Like `ungroup`, but operates on an explicit id list instead of the
   *  active selection. Used by the layers panel's per-row ungroup
   *  button so the user doesn't have to select the group first. */
  ungroupIds: (ids: readonly string[]) => void;
  /** Move `id` to a new position in the tree. `parentId: null` means the
   *  top level; any other value targets a group. `index` is the
   *  insertion position inside the target's children list. Silently
   *  refuses cycles (moving a group into its own descendant). */
  reparentObject: (id: string, target: { parentId: string | null; index: number }) => void;
  /** Append an empty group at the top level (end of the objects array =
   *  front-most layer = topmost row in the layers panel) and select it.
   *  Lets the user create a group up-front and drag items in afterwards
   *  via the layers panel, instead of having to select-then-shortcut. */
  addGroup: () => void;

  moveObjectForward: (id: string) => void;
  moveObjectBackward: (id: string) => void;
  moveObjectToFront: (id: string) => void;
  moveObjectToBack: (id: string) => void;
  reorderObject: (id: string, toIndex: number) => void;

  addPage: () => void;
  removePage: (index: number) => void;
  duplicatePage: (index: number) => void;
  setCurrentPage: (index: number) => void;
}

/** Composed store shape: base fields + every extracted slice. */
export type LabelState =
  & LabelStateBase
  & PrinterProfileSlice
  & UiSlice
  & SelectionSlice
  & PreviewSlice
  & CsvSlice
  & VariablesSlice
  & LabelConfigSlice;

export {
  currentObjects,
  canCallLabelary,
  selectLabelaryNoticeRequired,
  selectPreviewLocksEditor,
  selectBatchInputs,
  selectCanBatchExport,
} from './labelStore.selectors';
import { currentObjects, selectPreviewLocksEditor } from './labelStore.selectors';

export function migrateLegacy(persistedState: unknown, version: number): unknown {
  if (!persistedState || typeof persistedState !== 'object') return persistedState;
  let s = persistedState as Record<string, unknown>;

  // v0→v1: top-level objects array → pages
  if (version < 1 && Array.isArray(s.objects) && !Array.isArray(s.pages)) {
    s = { ...s, pages: [{ objects: s.objects }], currentPageIndex: 0 };
  }

  // v1→v2: viewRotation was added after version 1 shipped; patch it if absent.
  if (version < 2) {
    const cs = s.canvasSettings;
    if (cs && typeof cs === 'object' && !('viewRotation' in cs)) {
      s = { ...s, canvasSettings: { ...(cs as Record<string, unknown>), viewRotation: 0 } };
    }
  }

  // v2→v3: `circle` was folded into `ellipse` with `lockAspect:true`. Old
  // saves still carry `type:'circle'` with `props.diameter`; rewrite them so
  // the rest of the app only ever sees the unified ellipse shape.
  if (version < 3) {
    s = { ...s, pages: migrateCirclesInPages(s.pages) };
  }

  // v3→v4: canvasSettings.csvRenderMode added for the schema/preview toggle.
  // Default to 'preview' so existing sessions keep showing data-substituted
  // canvas exactly as before.
  if (version < 4) {
    const cs = s.canvasSettings;
    if (cs && typeof cs === 'object' && !('csvRenderMode' in cs)) {
      s = { ...s, canvasSettings: { ...(cs as Record<string, unknown>), csvRenderMode: 'preview' } };
    }
  }

  // v4→v5: Setup-Script fields move out of labelConfig into a new
  // printerProfile slice (see PrinterProfile.ts). Extract any of the
  // 14 profile fields that lived on `label`, hoist them onto a fresh
  // `printerProfile`, and strip them from the label so the per-label
  // config no longer carries per-installation state.
  if (version < 5) {
    const label = s.label;
    if (label && typeof label === 'object') {
      const profileFields = new Set<string>(PRINTER_PROFILE_FIELDS);
      const profile: Record<string, unknown> = {};
      const nextLabel: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(label as Record<string, unknown>)) {
        if (profileFields.has(k)) profile[k] = v;
        else nextLabel[k] = v;
      }
      s = { ...s, label: nextLabel, printerProfile: profile };
    }
  }

  // Belt-and-suspenders: any code path that bypasses the v4→v5 hop
  // (manual edits, partial rollbacks, future version-bump that forgets
  // to seed) must still leave `printerProfile` present, otherwise
  // every `s.printerProfile.foo` selector throws on rehydrate.
  if (!('printerProfile' in (s as Record<string, unknown>))) {
    s = { ...s, printerProfile: {} };
  }

  return s;
}

function migrateCirclesInPages(pages: unknown): unknown {
  if (!Array.isArray(pages)) return pages;
  return pages.map((page) => {
    if (!page || typeof page !== 'object') return page;
    const p = page as { objects?: unknown };
    if (!Array.isArray(p.objects)) return page;
    return { ...p, objects: p.objects.map(migrateCircleObject) };
  });
}

function migrateCircleObject(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  const o = obj as { type?: unknown; props?: unknown; children?: unknown };
  if (Array.isArray(o.children)) {
    return { ...o, children: o.children.map(migrateCircleObject) };
  }
  if (o.type !== 'circle' || !o.props || typeof o.props !== 'object') return obj;
  const cp = o.props as { diameter?: number; thickness?: number; filled?: boolean; color?: 'B' | 'W' };
  const d = typeof cp.diameter === 'number' ? cp.diameter : 100;
  return {
    ...o,
    type: 'ellipse',
    props: {
      width: d,
      height: d,
      thickness: typeof cp.thickness === 'number' ? cp.thickness : 3,
      filled: cp.filled === true,
      color: cp.color === 'W' ? 'W' : 'B',
      lockAspect: true,
    },
  };
}

/** localStorage persist subset. `thirdParty` intentionally OUT — build-time
 *  env (VITE_THIRD_PARTY_*) is authoritative until a settings UI lands. */
export const persistPartialize = (state: LabelState) => ({
  label: state.label,
  printerProfile: state.printerProfile,
  pages: state.pages,
  currentPageIndex: state.currentPageIndex,
  locale: state.locale,
  theme: state.theme,
  labelaryNoticeAcknowledged: state.labelaryNoticeAcknowledged,
  canvasSettings: state.canvasSettings,
  variables: state.variables,
  csvMapping: state.csvMapping,
});

/** zundo undo-timeline subset — narrower than persist, only the
 *  document state (label/profile/pages/variables/csvMapping) is undoable. */
export const temporalPartialize = (state: LabelState) => ({
  label: state.label,
  printerProfile: state.printerProfile,
  pages: state.pages,
  currentPageIndex: state.currentPageIndex,
  variables: state.variables,
  csvMapping: state.csvMapping,
});

export const useLabelStore = create<LabelState>()(
  temporal(
    persist(
    (set, get, store) => ({
      ...createPrinterProfileSlice(set, get, store),
      ...createUiSlice(set, get, store),
      ...createSelectionSlice(set, get, store),
      ...createPreviewSlice(set, get, store),
      ...createCsvSlice(set, get, store),
      ...createVariablesSlice(set, get, store),
      ...createLabelConfigSlice(set, get, store),
      pages: [{ objects: [] }],
      currentPageIndex: 0,
      clipboard: [],
      pasteCount: 0,

      addObject: (type, position = { x: 50, y: 50 }, propsOverride) => {
        if (selectPreviewLocksEditor(get())) return;
        const definition = getEntry(type);
        if (!definition) return;

        const obj = {
          id: crypto.randomUUID(),
          type,
          x: position.x,
          y: position.y,
          rotation: 0,
          props: { ...definition.defaultProps, ...propsOverride },
        } as LabelObject;

        set((state) => ({
          ...updateCurrentObjects(state, (objs) => [...objs, obj]),
          selectedIds: [obj.id],
        }));
      },

      updateObject: (id, changes) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const objs = currentObjects(state);
          const ancestorLocked = findAncestors(objs, id).some((g) => !!g.locked);
          return updateCurrentObjects(state, (curr) =>
            mapObjectById(curr, id, (obj) =>
              applyObjectChanges(obj, changes, ancestorLocked),
            ),
          );
        }),

      updateObjects: (updates) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          if (updates.length === 0) return {};
          // Single tree walk that applies every queued change in one
          // pass: O(tree) instead of O(updates × tree). Identity-
          // preserving — subtrees with no matching id keep their
          // reference so React memoisation can skip them. The walk
          // carries inheritedLocked so a leaf inside a locked group
          // sees the cascade without each call re-traversing ancestors.
          const updateMap = new Map(updates.map((u) => [u.id, u.changes]));
          const applyUpdates = (
            nodes: LabelObject[],
            inheritedLocked: boolean,
          ): LabelObject[] => {
            let changed = false;
            const next = nodes.map((n) => {
              const changes = updateMap.get(n.id);
              let updated = changes
                ? applyObjectChanges(n, changes, inheritedLocked)
                : n;
              if (isGroup(updated)) {
                const childLocked = inheritedLocked || !!updated.locked;
                const nextChildren = applyUpdates(updated.children, childLocked);
                if (nextChildren !== updated.children) {
                  updated = { ...updated, children: nextChildren };
                }
              }
              if (updated !== n) changed = true;
              return updated;
            });
            return changed ? next : nodes;
          };
          return updateCurrentObjects(state, (objs) => applyUpdates(objs, false));
        }),

      removeObject: (id) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const obj = currentObjects(state).find((o) => o.id === id);
          if (obj?.locked) return {};
          return {
            ...updateCurrentObjects(state, (objs) => objs.filter((o) => o.id !== id)),
            selectedIds: state.selectedIds.filter((s) => s !== id),
          };
        }),

      duplicateObject: (id) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const copies = buildOffsetCopies(currentObjects(state), [id]);
          if (copies.length === 0) return {};
          return {
            ...updateCurrentObjects(state, (curr) => [...curr, ...copies]),
            selectedIds: copies.map((c) => c.id),
          };
        }),

      duplicateSelectedObjects: () =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          if (state.selectedIds.length === 0) return {};
          const copies = buildOffsetCopies(currentObjects(state), state.selectedIds);
          return {
            ...updateCurrentObjects(state, (curr) => [...curr, ...copies]),
            selectedIds: copies.map((c) => c.id),
          };
        }),

      copySelectedObjects: () => {
        const state = get();
        // Copy doesn't mutate the design, but the clipboard write would
        // create a confusing "I copied something during preview" state.
        if (selectPreviewLocksEditor(state)) return;
        const objs = currentObjects(state);
        const clipboard = state.selectedIds.flatMap((id) => {
          const obj = objs.find((o) => o.id === id);
          if (!obj) return [];
          if (isGroup(obj)) {
            // Clone children too so a later paste produces an
            // independent subtree (paste regenerates the top-level id
            // but expects descendants ready to be inserted as-is).
            return [{ ...obj, children: cloneChildrenFresh(obj.children) }];
          }
          return [{ ...obj, props: { ...obj.props } } as LabelObject];
        });
        set({ clipboard, pasteCount: 0 });
      },

      pasteObjects: () =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          if (state.clipboard.length === 0) return {};
          const pasteCount = state.pasteCount + 1;
          const offset = pasteCount * DUPLICATE_OFFSET_DOTS;
          const copies: LabelObject[] = state.clipboard.map((src) => ({
            ...src,
            id: crypto.randomUUID(),
            x: src.x + offset,
            y: src.y + offset,
          } as LabelObject));
          return {
            ...updateCurrentObjects(state, (curr) => [...curr, ...copies]),
            selectedIds: copies.map((c) => c.id),
            pasteCount,
          };
        }),

      groupSelection: () =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const objs = currentObjects(state);
          const sel = new Set(state.selectedIds);
          // Only consider top-level objects of the current page. Nested
          // children of an existing group are out of scope for v1 — the
          // user would have to ungroup the parent first.
          const candidates = objs.flatMap((o) =>
            sel.has(o.id) && !o.locked ? [o] : [],
          );
          if (candidates.length === 0) return {};
          const candidateIds = new Set(candidates.map((o) => o.id));
          // Insert at the position of the last (topmost in z-order)
          // selected item so the group lands where the user's eye is.
          const lastIndex = objs.reduce(
            (acc, o, i) => (candidateIds.has(o.id) ? i : acc),
            -1,
          );
          const group: GroupObject = {
            id: crypto.randomUUID(),
            type: 'group',
            x: 0,
            y: 0,
            rotation: 0,
            children: candidates,
          };
          const remaining = objs.filter((o) => !candidateIds.has(o.id));
          // lastIndex is computed on the pre-filter array; convert it to
          // the post-filter insertion point by counting how many of the
          // removed items were before it.
          const removedBefore = objs
            .slice(0, lastIndex + 1)
            .filter((o) => candidateIds.has(o.id)).length;
          const insertAt = lastIndex + 1 - removedBefore;
          const next = [
            ...remaining.slice(0, insertAt),
            group,
            ...remaining.slice(insertAt),
          ];
          return {
            ...updateCurrentObjects(state, () => next),
            selectedIds: [group.id],
          };
        }),

      reparentObject: (id, target) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const objs = currentObjects(state);
          // Forbid cycles: moving a group into itself or one of its
          // descendants would orphan the rest of the tree.
          if (target.parentId && isSelfOrDescendant(objs, id, target.parentId)) {
            return {};
          }
          // Refuse drops into something that isn't a group — the layers
          // panel should never produce this, but a defensive check
          // keeps the model from picking up bogus state if a caller
          // passes a leaf id.
          if (target.parentId !== null) {
            const parent = findObjectById(objs, target.parentId);
            if (!parent || !isGroup(parent)) return {};
          }
          const { removed, rest } = detachObjectById(objs, id);
          if (!removed) return {};
          const node = removed;
          if (target.parentId === null) {
            return updateCurrentObjects(state, () => insertAt(rest, target.index, node));
          }
          const next = mapObjectById(rest, target.parentId, (p) =>
            isGroup(p)
              ? { ...p, children: insertAt(p.children, target.index, node) }
              : p,
          );
          return updateCurrentObjects(state, () => next);
        }),

      addGroup: () =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const group: GroupObject = {
            id: crypto.randomUUID(),
            type: 'group',
            x: 0,
            y: 0,
            rotation: 0,
            children: [],
          };
          return {
            ...updateCurrentObjects(state, (objs) => [...objs, group]),
            selectedIds: [group.id],
          };
        }),

      ungroup: () => get().ungroupIds(get().selectedIds),

      ungroupIds: (ids) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const wanted = new Set(ids);
          const objs = currentObjects(state);
          const targets = objs.flatMap((o) =>
            wanted.has(o.id) && isGroup(o) && !o.locked ? [o] : [],
          );
          if (targets.length === 0) return {};
          const targetIds = new Set(targets.map((g) => g.id));
          const next: LabelObject[] = [];
          const newSelection: string[] = [];
          for (const o of objs) {
            if (targetIds.has(o.id) && isGroup(o)) {
              next.push(...o.children);
              newSelection.push(...o.children.map((c) => c.id));
            } else {
              next.push(o);
            }
          }
          return {
            ...updateCurrentObjects(state, () => next),
            selectedIds: newSelection,
          };
        }),

      moveObjectToFront: (id) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const objs = currentObjects(state);
          const idx = objs.findIndex((o) => o.id === id);
          if (idx === -1 || idx === objs.length - 1) return {};
          return updateCurrentObjects(state, (curr) => {
            const next = [...curr];
            const [moved] = next.splice(idx, 1);
            if (moved) next.push(moved);
            return next;
          });
        }),

      moveObjectToBack: (id) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const objs = currentObjects(state);
          const idx = objs.findIndex((o) => o.id === id);
          if (idx <= 0) return {};
          return updateCurrentObjects(state, (curr) => {
            const next = [...curr];
            const [moved] = next.splice(idx, 1);
            if (moved) next.unshift(moved);
            return next;
          });
        }),

      moveObjectForward: (id) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const objs = currentObjects(state);
          const idx = objs.findIndex((o) => o.id === id);
          if (idx === -1 || idx === objs.length - 1) return {};
          return updateCurrentObjects(state, (curr) => {
            const next = [...curr];
            const tmp = next[idx + 1] as LabelObject;
            next[idx + 1] = next[idx] as LabelObject;
            next[idx] = tmp;
            return next;
          });
        }),

      moveObjectBackward: (id) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const objs = currentObjects(state);
          const idx = objs.findIndex((o) => o.id === id);
          if (idx <= 0) return {};
          return updateCurrentObjects(state, (curr) => {
            const next = [...curr];
            const tmp = next[idx - 1] as LabelObject;
            next[idx - 1] = next[idx] as LabelObject;
            next[idx] = tmp;
            return next;
          });
        }),

      reorderObject: (id, toIndex) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const objs = currentObjects(state);
          const fromIndex = objs.findIndex((o) => o.id === id);
          if (fromIndex === -1 || fromIndex === toIndex) return {};
          return updateCurrentObjects(state, (curr) => {
            const next = [...curr];
            const [item] = next.splice(fromIndex, 1);
            if (item) next.splice(toIndex, 0, item);
            return next;
          });
        }),

      addPage: () =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          const insertAt = state.currentPageIndex + 1;
          const newPages = [
            ...state.pages.slice(0, insertAt),
            { objects: [] },
            ...state.pages.slice(insertAt),
          ];
          return {
            pages: newPages,
            currentPageIndex: insertAt,
            selectedIds: [],
          };
        }),

      removePage: (index) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          if (state.pages.length <= 1) return {};
          if (index < 0 || index >= state.pages.length) return {};
          const newPages = state.pages.filter((_, i) => i !== index);
          let newIndex = state.currentPageIndex;
          if (index < state.currentPageIndex) {
            newIndex = state.currentPageIndex - 1;
          } else if (index === state.currentPageIndex) {
            newIndex = Math.min(state.currentPageIndex, newPages.length - 1);
          }
          return {
            pages: newPages,
            currentPageIndex: newIndex,
            selectedIds: [],
          };
        }),

      duplicatePage: (index) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          if (index < 0 || index >= state.pages.length) return {};
          const source = state.pages[index];
          if (!source) return {};
          const cloned: Page = {
            objects: source.objects.map((o) => {
              if (isGroup(o)) {
                return {
                  ...o,
                  id: crypto.randomUUID(),
                  children: cloneChildrenFresh(o.children),
                };
              }
              return {
                ...o,
                id: crypto.randomUUID(),
                props: { ...o.props },
              } as LabelObject;
            }),
          };
          const insertAt = index + 1;
          const newPages = [
            ...state.pages.slice(0, insertAt),
            cloned,
            ...state.pages.slice(insertAt),
          ];
          return {
            pages: newPages,
            currentPageIndex: insertAt,
            selectedIds: [],
          };
        }),

      setCurrentPage: (index) =>
        set((state) => {
          if (selectPreviewLocksEditor(state)) return {};
          if (index < 0 || index >= state.pages.length) return {};
          if (index === state.currentPageIndex) return {};
          return { currentPageIndex: index, selectedIds: [] };
        }),

    }),
    {
      name: 'zpl-designer-session',
      version: 5,
      migrate: (persistedState, version) => migrateLegacy(persistedState, version) as LabelState,
      storage: createJSONStorage(() => localStorage),
      partialize: persistPartialize,
    }
    ),
    {
      partialize: temporalPartialize,
    }
  )
);

export const useCurrentObjects = () => useLabelStore(currentObjects);

/** Non-reactive sibling of `useCurrentObjects` for use inside event handlers
 *  and callbacks where a one-time read is wanted. */
export const getCurrentObjects = (): LabelObject[] =>
  currentObjects(useLabelStore.getState());

// Undo / redo. Wrapping zundo's hook so undo/redo become no-ops while
// the preview overlay is locking the editor. Header buttons read
// `canUndo`/`canRedo` from `pastStates`/`futureStates` — those keep
// reporting truthful values, so a separate UI check (or button
// disabled-state) still wins for visual feedback. The wrapper here is
// the load-bearing safety net for any caller that goes straight to
// `useHistory().undo()`.
const noopHistoryAction = () => {
  /* preview lock: no-op so undo/redo never replay state under a frozen
   * Labelary snapshot. */
};
export const useHistory = () => {
  const history = useStore(useLabelStore.temporal);
  const locked = useLabelStore(selectPreviewLocksEditor);
  if (!locked) return history;
  return { ...history, undo: noopHistoryAction, redo: noopHistoryAction };
};
