// Pure unit tests for resolveProjectRepo — no I/O

import { describe, it, expect } from 'vitest';
import { resolveProjectRepo } from '../../../src/integrations/github/repo-resolution.js';

// siblingRepos are bare owner/repo strings — the output of listGithubRepos() which already strips #N.
describe('resolveProjectRepo', () => {
    it('returns the unique repo when all sibling repos share the same prefix', () => {
        const result = resolveProjectRepo(['acme/frontend', 'acme/frontend', 'acme/frontend']);
        expect(result).toEqual({ repo: 'acme/frontend' });
    });

    it('returns ambiguous with all candidates when multiple distinct repos exist', () => {
        const result = resolveProjectRepo(['acme/frontend', 'acme/backend']);
        expect(result).toEqual({ error: 'ambiguous', candidates: expect.arrayContaining(['acme/frontend', 'acme/backend']) });
        if ('candidates' in result) expect(result.candidates).toHaveLength(2);
    });

    it('returns error:none with empty candidates when no sibling repos exist', () => {
        const result = resolveProjectRepo([]);
        expect(result).toEqual({ error: 'none', candidates: [] });
    });

    it('falls back to description marker when sibling repos are empty', () => {
        const result = resolveProjectRepo([], 'GitHub: acme/backend');
        expect(result).toEqual({ repo: 'acme/backend' });
    });

    it('falls back to description marker when sibling repos is absent from call', () => {
        const result = resolveProjectRepo([], 'GitHub: org/myrepo');
        expect(result).toEqual({ repo: 'org/myrepo' });
    });

    it('description marker must match exactly at line start — no partial match', () => {
        const result = resolveProjectRepo([], 'My notes about GitHub: acme/frontend');
        expect(result).toEqual({ error: 'none', candidates: [] });
    });

    it('returns error:none when description is empty string', () => {
        const result = resolveProjectRepo([], '');
        expect(result).toEqual({ error: 'none', candidates: [] });
    });

    it('returns error:none when description is undefined', () => {
        const result = resolveProjectRepo([], undefined);
        expect(result).toEqual({ error: 'none', candidates: [] });
    });

    it('ignores strings that are not bare owner/repo (e.g. contain # or spaces)', () => {
        // listGithubRepos always returns bare prefixes, but test robustness anyway
        const result = resolveProjectRepo(['not-a-valid-ref', 'acme/frontend']);
        expect(result).toEqual({ repo: 'acme/frontend' });
    });

    it('same-named repos under different owners collapse to ambiguous', () => {
        const result = resolveProjectRepo(['alice/webapp', 'bob/webapp']);
        expect(result).toEqual({ error: 'ambiguous', candidates: expect.arrayContaining(['alice/webapp', 'bob/webapp']) });
    });

    it('sibling repos take priority over description marker', () => {
        const result = resolveProjectRepo(['acme/frontend'], 'GitHub: acme/other');
        expect(result).toEqual({ repo: 'acme/frontend' });
    });

    it('description marker with trailing space is normalized', () => {
        const result = resolveProjectRepo([], '  GitHub: acme/backend  ');
        expect(result).toEqual({ repo: 'acme/backend' });
    });

    it('edge: whitespace-only description is treated as no description (error:none)', () => {
        // trim() collapses whitespace-only to '' — should not match marker
        const result = resolveProjectRepo([], '   ');
        expect(result).toEqual({ error: 'none', candidates: [] });
    });

    it('edge: description with valid marker prefix but extra trailing text does not match', () => {
        // DESCRIPTION_MARKER_RE is anchored — "GitHub: owner/repo extra" must fail
        const result = resolveProjectRepo([], 'GitHub: acme/frontend extra-stuff');
        expect(result).toEqual({ error: 'none', candidates: [] });
    });
});
