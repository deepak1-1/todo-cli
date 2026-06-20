import chalk from 'chalk';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import '../../src/utils/initThemes.js';
import { loadTheme, disableColors } from '../../src/utils/theme.js';
import {
    PROJECT_PALETTE,
    pickNextProjectColor,
    resolveProjectColor,
    isValidProjectColor,
    colorizeProject,
} from '../../src/utils/project-color.js';

const savedChalkLevel = chalk.level;

beforeEach(() => {
    chalk.level = 3;
    loadTheme('default');
});

afterAll(() => {
    chalk.level = savedChalkLevel;
    loadTheme('default');
});

describe('PROJECT_PALETTE', () => {
    it('has exactly 16 entries', () => {
        expect(PROJECT_PALETTE).toHaveLength(16);
    });

    it('first entry is sky (#0ea5e9)', () => {
        expect(PROJECT_PALETTE[0].name).toBe('sky');
        expect(PROJECT_PALETTE[0].hex).toBe('#0ea5e9');
    });

    it('all hexes are 7-char lowercase', () => {
        for (const p of PROJECT_PALETTE) {
            expect(p.hex).toMatch(/^#[0-9a-f]{6}$/);
        }
    });
});

describe('pickNextProjectColor', () => {
    it('returns sky (#0ea5e9) when nothing is used', () => {
        expect(pickNextProjectColor([])).toBe('#0ea5e9');
    });

    it('returns the first unused hex', () => {
        const used = ['#0ea5e9']; // sky is used
        expect(pickNextProjectColor(used)).toBe('#8b5cf6'); // violet
    });

    it('skips all used hexes and picks first free', () => {
        const used = PROJECT_PALETTE.slice(0, 5).map(p => p.hex);
        expect(pickNextProjectColor(used)).toBe(PROJECT_PALETTE[5].hex);
    });

    it('comparison is case-insensitive', () => {
        const used = ['#0EA5E9']; // sky in uppercase
        expect(pickNextProjectColor(used)).toBe('#8b5cf6');
    });

    it('falls back to FNV-1a hash when all 16 used (17th project)', () => {
        const used = PROJECT_PALETTE.map(p => p.hex);
        const result = pickNextProjectColor(used, 'my-project');
        expect(PROJECT_PALETTE.map(p => p.hex)).toContain(result);
    });

    it('FNV fallback with no name uses palette[0]', () => {
        const used = PROJECT_PALETTE.map(p => p.hex);
        expect(pickNextProjectColor(used)).toBe(PROJECT_PALETTE[0].hex);
    });
});

describe('resolveProjectColor', () => {
    it('resolves palette name to hex', () => {
        expect(resolveProjectColor('violet')).toBe('#8b5cf6');
    });

    it('is case-insensitive for name lookup', () => {
        expect(resolveProjectColor('Violet')).toBe('#8b5cf6');
        expect(resolveProjectColor('VIOLET')).toBe('#8b5cf6');
    });

    it('accepts lowercase hex', () => {
        expect(resolveProjectColor('#8b5cf6')).toBe('#8b5cf6');
    });

    it('normalizes uppercase hex to lowercase', () => {
        expect(resolveProjectColor('#8B5CF6')).toBe('#8b5cf6');
    });

    it('returns null for unrecognized input', () => {
        expect(resolveProjectColor('bogus')).toBeNull();
        expect(resolveProjectColor('#xyz')).toBeNull();
        expect(resolveProjectColor('rainbow')).toBeNull();
    });

    it('returns null for short hex', () => {
        expect(resolveProjectColor('#fff')).toBeNull();
    });
});

describe('isValidProjectColor', () => {
    it('accepts known palette names', () => {
        expect(isValidProjectColor('violet')).toBe(true);
        expect(isValidProjectColor('Violet')).toBe(true);
        expect(isValidProjectColor('teal')).toBe(true);
    });

    it('accepts valid 7-char hex', () => {
        expect(isValidProjectColor('#8b5cf6')).toBe(true);
        expect(isValidProjectColor('#8B5CF6')).toBe(true);
    });

    it('rejects bogus strings', () => {
        expect(isValidProjectColor('bogus')).toBe(false);
        expect(isValidProjectColor('#xyz')).toBe(false);
        expect(isValidProjectColor('')).toBe(false);
    });
});

describe('colorizeProject', () => {
    it('uses chalk.hex for a valid hex', () => {
        const result = colorizeProject('myproject', '#8b5cf6');
        expect(result).toContain('myproject');
    });

    it('falls back to theme for null hex', () => {
        disableColors();
        const result = colorizeProject('myproject', null);
        expect(result).toBe('myproject');
    });

    it('falls back to theme for white', () => {
        disableColors();
        const result = colorizeProject('myproject', 'white');
        expect(result).toBe('myproject');
    });

    it('falls back to theme for invalid hex string', () => {
        disableColors();
        const result = colorizeProject('myproject', 'not-a-hex');
        expect(result).toBe('myproject');
    });

    it('falls back to theme for undefined', () => {
        disableColors();
        const result = colorizeProject('myproject', undefined);
        expect(result).toBe('myproject');
    });

    it('produces different ANSI output for hex vs white (chalk enabled)', () => {
        // hex path uses chalk.hex(), white path uses theme project role
        const withHex = colorizeProject('proj', '#8b5cf6');
        const withWhite = colorizeProject('proj', 'white');
        // Both contain the name; their ANSI wrapping differs
        expect(withHex).toContain('proj');
        expect(withWhite).toContain('proj');
        expect(withHex).not.toBe(withWhite);
    });

    it('produces different ANSI output for two distinct hex values', () => {
        const sky = colorizeProject('proj', '#0ea5e9');
        const violet = colorizeProject('proj', '#8b5cf6');
        expect(sky).not.toBe(violet);
    });
});

describe('pickNextProjectColor — non-sequential used set', () => {
    it('picks sky when only violet is used (first-unused wins, not next-sequential)', () => {
        // User manually set violet; sky slot is still free → picks sky
        const used = ['#8b5cf6']; // violet used, sky not
        expect(pickNextProjectColor(used)).toBe('#0ea5e9'); // sky is first in palette
    });

    it('picks first free slot from middle of palette', () => {
        // slots 0-4 used, slot 5 free, slots 6-15 used (out of order scenario)
        const used = [
            ...PROJECT_PALETTE.slice(0, 5).map(p => p.hex),
            ...PROJECT_PALETTE.slice(6).map(p => p.hex),
        ];
        expect(pickNextProjectColor(used)).toBe(PROJECT_PALETTE[5].hex);
    });
});
