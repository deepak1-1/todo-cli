// Unit tests for emptyStateMessage utility
import { describe, it, expect } from 'vitest';
import { emptyStateMessage } from '../../src/utils/empty-state.js';
import type { EmptyStateEntity } from '../../src/utils/empty-state.js';

const ALL_ENTITIES: EmptyStateEntity[] = ['tasks', 'projects', 'tags', 'sessions', 'history', 'integrations', 'plugins'];

describe('emptyStateMessage', () => {
    it('returns "No <entity> found." when no filters are given', () => {
        for (const entity of ALL_ENTITIES) {
            expect(emptyStateMessage(entity)).toBe(`No ${entity} found.`);
        }
    });

    it('returns "No <entity> found." when filters object is empty', () => {
        expect(emptyStateMessage('tasks', {})).toBe('No tasks found.');
    });

    it('includes a single filter key=value in the message', () => {
        const msg = emptyStateMessage('tasks', { priority: 'high' });
        expect(msg).toBe('No tasks match the filters (priority=high).');
    });

    it('includes multiple filter key=value pairs separated by comma', () => {
        const msg = emptyStateMessage('tasks', { priority: 'high', project: 'My App' });
        expect(msg).toContain('priority=high');
        expect(msg).toContain('project=My App');
        expect(msg).toMatch(/^No tasks match the filters \(.+\)\.$/);
    });

    it('joins array filter values with commas', () => {
        const msg = emptyStateMessage('tasks', { tag: ['backend', 'api'] });
        expect(msg).toBe('No tasks match the filters (tag=backend,api).');
    });

    it('omits undefined and null filter values', () => {
        const msg = emptyStateMessage('tasks', { priority: 'high', status: undefined, project: null as unknown as undefined });
        expect(msg).toBe('No tasks match the filters (priority=high).');
    });

    it('omits empty-string filter values', () => {
        const msg = emptyStateMessage('tasks', { priority: '', status: 'pending' });
        expect(msg).toBe('No tasks match the filters (status=pending).');
    });

    it('falls back to "No <entity> found." when all filter values are empty/null/undefined', () => {
        const msg = emptyStateMessage('projects', { name: '', id: undefined });
        expect(msg).toBe('No projects found.');
    });

    it('handles tags entity correctly', () => {
        expect(emptyStateMessage('tags')).toBe('No tags found.');
    });

    it('handles sessions entity with filters', () => {
        const msg = emptyStateMessage('sessions', { taskId: '5' });
        expect(msg).toBe('No sessions match the filters (taskId=5).');
    });
});
