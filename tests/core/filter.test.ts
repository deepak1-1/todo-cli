import { describe, it, expect } from 'vitest';
import { fuzzySearch, searchAndLimit } from '../../src/core/filter.js';
import type { TaskWithRelations, SearchResult } from '../../src/core/types.js';

function makeMockTask(overrides: Partial<TaskWithRelations> = {}): TaskWithRelations {
    return {
        id: 1,
        title: 'Default task',
        description: '',
        status: 'pending',
        priority: 'medium',
        projectId: null,
        dueDate: null,
        recurrence: null,
        timeSpent: 0,
        jiraKey: null,
        jiraId: null,
        githubRef: null,
        syncHash: null,
        lastSyncedAt: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        completedAt: null,
        archivedAt: null,
        tagNames: [],
        projectName: null,
        ...overrides,
    };
}

const tasks: TaskWithRelations[] = [
    makeMockTask({ id: 1, title: 'Deploy to production', description: 'Ship the release', tagNames: ['devops'], projectName: 'Backend' }),
    makeMockTask({ id: 2, title: 'Fix login bug', description: 'Users cannot log in with SSO', tagNames: ['bug', 'auth'], projectName: 'Frontend' }),
    makeMockTask({ id: 3, title: 'Write unit tests', description: 'Add coverage for auth module', tagNames: ['testing'], projectName: 'Backend' }),
    makeMockTask({ id: 4, title: 'Update README', description: 'Document deployment process', tagNames: ['docs'], projectName: 'Documentation' }),
    makeMockTask({ id: 5, title: 'Refactor database layer', description: 'Improve query performance', tagNames: ['backend', 'performance'], projectName: null }),
];

describe('fuzzySearch', () => {
    it('should return all tasks when query is empty', () => {
        const result = fuzzySearch(tasks, '');
        expect(result).toHaveLength(tasks.length);
    });

    it('should return all tasks when query is whitespace only', () => {
        const result = fuzzySearch(tasks, '   ');
        expect(result).toHaveLength(tasks.length);
    });

    it('should match by title', () => {
        const result = fuzzySearch(tasks, 'Deploy');
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result[0].title).toBe('Deploy to production');
    });

    it('should match by description', () => {
        const result = fuzzySearch(tasks, 'query performance');
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result.some((t) => t.id === 5)).toBe(true);
    });

    it('should match by tag names', () => {
        const result = fuzzySearch(tasks, 'devops');
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result.some((t) => t.id === 1)).toBe(true);
    });

    it('should match by project name', () => {
        const result = fuzzySearch(tasks, 'Frontend');
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result.some((t) => t.id === 2)).toBe(true);
    });

    it('should be case insensitive', () => {
        const lower = fuzzySearch(tasks, 'deploy');
        const upper = fuzzySearch(tasks, 'DEPLOY');
        const mixed = fuzzySearch(tasks, 'DePlOy');
        expect(lower.length).toBeGreaterThanOrEqual(1);
        expect(lower[0].id).toBe(upper[0].id);
        expect(lower[0].id).toBe(mixed[0].id);
    });

    it('should return empty array when nothing matches', () => {
        const result = fuzzySearch(tasks, 'zzzzxyznonexistent');
        expect(result).toHaveLength(0);
    });

    it('should handle partial matching', () => {
        const result = fuzzySearch(tasks, 'deploy');
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result[0].title).toBe('Deploy to production');
    });

    it('should rank title matches higher than description matches', () => {
        // "Deploy" appears in task 1 title and task 4 description ("deployment")
        const result = fuzzySearch(tasks, 'deploy');
        expect(result.length).toBeGreaterThanOrEqual(1);
        // The task with "Deploy" in the title should come first
        expect(result[0].id).toBe(1);
    });

    it('should work with an empty task list', () => {
        const result = fuzzySearch([], 'anything');
        expect(result).toHaveLength(0);
    });

    it('should work with a single-task list', () => {
        const single = [makeMockTask({ id: 99, title: 'Solo task' })];
        const result = fuzzySearch(single, 'Solo');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(99);
    });

    it('should return SearchResult with _matchedIn property', () => {
        const result: SearchResult[] = fuzzySearch(tasks, 'Deploy');
        expect(result.length).toBeGreaterThanOrEqual(1);
        const titleMatch = result.find(r => r.id === 1)!;
        expect(titleMatch._matchedIn).toBeDefined();
        expect(titleMatch._matchedIn).toContain('title');
    });

    it('should set _matchedIn to "desc" for description-only matches', () => {
        const result: SearchResult[] = fuzzySearch(tasks, 'query performance');
        const match = result.find(r => r.id === 5)!;
        expect(match._matchedIn).toContain('desc');
    });

    it('should set _matchedIn to "tag" for tag-only matches', () => {
        const result: SearchResult[] = fuzzySearch(tasks, 'devops');
        const match = result.find(r => r.id === 1)!;
        expect(match._matchedIn).toContain('tags');
    });

    it('should set _matchedIn to "project" for project-only matches', () => {
        const result: SearchResult[] = fuzzySearch(tasks, 'Documentation');
        const match = result.find(r => r.id === 4)!;
        expect(match._matchedIn).toContain('project');
    });
});

describe('searchAndLimit', () => {
    it('should return all matches when limit is undefined', () => {
        const result = searchAndLimit(tasks, 'a', undefined);
        expect(result).toEqual(fuzzySearch(tasks, 'a'));
    });

    it('should slice matches down to limit', () => {
        const result = searchAndLimit(tasks, 'a', 2);
        expect(result).toHaveLength(2);
    });

    it('should return all matches when limit exceeds match count', () => {
        const result = searchAndLimit(tasks, 'Frontend', 100);
        expect(result).toHaveLength(1);
    });

    it('should preserve input order before slicing (sort-then-limit semantics)', () => {
        const ordered = [tasks[2], tasks[0], tasks[4]];
        const result = searchAndLimit(ordered, 'a', 2);
        expect(result.map(r => r.id)).toEqual([ordered[0].id, ordered[1].id]);
    });

    it('should apply the cap to matches, not to the pre-filter candidate count', () => {
        const many = Array.from({ length: 120 }, (_, i) => makeMockTask({ id: 1000 + i, title: `Filler ${i}` }));
        const withMatch = [...many, makeMockTask({ id: 9999, title: 'Pay invoice ACME' })];
        const result = searchAndLimit(withMatch, 'invoice', 100);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(9999);
    });

    it('should behave like fuzzySearch for empty query regardless of limit', () => {
        const result = searchAndLimit(tasks, '', 2);
        expect(result).toHaveLength(2);
    });
});
