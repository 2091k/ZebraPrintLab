import { describe, it, expect } from 'vitest';
import {
  isGroup,
  walkObjects,
  getAllLeaves,
  findObjectById,
  findAncestors,
  type GroupObject,
} from './Group';
import type { LabelObject } from '../registry';

function leaf(id: string): LabelObject {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    rotation: 0,
    props: { text: '', fontHeight: 20, font: '0', interpretation: false },
  } as LabelObject;
}

function group(id: string, children: LabelObject[]): GroupObject {
  return { id, type: 'group', x: 0, y: 0, rotation: 0, children };
}

describe('Group helpers', () => {
  describe('isGroup', () => {
    it('discriminates leaves from groups', () => {
      expect(isGroup(leaf('a'))).toBe(false);
      expect(isGroup(group('g', []))).toBe(true);
    });
  });

  describe('walkObjects', () => {
    it('yields nodes depth-first, parent before children', () => {
      const tree: LabelObject[] = [
        leaf('a'),
        group('g1', [leaf('b'), group('g2', [leaf('c')]), leaf('d')]),
        leaf('e'),
      ];
      const ids = [...walkObjects(tree)].map((o) => o.id);
      expect(ids).toEqual(['a', 'g1', 'b', 'g2', 'c', 'd', 'e']);
    });

    it('handles empty input', () => {
      expect([...walkObjects([])]).toEqual([]);
    });
  });

  describe('getAllLeaves', () => {
    it('returns only leaves, skipping group nodes', () => {
      const tree: LabelObject[] = [
        leaf('a'),
        group('g1', [leaf('b'), group('g2', [leaf('c')])]),
      ];
      expect(getAllLeaves(tree).map((o) => o.id)).toEqual(['a', 'b', 'c']);
    });

    it('returns empty for a tree of only empty groups', () => {
      expect(getAllLeaves([group('g', [group('g2', [])])])).toEqual([]);
    });
  });

  describe('findObjectById', () => {
    it('finds top-level leaves', () => {
      expect(findObjectById([leaf('a')], 'a')?.id).toBe('a');
    });

    it('finds nested leaves', () => {
      const tree = [group('g', [group('g2', [leaf('deep')])])];
      expect(findObjectById(tree, 'deep')?.id).toBe('deep');
    });

    it('finds groups themselves', () => {
      const tree = [group('g', [leaf('child')])];
      expect(findObjectById(tree, 'g')?.type).toBe('group');
    });

    it('returns undefined for missing ids', () => {
      expect(findObjectById([leaf('a')], 'missing')).toBeUndefined();
    });
  });

  describe('findAncestors', () => {
    it('returns empty for top-level objects', () => {
      expect(findAncestors([leaf('a')], 'a')).toEqual([]);
    });

    it('returns the group chain outermost first', () => {
      const inner = group('g2', [leaf('deep')]);
      const outer = group('g1', [inner]);
      const tree = [outer];
      const ancestors = findAncestors(tree, 'deep');
      expect(ancestors.map((g) => g.id)).toEqual(['g1', 'g2']);
    });

    it('returns empty for missing ids', () => {
      expect(findAncestors([leaf('a')], 'missing')).toEqual([]);
    });
  });
});
