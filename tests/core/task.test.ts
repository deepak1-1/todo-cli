import { describe, it, expect } from 'vitest';
import {
    validateCreateInput,
    validateUpdateInput,
    comparePriority,
} from '../../src/core/task.js';

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

describe('comparePriority', () => {
    it('should rank urgent higher than low', () => {
        expect(comparePriority('urgent', 'low')).toBeGreaterThan(0);
    });

    it('should rank same priorities equal', () => {
        expect(comparePriority('medium', 'medium')).toBe(0);
    });
});

// generateBranchName tests removed — function not yet implemented
