import { describe, it, expect } from 'vitest';
import {
    validateCreateInput,
    validateUpdateInput,
    isValidTransition,
    validateTransition,
    getTransitionTimestamps,
    comparePriority,
} from '../../src/core/task.js';
import type { Task, TaskStatus } from '../../src/core/types.js';

describe('validateCreateInput', () => {
    it('should accept valid input', () => {
        const result = validateCreateInput({ title: 'Test task' });
        expect(result.title).toBe('Test task');
    });

    it('should trim whitespace', () => {
        const result = validateCreateInput({ title: '  Test task  ' });
        expect(result.title).toBe('Test task');
    });

    it('should throw on empty title', () => {
        expect(() => validateCreateInput({ title: '' })).toThrow('Task title cannot be empty');
    });

    it('should throw on whitespace-only title', () => {
        expect(() => validateCreateInput({ title: '   ' })).toThrow('Task title cannot be empty');
    });

    it('should throw on invalid priority', () => {
        expect(() => validateCreateInput({ title: 'Test', priority: 'invalid' as any })).toThrow('Invalid priority');
    });

    it('should accept valid priorities', () => {
        for (const p of ['urgent', 'high', 'medium', 'low'] as const) {
            const result = validateCreateInput({ title: 'Test', priority: p });
            expect(result.priority).toBe(p);
        }
    });
});

describe('validateUpdateInput', () => {
    it('should accept partial updates', () => {
        const result = validateUpdateInput({ title: 'New title' });
        expect(result.title).toBe('New title');
    });

    it('should throw on empty title', () => {
        expect(() => validateUpdateInput({ title: '' })).toThrow('Task title cannot be empty');
    });
});

describe('isValidTransition', () => {
    it('should allow pending -> in_progress', () => {
        expect(isValidTransition('pending', 'in_progress')).toBe(true);
    });

    it('should allow pending -> done', () => {
        expect(isValidTransition('pending', 'done')).toBe(true);
    });

    it('should allow done -> pending (reopen)', () => {
        expect(isValidTransition('done', 'pending')).toBe(true);
    });

    it('should allow archived -> pending (reopen)', () => {
        expect(isValidTransition('archived', 'pending')).toBe(true);
    });

    it('should allow archived -> in_progress (unrestricted)', () => {
        expect(isValidTransition('archived', 'in_progress')).toBe(true);
    });

    it('should allow done -> in_progress (restart)', () => {
        expect(isValidTransition('done', 'in_progress')).toBe(true);
    });
});

describe('validateTransition', () => {
    const makeTask = (status: TaskStatus): Task => ({
        id: 1, title: 'Test', description: '', status, priority: 'medium',
        projectId: null, dueDate: null, recurrence: null, timeSpent: 0,
        jiraKey: null, jiraId: null, githubRef: null, gitlabRef: null,
        linearRef: null, syncHash: null, lastSyncedAt: null,
        createdAt: '', updatedAt: '', completedAt: null, archivedAt: null,
    });

    it('should not throw on valid transition', () => {
        expect(() => validateTransition(makeTask('pending'), 'in_progress')).not.toThrow();
    });

    it('should not throw on any valid status transition (unrestricted)', () => {
        expect(() => validateTransition(makeTask('archived'), 'in_progress')).not.toThrow();
    });

    it('should throw on invalid status string', () => {
        expect(() => validateTransition(makeTask('pending'), 'invalid_status' as TaskStatus)).toThrow();
    });
});

describe('getTransitionTimestamps', () => {
    it('should set completedAt for done', () => {
        const ts = getTransitionTimestamps('done');
        expect(ts.completedAt).toBeTruthy();
    });

    it('should set archivedAt for archived', () => {
        const ts = getTransitionTimestamps('archived');
        expect(ts.archivedAt).toBeTruthy();
    });

    it('should clear timestamps for pending', () => {
        const ts = getTransitionTimestamps('pending');
        expect(ts.completedAt).toBeNull();
        expect(ts.archivedAt).toBeNull();
    });
});

describe('comparePriority', () => {
    it('should rank urgent higher than low', () => {
        expect(comparePriority('urgent', 'low')).toBeGreaterThan(0);
    });

    it('should rank same priorities equal', () => {
        expect(comparePriority('medium', 'medium')).toBe(0);
    });
});

// generateBranchName tests removed — function not yet implemented
