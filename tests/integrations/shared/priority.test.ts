import { describe, it, expect } from 'vitest';
import { toLocalPriority } from '../../../src/integrations/shared/priority.js';

describe('toLocalPriority', () => {
    it('passes through each valid TaskPriority unchanged', () => {
        expect(toLocalPriority('urgent')).toBe('urgent');
        expect(toLocalPriority('high')).toBe('high');
        expect(toLocalPriority('medium')).toBe('medium');
        expect(toLocalPriority('low')).toBe('low');
    });

    it('regression: does not re-map an already-localized value (BUG jira-priority)', () => {
        // Previously this passed through mapJiraPriority again, and 'urgent' is not
        // a valid raw Jira priority name, so it silently became undefined.
        expect(toLocalPriority('urgent')).toBe('urgent');
    });

    it('returns undefined for a raw external priority string (e.g. "Highest")', () => {
        expect(toLocalPriority('Highest')).toBeUndefined();
    });

    it('returns undefined for an unknown string', () => {
        expect(toLocalPriority('critical-xXx')).toBeUndefined();
    });

    it('returns undefined when priority is missing', () => {
        expect(toLocalPriority(undefined)).toBeUndefined();
    });

    it('returns undefined for an empty string', () => {
        expect(toLocalPriority('')).toBeUndefined();
    });
});
