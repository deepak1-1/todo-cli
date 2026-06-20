import { describe, it, expect } from 'vitest';
import { parseGitHubRef, parsePrUrl } from '../../../src/integrations/github/ref.js';

describe('parseGitHubRef', () => {
    it('parses a valid owner/repo#number ref', () => {
        expect(parseGitHubRef('owner/repo#123')).toEqual({ owner: 'owner', repo: 'repo', number: 123 });
    });

    it('returns null when # is missing', () => {
        expect(parseGitHubRef('owner/repo')).toBeNull();
    });

    it('returns null for multi-slash path (GitHub orgs cannot contain /)', () => {
        expect(parseGitHubRef('a/b/c#1')).toBeNull();
    });

    it('returns null when trailing characters follow the number', () => {
        expect(parseGitHubRef('owner/repo#123extra')).toBeNull();
    });

    it('returns null when input has leading/trailing whitespace', () => {
        expect(parseGitHubRef(' owner/repo#123 ')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseGitHubRef('')).toBeNull();
    });

    it('returns null when number part is zero', () => {
        expect(parseGitHubRef('owner/repo#0')).toBeNull();
    });

    it('returns null when there is no number after #', () => {
        expect(parseGitHubRef('owner/repo#')).toBeNull();
    });

    it('parses a hyphenated repo name', () => {
        expect(parseGitHubRef('my-org/my-repo#42')).toEqual({ owner: 'my-org', repo: 'my-repo', number: 42 });
    });
});

describe('parsePrUrl', () => {
    it('parses a valid pull URL', () => {
        expect(parsePrUrl('https://github.com/owner/repo/pull/123')).toEqual({
            owner: 'owner',
            repo: 'repo',
            number: 123,
        });
    });

    it('parses a valid pull URL with trailing slash', () => {
        expect(parsePrUrl('https://github.com/owner/repo/pull/123/')).toEqual({
            owner: 'owner',
            repo: 'repo',
            number: 123,
        });
    });

    it('parses an issues URL', () => {
        expect(parsePrUrl('https://github.com/owner/repo/issues/7')).toEqual({
            owner: 'owner',
            repo: 'repo',
            number: 7,
        });
    });

    it('returns null when scheme is missing', () => {
        expect(parsePrUrl('github.com/owner/repo/pull/123')).toBeNull();
    });

    it('returns null when host is missing', () => {
        expect(parsePrUrl('https:///owner/repo/pull/123')).toBeNull();
    });

    it('returns null for a plain ref string', () => {
        expect(parsePrUrl('owner/repo#123')).toBeNull();
    });

    it('returns null when number is zero', () => {
        expect(parsePrUrl('https://github.com/owner/repo/pull/0')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parsePrUrl('')).toBeNull();
    });

    it('returns null when URL has extra path segments after the number', () => {
        expect(parsePrUrl('https://github.com/owner/repo/pull/123/files')).toBeNull();
    });
});
