// Central palette module — single source of truth for all colors.
import type { ChalkInstance } from 'chalk';

export type SemanticRole =
    | 'priorityUrgent' | 'priorityHigh' | 'priorityMedium' | 'priorityLow'
    | 'statusPending' | 'statusInProgress' | 'statusInQa' | 'statusDone' | 'statusArchived'
    | 'id' | 'ref' | 'project' | 'tag'
    | 'dateOverdue' | 'dateNormal' | 'blocked'
    | 'info' | 'success' | 'warning' | 'error' | 'debug'
    | 'muted' | 'accent' | 'heading' | 'tableBorder' | 'tableHeader' | 'prompt' | 'cursor'
    | 'title' | 'subtitle' | 'body' | 'panelBorder';

export interface PaletteEntry {
    chalk: ChalkInstance;
    ink: string;
}

export type Palette = Record<SemanticRole, PaletteEntry>;

export interface ThemeDefinition {
    name: string;
    description: string;
    build(): Palette;
}

const REGISTRY = new Map<string, ThemeDefinition>();
let activePalette: Palette | null = null;

/** Register a theme definition. Called by each theme file at import time. */
export function registerTheme(def: ThemeDefinition): void {
    REGISTRY.set(def.name, def);
}

// Identity fn for NO_COLOR mode — returns string unchanged.
function identity(s: string): string {
    return s;
}

function buildIdentityPalette(): Palette {
    const entry: PaletteEntry = { chalk: identity as unknown as ChalkInstance, ink: '' };
    const roles: SemanticRole[] = [
        'priorityUrgent', 'priorityHigh', 'priorityMedium', 'priorityLow',
        'statusPending', 'statusInProgress', 'statusInQa', 'statusDone', 'statusArchived',
        'id', 'ref', 'project', 'tag',
        'dateOverdue', 'dateNormal', 'blocked',
        'info', 'success', 'warning', 'error', 'debug',
        'muted', 'accent', 'heading', 'tableBorder', 'tableHeader', 'prompt', 'cursor',
        'title', 'subtitle', 'body', 'panelBorder',
    ];
    return Object.fromEntries(roles.map(r => [r, entry])) as Palette;
}

/** Load a named theme synchronously. Falls back to default on unknown name without throwing. */
export function loadTheme(name: string): void {
    const def = REGISTRY.get(name) ?? REGISTRY.get('default');
    if (!def) return; // Registry not yet populated.
    activePalette = def.build();
}

/** Return the active palette. Returns identity palette if not yet loaded. */
export function theme(): Palette {
    if (!activePalette) return buildIdentityPalette();
    return activePalette;
}

/** Replace every palette entry with identity fn (NO_COLOR support). */
export function disableColors(): void {
    activePalette = buildIdentityPalette();
}

/** Return names + descriptions of all registered themes. */
export function listThemes(): { name: string; description: string }[] {
    return Array.from(REGISTRY.values()).map(d => ({ name: d.name, description: d.description }));
}
