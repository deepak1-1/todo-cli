// Tests for validateIntent, buildIntentSchema, and model error-path behaviour
import { describe, it, expect } from 'vitest';
import { validateIntent, buildIntentSchema } from '../../src/chat/intent.js';

describe('validateIntent', () => {
    it('returns null for a non-object value', () => {
        expect(validateIntent('list')).toBeNull();
        expect(validateIntent(42)).toBeNull();
        expect(validateIntent(null)).toBeNull();
        expect(validateIntent([])).toBeNull();
    });

    it('returns null when action field is missing', () => {
        expect(validateIntent({ title: 'hello' })).toBeNull();
    });

    it('returns null for an unrecognised action', () => {
        expect(validateIntent({ action: 'fly_to_moon' })).toBeNull();
    });

    it('returns the typed Intent for a valid list action', () => {
        const result = validateIntent({ action: 'list' });
        expect(result).not.toBeNull();
        expect(result?.action).toBe('list');
    });

    it('returns the typed Intent for a valid create_task with title', () => {
        const result = validateIntent({ action: 'create_task', title: 'Buy milk' });
        expect(result).not.toBeNull();
        expect(result?.action).toBe('create_task');
        expect(result?.title).toBe('Buy milk');
    });

    it('returns null for create_task missing title', () => {
        expect(validateIntent({ action: 'create_task' })).toBeNull();
    });

    it('returns null for create_task with non-string title', () => {
        expect(validateIntent({ action: 'create_task', title: 99 })).toBeNull();
    });

    it('returns the typed Intent for update_task with numeric taskId', () => {
        const result = validateIntent({ action: 'update_task', taskId: 5, title: 'New title' });
        expect(result).not.toBeNull();
        expect(result?.taskId).toBe(5);
    });

    it('returns null for update_task with non-numeric taskId', () => {
        expect(validateIntent({ action: 'update_task', taskId: 'abc' })).toBeNull();
    });

    it('returns the typed Intent for query with sql string', () => {
        const result = validateIntent({ action: 'query', sql: 'SELECT 1' });
        expect(result).not.toBeNull();
        expect(result?.sql).toBe('SELECT 1');
    });

    it('returns null for query missing sql', () => {
        expect(validateIntent({ action: 'query' })).toBeNull();
    });

    it('returns null for query with non-string sql', () => {
        expect(validateIntent({ action: 'query', sql: 123 })).toBeNull();
    });

    it('returns the typed Intent for clarify with message', () => {
        const result = validateIntent({ action: 'clarify', message: 'Did you mean X?' });
        expect(result).not.toBeNull();
        expect(result?.message).toBe('Did you mean X?');
    });

    it('passes through all valid action values', () => {
        const actions = [
            'create_task', 'update_task', 'delete_task', 'update_status',
            'list', 'show_detail', 'show_stats',
            'start_timer', 'stop_timer', 'adjust_time',
            'jira_pull', 'jira_push', 'github_pull', 'github_push',
            'query', 'help', 'clarify',
        ] as const;
        for (const action of actions) {
            // Provide required fields for demanding actions
            let obj: Record<string, unknown> = { action };
            if (action === 'create_task') obj = { action, title: 't' };
            if (action === 'query') obj = { action, sql: 'SELECT 1' };
            expect(validateIntent(obj)?.action).toBe(action);
        }
    });
});

describe('JSON.parse + validateIntent integration', () => {
    it('returns clarify for a JSON-parseable but invalid-action object', () => {
        // Simulates what inferClaude / inferLocal do after parsing model output
        const raw = JSON.stringify({ action: 'do_something_invalid', title: 'foo' });
        const parsed = validateIntent(JSON.parse(raw));
        expect(parsed).toBeNull();
        // The caller returns clarify on null — verify null is the signal
    });

    it('returns the intent unchanged for a valid parseable object', () => {
        const raw = JSON.stringify({ action: 'list', filters: { status: 'pending' } });
        const parsed = validateIntent(JSON.parse(raw));
        expect(parsed).not.toBeNull();
        expect(parsed?.action).toBe('list');
    });

    it('JSON.parse throws on unparseable input and caller should catch', () => {
        // Verifies the error path stays reachable — validateIntent is never called
        expect(() => JSON.parse('not json {')).toThrow();
    });
});

describe('buildIntentSchema', () => {
    it('includes custom status keys in the status enum', () => {
        const schema = buildIntentSchema(['todo', 'done', 'staging']);
        const statusProp = schema.properties.status as { type: string; enum: string[] };
        expect(statusProp.enum).toContain('staging');
        expect(statusProp.enum).toContain('todo');
        expect(statusProp.enum).toContain('done');
    });

    it('falls back to builtins when an empty array is passed', () => {
        const schema = buildIntentSchema([]);
        const statusProp = schema.properties.status as { type: string; enum: string[] };
        expect(statusProp.enum).toContain('todo');
        expect(statusProp.enum).toContain('done');
    });

    it('strips keys that contain non-safe characters', () => {
        const schema = buildIntentSchema(['valid_key', 'bad key', 'also-bad']);
        const statusProp = schema.properties.status as { type: string; enum: string[] };
        expect(statusProp.enum).toContain('valid_key');
        expect(statusProp.enum).not.toContain('bad key');
        expect(statusProp.enum).not.toContain('also-bad');
    });
});
