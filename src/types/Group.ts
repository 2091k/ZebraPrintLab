import type { LabelObject } from '../registry';
import type { LabelObjectBase } from './ObjectType';

/**
 * A Group is the only non-leaf node in the object tree. Leaves render and
 * export themselves; groups exist purely as structural containers that
 * cascade lock / visibility / inclusion to their descendants and let the
 * user move, select and reorder a set of objects together.
 *
 * `type: 'group'` is intentionally outside the registry: groups have no
 * `toZPL`, no `defaultSize`, no `PropertiesPanel` — they are handled by
 * tree-walking consumers (render dispatch, ZPL export, layers panel).
 */
export type GroupObject = LabelObjectBase & {
  type: 'group';
  children: LabelObject[];
};

export function isGroup(obj: LabelObject): obj is GroupObject {
  return obj.type === 'group';
}

/**
 * Depth-first walk over a tree of objects. Yields every node (groups and
 * leaves) in render order — children come after their parent so consumers
 * that build z-order arrays can push as they go.
 */
export function* walkObjects(objects: LabelObject[]): Iterable<LabelObject> {
  for (const obj of objects) {
    yield obj;
    if (isGroup(obj)) {
      yield* walkObjects(obj.children);
    }
  }
}

/** Flat list of every leaf descendant of `objects`. Skips group nodes themselves. */
export function getAllLeaves(objects: LabelObject[]): LabelObject[] {
  const out: LabelObject[] = [];
  for (const obj of walkObjects(objects)) {
    if (!isGroup(obj)) out.push(obj);
  }
  return out;
}

/** Find a node by id anywhere in the tree, or undefined if not present. */
export function findObjectById(
  objects: LabelObject[],
  id: string,
): LabelObject | undefined {
  for (const obj of walkObjects(objects)) {
    if (obj.id === id) return obj;
  }
  return undefined;
}

/**
 * Returns the chain of group ancestors of the node with `id`, outermost
 * first. Empty when the node is at the top level or not found.
 */
export function findAncestors(
  objects: LabelObject[],
  id: string,
): GroupObject[] {
  const trail: GroupObject[] = [];
  const visit = (nodes: LabelObject[]): boolean => {
    for (const n of nodes) {
      if (n.id === id) return true;
      if (isGroup(n)) {
        trail.push(n);
        if (visit(n.children)) return true;
        trail.pop();
      }
    }
    return false;
  };
  visit(objects);
  return trail;
}
