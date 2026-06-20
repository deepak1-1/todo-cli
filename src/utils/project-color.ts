// Project color palette — deterministic assignment and display helpers.
import chalk from 'chalk';
import { theme } from './theme.js';

export interface ProjectColor {
    name: string;
    hex: string;
}

export const PROJECT_PALETTE: readonly ProjectColor[] = [
    { name: 'sky',     hex: '#0ea5e9' },
    { name: 'mint',    hex: '#2dd4bf' },
    { name: 'orange',  hex: '#f97316' },
    { name: 'teal',    hex: '#14b8a6' },
    { name: 'pink',    hex: '#ec4899' },
    { name: 'amber',   hex: '#f59e0b' },
    { name: 'cobalt',  hex: '#1d4ed8' },
    { name: 'cyan',    hex: '#06b6d4' },
    { name: 'coral',   hex: '#fb7185' },
    { name: 'yellow',  hex: '#eab308' },
    { name: 'blue',    hex: '#3b82f6' },
    { name: 'slate',   hex: '#64748b' },
    { name: 'rose',    hex: '#f43f5e' },
    { name: 'lime',    hex: '#84cc16' },
    { name: 'emerald', hex: '#10b981' },
    { name: 'stone',   hex: '#a8a29e' },
];

// FNV-1a 32-bit hash — no deps, deterministic.
function fnv1a32(s: string): number {
    let hash = 2166136261;
    for (let i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
    }
    return hash;
}

/** Pick first hex not in usedHexes (case-insensitive); fall back to FNV-1a hash mod 16. */
export function pickNextProjectColor(usedHexes: string[], name?: string): string {
    const used = new Set(usedHexes.map(h => h.toLowerCase()));
    const found = PROJECT_PALETTE.find(p => !used.has(p.hex));
    if (found) return found.hex;
    const idx = name ? fnv1a32(name) % PROJECT_PALETTE.length : 0;
    return PROJECT_PALETTE[idx].hex;
}

/** Resolve palette name or hex string to canonical lowercase hex. Returns null if unrecognized. */
export function resolveProjectColor(input: string): string | null {
    const lower = input.toLowerCase();
    const byName = PROJECT_PALETTE.find(p => p.name === lower);
    if (byName) return byName.hex;
    if (/^#[0-9a-f]{6}$/.test(lower)) return lower;
    return null;
}

/** True iff input is a known palette name (case-insensitive) or a 7-char hex string. */
export function isValidProjectColor(input: string): boolean {
    return resolveProjectColor(input) !== null;
}

/** Colorize a project name with its hex; falls back to theme project role on invalid hex. */
export function colorizeProject(name: string, hex: string | null | undefined): string {
    if (!hex || hex === 'white' || !/^#[0-9a-f]{6}$/i.test(hex)) {
        return theme().project.chalk(name);
    }
    return chalk.hex(hex)(name);
}
