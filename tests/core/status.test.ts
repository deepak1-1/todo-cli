// Pure unit tests for src/core/status.ts — no I/O, no DB

import { describe, it, expect } from 'vitest';
import {
    findByKeyOrVerb,
    isComplete,
    isArchived,
    getTransitionTimestamps,
    validStatusKeys,
    resolveStatusOrThrow,
    reconcilePulledStatus,
    archiveTargetKey,
    reopenTargetKey,
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

    it('resolves hyphenated input to underscore key — in-progress → in_progress', () => {
        expect(findByKeyOrVerb(DEFS, 'in-progress')?.key).toBe('in_progress');
    });

    it('resolves all-caps hyphenated — IN-PROGRESS → in_progress', () => {
        expect(findByKeyOrVerb(DEFS, 'IN-PROGRESS')?.key).toBe('in_progress');
    });

    it('resolves mixed-case hyphenated — In-Progress → in_progress', () => {
        expect(findByKeyOrVerb(DEFS, 'In-Progress')?.key).toBe('in_progress');
    });

    it('resolves underscore key with mixed case — In_Progress → in_progress', () => {
        expect(findByKeyOrVerb(DEFS, 'In_Progress')?.key).toBe('in_progress');
    });

    it('finds by exact underscore key — in_progress → in_progress', () => {
        expect(findByKeyOrVerb(DEFS, 'in_progress')?.key).toBe('in_progress');
    });

    it('verb still resolves after normalization — start → in_progress', () => {
        expect(findByKeyOrVerb(DEFS, 'start')?.key).toBe('in_progress');
    });

    it('returns undefined for unknown hyphenated input — in-review-extra', () => {
        expect(findByKeyOrVerb(DEFS, 'in-review-extra')).toBeUndefined();
    });
});

describe('validStatusKeys', () => {
    it('returns comma-separated list of all status keys', () => {
        const result = validStatusKeys(DEFS);
        expect(result).toBe('todo, in_progress, in_review, blocked, done, archived');
    });

    it('returns empty string for empty defs array', () => {
        expect(validStatusKeys([])).toBe('');
    });

    it('contains each expected key in the returned string', () => {
        const result = validStatusKeys(DEFS);
        for (const def of DEFS) {
            expect(result).toContain(def.key);
        }
    });
});

