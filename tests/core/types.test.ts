import { describe, it, expect } from 'vitest';
import { normalizeStatus, normalizePriority } from '../../src/core/types.js';

describe('normalizeStatus', () => {
    it('should return "done" for "done"', () => {
        expect(normalizeStatus('done')).toBe('done');
    });

    it('should return "in_progress" for "in_progress"', () => {
        expect(normalizeStatus('in_progress')).toBe('in_progress');
    });

    it('should convert hyphen to underscore: "in-progress" -> "in_progress"', () => {
        expect(normalizeStatus('in-progress')).toBe('in_progress');
    });

    it('should convert space to underscore: "in progress" -> "in_progress"', () => {
        expect(normalizeStatus('in progress')).toBe('in_progress');
    });

    it('should be case insensitive: "IN_PROGRESS" -> "in_progress"', () => {
        expect(normalizeStatus('IN_PROGRESS')).toBe('in_progress');
    });

    it('should be case insensitive: "DONE" -> "done"', () => {
        expect(normalizeStatus('DONE')).toBe('done');
    });

    it('should return "pending" for "pending"', () => {
        expect(normalizeStatus('pending')).toBe('pending');
    });

    it('should return "archived" for "archived"', () => {
        expect(normalizeStatus('archived')).toBe('archived');
    });

    it('should handle mixed case with hyphens: "In-Progress" -> "in_progress"', () => {
        expect(normalizeStatus('In-Progress')).toBe('in_progress');
    });

    it('should handle mixed case with spaces: "In Progress" -> "in_progress"', () => {
        expect(normalizeStatus('In Progress')).toBe('in_progress');
    });

    it('should throw an error for invalid status "invalid"', () => {
        expect(() => normalizeStatus('invalid')).toThrow(
            'Invalid status "invalid". Valid statuses: pending, in_progress, in_qa, done, archived',
        );
    });

    it('should throw an error for empty string', () => {
        expect(() => normalizeStatus('')).toThrow('Invalid status');
    });

    it('should throw an error for random text', () => {
        expect(() => normalizeStatus('foobar')).toThrow('Invalid status');
    });

    it('should include valid statuses in the error message', () => {
        expect(() => normalizeStatus('nope')).toThrow(
            'pending, in_progress, in_qa, done, archived',
        );
    });

    it('should return "in_qa" for "in_qa"', () => {
        expect(normalizeStatus('in_qa')).toBe('in_qa');
    });

    it('should return "in_qa" for alias "qa"', () => {
        expect(normalizeStatus('qa')).toBe('in_qa');
    });

    it('should return "in_qa" for alias "review"', () => {
        expect(normalizeStatus('review')).toBe('in_qa');
    });

    it('should handle "in-qa" with hyphen', () => {
        expect(normalizeStatus('in-qa')).toBe('in_qa');
    });

    it('should be case insensitive for "QA"', () => {
        expect(normalizeStatus('QA')).toBe('in_qa');
    });

    it('should be case insensitive for "IN_QA"', () => {
        expect(normalizeStatus('IN_QA')).toBe('in_qa');
    });

    it('should throw for undefined-like empty input', () => {
        expect(() => normalizeStatus('')).toThrow('Invalid status');
    });
});

describe('normalizePriority', () => {
    it('should return "high" for "high"', () => {
        expect(normalizePriority('high')).toBe('high');
    });

    it('should be case-insensitive: "HIGH" -> "high"', () => {
        expect(normalizePriority('HIGH')).toBe('high');
    });

    it('should trim whitespace: "  urgent  " -> "urgent"', () => {
        expect(normalizePriority('  urgent  ')).toBe('urgent');
    });

    it('should return null for invalid input "bogus"', () => {
        expect(normalizePriority('bogus')).toBeNull();
    });

    it('should return null for undefined', () => {
        expect(normalizePriority(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
        expect(normalizePriority('')).toBeNull();
    });

    it('should return "urgent" for "urgent"', () => {
        expect(normalizePriority('urgent')).toBe('urgent');
    });

    it('should return "medium" for "MEDIUM"', () => {
        expect(normalizePriority('MEDIUM')).toBe('medium');
    });

    it('should return "low" for "low"', () => {
        expect(normalizePriority('low')).toBe('low');
    });

    it('should return null for whitespace-only string', () => {
        expect(normalizePriority('   ')).toBeNull();
    });
});
