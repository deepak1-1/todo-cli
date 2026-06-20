// Pure unit tests for src/core/status.ts — no I/O, no DB

import { describe, it, expect } from 'vitest';
import {
    findByKeyOrVerb,
    isComplete,
    isArchived,
    getTransitionTimestamps,
} from '../../src/core/status.js';
import type { StatusDef } from '../../src/core/status.js';

// Minimal builtin set matching migration 006 seed
const DEFS: StatusDef[] = [
    { key: 'todo',        label: 'To Do',       icon: '○', color: 'gray',   sortOrder: 1, verb: 'reopen',  completes: false, archives: false, isBuiltin: true },
    { key: 'in_progress', label: 'In Progress', icon: '◐', color: 'cyan',   sortOrder: 2, verb: 'start',   completes: false, archives: false, isBuiltin: true },
    { key: 'in_review',   label: 'In Review',   icon: '◔', color: 'yellow', sortOrder: 3, verb: 'review',  completes: false, archives: false, isBuiltin: true },
    { key: 'blocked',     label: 'Blocked',     icon: '⊘', color: 'red',    sortOrder: 4, verb: 'block',   completes: false, archives: false, isBuiltin: true },
    { key: 'done',        label: 'Done',        icon: '✓', color: 'green',  sortOrder: 5, verb: 'done',    completes: true,  archives: false, isBuiltin: true },
    { key: 'archived',    label: 'Archived',    icon: '⌀', color: 'dim',    sortOrder: 6, verb: 'archive', completes: false, archives: true,  isBuiltin: true },
];

describe('findByKeyOrVerb', () => {
    it('finds by exact key', () => {
        const def = findByKeyOrVerb(DEFS, 'done');
        expect(def?.key).toBe('done');
    });

    it('finds by verb — reopen → todo', () => {
        const def = findByKeyOrVerb(DEFS, 'reopen');
        expect(def?.key).toBe('todo');
    });

    it('finds by verb — review → in_review', () => {
        const def = findByKeyOrVerb(DEFS, 'review');
        expect(def?.key).toBe('in_review');
    });

    it('finds by verb — start → in_progress', () => {
        const def = findByKeyOrVerb(DEFS, 'start');
        expect(def?.key).toBe('in_progress');
    });

    it('finds by verb — done → done', () => {
        const def = findByKeyOrVerb(DEFS, 'done');
        expect(def?.key).toBe('done');
    });

    it('finds by verb — archive → archived', () => {
        const def = findByKeyOrVerb(DEFS, 'archive');
        expect(def?.key).toBe('archived');
    });

    it('returns undefined for unknown input', () => {
        expect(findByKeyOrVerb(DEFS, 'qa')).toBeUndefined();
        expect(findByKeyOrVerb(DEFS, 'pending')).toBeUndefined();
        expect(findByKeyOrVerb(DEFS, 'in_qa')).toBeUndefined();
        expect(findByKeyOrVerb(DEFS, 'flying')).toBeUndefined();
    });

    it('is case-insensitive', () => {
        expect(findByKeyOrVerb(DEFS, 'DONE')?.key).toBe('done');
        expect(findByKeyOrVerb(DEFS, 'Review')?.key).toBe('in_review');
        expect(findByKeyOrVerb(DEFS, 'REOPEN')?.key).toBe('todo');
    });

    it('returns undefined for empty string', () => {
        expect(findByKeyOrVerb(DEFS, '')).toBeUndefined();
    });

    it('returns undefined for empty defs array', () => {
        expect(findByKeyOrVerb([], 'done')).toBeUndefined();
    });
});

describe('isComplete', () => {
    it('done → true (completes=true)', () => {
        expect(isComplete(DEFS, 'done')).toBe(true);
    });

    it('archived → false (archives but does not complete)', () => {
        expect(isComplete(DEFS, 'archived')).toBe(false);
    });

    it('todo → false', () => {
        expect(isComplete(DEFS, 'todo')).toBe(false);
    });

    it('in_progress → false', () => {
        expect(isComplete(DEFS, 'in_progress')).toBe(false);
    });

    it('in_review → false', () => {
        expect(isComplete(DEFS, 'in_review')).toBe(false);
    });

    it('blocked → false', () => {
        expect(isComplete(DEFS, 'blocked')).toBe(false);
    });

    it('unknown key → false (not in defs)', () => {
        expect(isComplete(DEFS, 'pending')).toBe(false);
        expect(isComplete(DEFS, 'flying')).toBe(false);
    });
});

describe('isArchived', () => {
    it('archived → true (archives=true)', () => {
        expect(isArchived(DEFS, 'archived')).toBe(true);
    });

    it('done → false (completes but does not archive)', () => {
        expect(isArchived(DEFS, 'done')).toBe(false);
    });

    it('todo → false', () => {
        expect(isArchived(DEFS, 'todo')).toBe(false);
    });

    it('in_progress → false', () => {
        expect(isArchived(DEFS, 'in_progress')).toBe(false);
    });

    it('unknown key → false', () => {
        expect(isArchived(DEFS, 'pending')).toBe(false);
    });
});

describe('getTransitionTimestamps', () => {
    it('done → completedAt set, archivedAt absent', () => {
        const ts = getTransitionTimestamps(DEFS, 'done');
        expect(ts.completedAt).toBeTruthy();
        expect(ts.archivedAt).toBeUndefined();
    });

    it('archived → archivedAt set, completedAt absent', () => {
        const ts = getTransitionTimestamps(DEFS, 'archived');
        expect(ts.archivedAt).toBeTruthy();
        expect(ts.completedAt).toBeUndefined();
    });

    it('todo → both cleared (completedAt null, archivedAt null)', () => {
        const ts = getTransitionTimestamps(DEFS, 'todo');
        expect(ts.completedAt).toBeNull();
        expect(ts.archivedAt).toBeNull();
    });

    it('in_progress → both cleared', () => {
        const ts = getTransitionTimestamps(DEFS, 'in_progress');
        expect(ts.completedAt).toBeNull();
        expect(ts.archivedAt).toBeNull();
    });

    it('in_review → both cleared', () => {
        const ts = getTransitionTimestamps(DEFS, 'in_review');
        expect(ts.completedAt).toBeNull();
        expect(ts.archivedAt).toBeNull();
    });

    it('blocked → both cleared', () => {
        const ts = getTransitionTimestamps(DEFS, 'blocked');
        expect(ts.completedAt).toBeNull();
        expect(ts.archivedAt).toBeNull();
    });

    it('unknown key → returns empty object (no timestamps)', () => {
        const ts = getTransitionTimestamps(DEFS, 'pending');
        expect(Object.keys(ts)).toHaveLength(0);
    });

    it('completedAt is ISO 8601 when set', () => {
        const ts = getTransitionTimestamps(DEFS, 'done');
        expect(ts.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('archivedAt is ISO 8601 when set', () => {
        const ts = getTransitionTimestamps(DEFS, 'archived');
        expect(ts.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
