import { describe, it, expect } from 'vitest';
import { hasCycle, topologicalSort } from '../../src/core/dependency.js';

describe('hasCycle', () => {
    it('should detect no cycle in a DAG', () => {
        expect(hasCycle([
            { from: 1, to: 2 },
            { from: 2, to: 3 },
        ])).toBe(false);
    });

    it('should detect a simple cycle', () => {
        expect(hasCycle([
            { from: 1, to: 2 },
            { from: 2, to: 1 },
        ])).toBe(true);
    });

    it('should detect a 3-node cycle', () => {
        expect(hasCycle([
            { from: 1, to: 2 },
            { from: 2, to: 3 },
            { from: 3, to: 1 },
        ])).toBe(true);
    });

    it('should handle empty edges', () => {
        expect(hasCycle([])).toBe(false);
    });

    it('should handle disconnected components', () => {
        expect(hasCycle([
            { from: 1, to: 2 },
            { from: 3, to: 4 },
        ])).toBe(false);
    });
});

describe('topologicalSort', () => {
    it('should sort a simple DAG', () => {
        const result = topologicalSort([
            { from: 1, to: 2 },
            { from: 2, to: 3 },
        ]);
        expect(result).not.toBeNull();
        expect(result!.indexOf(1)).toBeLessThan(result!.indexOf(2));
        expect(result!.indexOf(2)).toBeLessThan(result!.indexOf(3));
    });

    it('should return null for a cycle', () => {
        const result = topologicalSort([
            { from: 1, to: 2 },
            { from: 2, to: 1 },
        ]);
        expect(result).toBeNull();
    });

    it('should handle empty edges', () => {
        const result = topologicalSort([]);
        expect(result).toEqual([]);
    });
});
