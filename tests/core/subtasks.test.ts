import { describe, it, expect } from 'vitest';
import { wouldCreateParentCycle, rollupProgress, orderAsTree } from '../../src/core/task.js';

describe('wouldCreateParentCycle', () => {
    // chain: 1 <- 2 <- 3  (getParent(3)=2, getParent(2)=1, getParent(1)=null)
    const chain = new Map<number, number | null>([[1, null], [2, 1], [3, 2]]);
    const getParent = (id: number) => chain.get(id) ?? null;

    it('rejects making a task its own parent', () => {
        expect(wouldCreateParentCycle(5, 5, getParent)).toBe(true);
    });

    it('rejects a direct ancestor as parent', () => {
        // making 1 a child of 2 — 1 is 2's ancestor
        expect(wouldCreateParentCycle(1, 2, getParent)).toBe(true);
    });

    it('rejects a deep (grandparent) ancestor as parent', () => {
        // making 1 a child of 3 — 1 is 3's grandparent
        expect(wouldCreateParentCycle(1, 3, getParent)).toBe(true);
    });

    it('allows an unrelated parent', () => {
        expect(wouldCreateParentCycle(4, 2, getParent)).toBe(false);
    });

    it('allows attaching to a root', () => {
        expect(wouldCreateParentCycle(4, 1, getParent)).toBe(false);
    });

    it('terminates on a pre-existing corrupt cycle instead of looping forever', () => {
        const corrupt = new Map<number, number | null>([[10, 11], [11, 10]]);
        expect(wouldCreateParentCycle(99, 10, (id) => corrupt.get(id) ?? null)).toBe(false);
    });
});

describe('rollupProgress', () => {
    it('formats done/total', () => {
        expect(rollupProgress(1, 3)).toBe('1/3 done');
    });
    it('is empty when there are no children', () => {
        expect(rollupProgress(0, 0)).toBe('');
    });
});

describe('orderAsTree', () => {
    const mk = (id: number, parentId: number | null) => ({ id, parentId });

    it('orders parents before children depth-first with depth map', () => {
        const { ordered, depths } = orderAsTree([mk(3, 2), mk(1, null), mk(2, 1)]);
        expect(ordered.map((t) => t.id)).toEqual([1, 2, 3]);
        expect(depths.get(1)).toBe(0);
        expect(depths.get(2)).toBe(1);
        expect(depths.get(3)).toBe(2);
    });

    it('treats a child whose parent is filtered out as a root', () => {
        // parent 1 absent from the set; 2 should render as a root at depth 0
        const { ordered, depths } = orderAsTree([mk(2, 1), mk(3, 2)]);
        expect(ordered.map((t) => t.id)).toEqual([2, 3]);
        expect(depths.get(2)).toBe(0);
        expect(depths.get(3)).toBe(1);
    });

    it('preserves sibling input order', () => {
        const { ordered } = orderAsTree([mk(1, null), mk(3, 1), mk(2, 1)]);
        expect(ordered.map((t) => t.id)).toEqual([1, 3, 2]);
    });

    it('grandchild whose parent AND grandparent are both absent is treated as root at depth 0', () => {
        // grandparent(1) and parent(2) are filtered out; only grandchild(3) is in the set
        const { ordered, depths } = orderAsTree([mk(3, 2)]);
        expect(ordered.map((t) => t.id)).toEqual([3]);
        expect(depths.get(3)).toBe(0);
    });

    it('handles empty input gracefully', () => {
        const { ordered, depths } = orderAsTree([]);
        expect(ordered).toEqual([]);
        expect(depths.size).toBe(0);
    });
});
