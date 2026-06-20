import { describe, it, expect } from 'vitest';
import {
    makeMapper,
    boolFromInt,
    stringOrEmpty,
    csvToArray,
    nullable,
} from '../../src/storage/repositories/mapper.js';

describe('boolFromInt', () => {
    it('returns true when value is 1', () => {
        expect(boolFromInt(1)).toBe(true);
    });

    it('returns false when value is 0', () => {
        expect(boolFromInt(0)).toBe(false);
    });

    it('returns false for null', () => {
        expect(boolFromInt(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(boolFromInt(undefined)).toBe(false);
    });
});

describe('stringOrEmpty', () => {
    it('returns the string when truthy', () => {
        expect(stringOrEmpty('hello')).toBe('hello');
    });

    it('returns empty string for null', () => {
        expect(stringOrEmpty(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(stringOrEmpty(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(stringOrEmpty('')).toBe('');
    });
});

describe('csvToArray', () => {
    it('splits a comma-separated string into an array', () => {
        expect(csvToArray('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array for null', () => {
        expect(csvToArray(null)).toEqual([]);
    });

    it('returns empty array for undefined', () => {
        expect(csvToArray(undefined)).toEqual([]);
    });

    it('returns empty array for empty string', () => {
        expect(csvToArray('')).toEqual([]);
    });

    it('filters out empty segments from consecutive commas', () => {
        expect(csvToArray('a,,b')).toEqual(['a', 'b']);
    });
});

describe('nullable', () => {
    it('returns the value when present', () => {
        expect(nullable<string>('test')).toBe('test');
    });

    it('returns null for null', () => {
        expect(nullable<string>(null)).toBeNull();
    });

    it('returns null for undefined', () => {
        expect(nullable<string>(undefined)).toBeNull();
    });

    it('passes through numbers', () => {
        expect(nullable<number>(42)).toBe(42);
    });
});

describe('makeMapper', () => {
    interface SampleRow {
        id: number;
        name: string;
        active: number;
        notes: string | null;
        tags: string | null;
    }

    interface Sample {
        id: number;
        name: string;
        active: boolean;
        notes: string;
        tags: string[];
    }

    const mapSample = makeMapper<SampleRow, Sample>({
        id: { col: 'id' },
        name: { col: 'name' },
        active: { col: 'active', transform: boolFromInt },
        notes: { col: 'notes', transform: stringOrEmpty },
        tags: { col: 'tags', transform: csvToArray },
    });

    it('maps a full row correctly', () => {
        const row: SampleRow = { id: 1, name: 'foo', active: 1, notes: 'hello', tags: 'a,b' };
        const result = mapSample(row);
        expect(result).toEqual({ id: 1, name: 'foo', active: true, notes: 'hello', tags: ['a', 'b'] });
    });

    it('applies transform for boolFromInt = false', () => {
        const row: SampleRow = { id: 2, name: 'bar', active: 0, notes: null, tags: null };
        const result = mapSample(row);
        expect(result.active).toBe(false);
        expect(result.notes).toBe('');
        expect(result.tags).toEqual([]);
    });

    it('applies defaultValue when transform is absent and value is null', () => {
        interface RowWithDefault { val: string | null }
        interface DomainWithDefault { val: string }
        const mapper = makeMapper<RowWithDefault, DomainWithDefault>({
            val: { col: 'val', defaultValue: 'fallback' },
        });
        expect(mapper({ val: null }).val).toBe('fallback');
        expect(mapper({ val: 'real' }).val).toBe('real');
    });

    it('returns null when no transform and no default and value is null', () => {
        interface NullRow { x: number | null }
        interface NullDomain { x: number | null }
        const mapper = makeMapper<NullRow, NullDomain>({ x: { col: 'x' } });
        expect(mapper({ x: null }).x).toBeNull();
    });
});
