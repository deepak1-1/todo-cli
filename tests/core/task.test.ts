import { describe, it, expect } from 'vitest';
import {
    validateCreateInput,
    validateUpdateInput,
    handleRecurringCompletion,
} from '../../src/core/task.js';
import type { Task, CreateTaskInput } from '../../src/core/types.js';

describe('validateCreateInput', () => {
    it('should accept valid input', () => {
        const result = validateCreateInput({ title: 'Test task' });
        expect(result.title).toBe('Test task');
    });

    it('should trim whitespace on title and description', () => {
        const result = validateCreateInput({ title: '  Test task  ', description: '  a note  ' });
        expect(result.title).toBe('Test task');
        expect(result.description).toBe('a note');
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
    it('should accept partial updates and trim title/description', () => {
        const result = validateUpdateInput({ title: 'New title', description: '  trimmed  ' });
        expect(result.title).toBe('New title');
        expect(result.description).toBe('trimmed');
    });

    it('should throw on empty title', () => {
        expect(() => validateUpdateInput({ title: '' })).toThrow('Task title cannot be empty');
    });

    it('should throw on invalid priority', () => {
        expect(() => validateUpdateInput({ priority: 'invalid' as never })).toThrow('Invalid priority');
    });
});

describe('handleRecurringCompletion', () => {
    function makeTask(overrides: Partial<Task>): Task {
        return {
            id: 1,
            title: 'Recurring chore',
            description: '',
            priority: 'medium',
            status: 'done',
            projectId: null,
            dueDate: '2026-06-21',
            recurrence: 'weekly',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
            completedAt: null,
            ...overrides,
        } as Task;
    }

    it('returns null when the task is not recurring', () => {
        const taskRepo = { create: (i: CreateTaskInput) => makeTask({ id: 2, ...i }) };
        const tagRepo = { getTaskTags: () => [] as string[], setTaskTags: () => {} };
        expect(handleRecurringCompletion(makeTask({ recurrence: null }), taskRepo, tagRepo)).toBeNull();
    });

    it('creates the next occurrence and copies tags forward', () => {
        const taskRepo = { create: (i: CreateTaskInput) => makeTask({ id: 2, ...i }) };
        let copied: { id: number; tags: string[] } | null = null;
        const tagRepo = {
            getTaskTags: () => ['frontend', 'api'],
            setTaskTags: (id: number, tags: string[]) => { copied = { id, tags }; },
        };

        const result = handleRecurringCompletion(makeTask({ recurrence: 'weekly' }), taskRepo, tagRepo);

        expect(result).not.toBeNull();
        expect(result!.title).toBe('Recurring chore');
        expect(result!.recurrence).toBe('weekly');
        // Tag-copy branch (core/task.ts:85-86) runs only when the source task has tags
        expect(copied).toEqual({ id: 2, tags: ['frontend', 'api'] });
        // dueDate comes from new Date() internally — assert relatively, never a hardcoded date
        expect(result!.dueDate).toBeTruthy();
        expect(result!.dueDate! > new Date().toISOString().slice(0, 10)).toBe(true);
    });

    it('copies parentId to the regenerated occurrence so subtask stays under same parent', () => {
        let captured: CreateTaskInput | null = null;
        const taskRepo = { create: (i: CreateTaskInput) => { captured = i; return makeTask({ id: 2, ...i }); } };
        const tagRepo = { getTaskTags: () => [] as string[], setTaskTags: () => {} };

        handleRecurringCompletion(makeTask({ recurrence: 'daily', parentId: 7 }), taskRepo, tagRepo);

        expect(captured).not.toBeNull();
        expect((captured as CreateTaskInput).parentId).toBe(7);
    });

    it('new occurrence has parentId null when source has no parent', () => {
        let captured: CreateTaskInput | null = null;
        const taskRepo = { create: (i: CreateTaskInput) => { captured = i; return makeTask({ id: 2, ...i }); } };
        const tagRepo = { getTaskTags: () => [] as string[], setTaskTags: () => {} };

        handleRecurringCompletion(makeTask({ recurrence: 'weekly', parentId: null }), taskRepo, tagRepo);

        expect((captured as CreateTaskInput | null)?.parentId).toBeNull();
    });
});