describe('resolveStatusOrThrow', () => {
    it('returns the StatusDef when key matches exactly', () => {
        const def = resolveStatusOrThrow(DEFS, 'done');
        expect(def.key).toBe('done');
        expect(def.completes).toBe(true);
    });

    it('returns the StatusDef when hyphenated input matches — in-progress', () => {
        const def = resolveStatusOrThrow(DEFS, 'in-progress');
        expect(def.key).toBe('in_progress');
    });

    it('returns the StatusDef when verb matches — start → in_progress', () => {
        const def = resolveStatusOrThrow(DEFS, 'start');
        expect(def.key).toBe('in_progress');
    });

    it('throws with message listing all valid keys on unknown input', () => {
        expect(() => resolveStatusOrThrow(DEFS, 'bogus')).toThrow(
            'Invalid status "bogus". Valid statuses: todo, in_progress, in_review, blocked, done, archived',
        );
    });

    it('throws mentioning the exact bad value', () => {
        expect(() => resolveStatusOrThrow(DEFS, 'flying')).toThrow(/Invalid status "flying"/);
    });

    it('throw message lists all expected keys', () => {
        try {
            resolveStatusOrThrow(DEFS, 'bogus');
        } catch (e: unknown) {
            const msg = (e as Error).message;
            for (const def of DEFS) {
                expect(msg).toContain(def.key);
            }
        }
    });

    it('throws for empty defs — no valid statuses to list', () => {
        expect(() => resolveStatusOrThrow([], 'done')).toThrow('Invalid status "done"');
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

describe('reconcilePulledStatus', () => {
    // Case A: remote active + local terminal → reopen.
    it('GitHub open + local done → reopen target (todo)', () => {
        expect(reconcilePulledStatus(DEFS, 'done', { isTerminal: false }, 'todo')).toBe('todo');
    });

    it('GitHub open + local archived → reopen target', () => {
        expect(reconcilePulledStatus(DEFS, 'archived', { isTerminal: false }, 'todo')).toBe('todo');
    });

    it('Jira active concrete target (in_progress) + local done → in_progress', () => {
        expect(reconcilePulledStatus(DEFS, 'done', { activeTarget: 'in_progress', isTerminal: false }, 'todo')).toBe('in_progress');
    });

    it('honors a custom/renamed reopen target when remote has no concrete target', () => {
        // e.g. a user whose active "reopen" status key is "backlog"
        expect(reconcilePulledStatus(DEFS, 'done', { isTerminal: false }, 'backlog')).toBe('backlog');
    });

    it('falls back to reopenTarget when activeTarget is not a known local status', () => {
        // Jira maps to a status the local registry does not have → use the valid reopen target.
        expect(reconcilePulledStatus(DEFS, 'done', { activeTarget: 'Selected for Dev', isTerminal: false }, 'todo')).toBe('todo');
    });

    // Null cases: never clobber active local state, never auto-complete.
    it('GitHub open + local in_progress → null (never downgrade active work)', () => {
        expect(reconcilePulledStatus(DEFS, 'in_progress', { isTerminal: false }, 'todo')).toBeNull();
    });

    it('GitHub open + local in_review → null', () => {
        expect(reconcilePulledStatus(DEFS, 'in_review', { isTerminal: false }, 'todo')).toBeNull();
    });

    it('GitHub open + local todo → null', () => {
        expect(reconcilePulledStatus(DEFS, 'todo', { isTerminal: false }, 'todo')).toBeNull();
    });

    it('remote terminal + local done → null (never auto-complete / no-op)', () => {
        expect(reconcilePulledStatus(DEFS, 'done', { isTerminal: true }, 'todo')).toBeNull();
    });

    it('remote terminal + local in_progress → null (no auto-complete on pull)', () => {
        expect(reconcilePulledStatus(DEFS, 'in_progress', { isTerminal: true }, 'todo')).toBeNull();
    });
});

describe('archiveTargetKey', () => {
    it('returns the first archiving status key', () => {
        expect(archiveTargetKey(DEFS)).toBe('archived');
    });

    it('falls back to "archived" when no status has archives=true', () => {
        const noArchiving = DEFS.filter(d => !d.archives);
        expect(archiveTargetKey(noArchiving)).toBe('archived');
    });

    it('falls back to "archived" for empty defs', () => {
        expect(archiveTargetKey([])).toBe('archived');
    });

    it('picks the first archiving status by array/sort order when multiple exist', () => {
        const multi: StatusDef[] = [
            ...DEFS,
            { key: 'trashed', label: 'Trashed', icon: '🗑', color: 'red', sortOrder: 7, verb: 'trash', completes: false, archives: true, isBuiltin: false },
        ];
        expect(archiveTargetKey(multi)).toBe('archived');
    });
});

describe('reopenTargetKey', () => {
    it('returns the status key whose verb is reopen', () => {
        expect(reopenTargetKey(DEFS)).toBe('todo');
    });

    it('falls back to "todo" when no status has verb=reopen', () => {
        const noReopen = DEFS.filter(d => d.verb !== 'reopen');
        expect(reopenTargetKey(noReopen)).toBe('todo');
    });

    it('falls back to "todo" for empty defs', () => {
        expect(reopenTargetKey([])).toBe('todo');
    });

    it('honors a custom/renamed reopen status key', () => {
        const custom: StatusDef[] = DEFS.map(d => (d.verb === 'reopen' ? { ...d, key: 'backlog' } : d));
        expect(reopenTargetKey(custom)).toBe('backlog');
    });
});
