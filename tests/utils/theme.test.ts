import chalk from 'chalk';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import '../../src/utils/initThemes.js';
import { loadTheme, theme, disableColors, listThemes, type SemanticRole } from '../../src/utils/theme.js';
import { formatTaskOneLine } from '../../src/utils/format.js';
import type { TaskWithRelations } from '../../src/core/types.js';

const ALL_ROLES: SemanticRole[] = [
    'priorityUrgent', 'priorityHigh', 'priorityMedium', 'priorityLow',
    'statusPending', 'statusInProgress', 'statusInQa', 'statusDone', 'statusArchived',
    'id', 'ref', 'project', 'tag',
    'dateOverdue', 'dateNormal', 'blocked',
    'info', 'success', 'warning', 'error', 'debug',
    'muted', 'accent', 'heading', 'tableBorder', 'tableHeader', 'prompt', 'cursor',
    'title', 'subtitle', 'body', 'panelBorder',
];

function makeTask(overrides: Partial<TaskWithRelations> = {}): TaskWithRelations {
    return {
        id: 1,
        title: 'Test task',
        description: '',
        status: 'pending',
        priority: 'medium',
        projectId: null,
        dueDate: null,
        recurrence: null,
        timeSpent: 0,
        jiraKey: null,
        jiraId: null,
        githubRef: null,
        gitlabRef: null,
        linearRef: null,
        syncHash: null,
        lastSyncedAt: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        completedAt: null,
        archivedAt: null,
        projectName: null,
        projectColor: null,
        tagNames: [],
        isBlocked: false,
        blockedBy: [],
        blocking: [],
        ...overrides,
    };
}

// Ensure chalk is enabled for all tests.
const originalLevel = chalk.level;
beforeEach(() => {
    chalk.level = 3;
    loadTheme('default');
});

afterAll(() => {
    chalk.level = originalLevel;
    loadTheme('default');
});

describe('listThemes', () => {
    it('returns all ten built-in themes', () => {
        const names = listThemes().map(t => t.name);
        expect(names).toContain('default');
        expect(names).toContain('dark');
        expect(names).toContain('light');
        expect(names).toContain('dracula');
        expect(names).toContain('solarized');
        expect(names).toContain('nord');
        expect(names).toContain('tokyo-night');
        expect(names).toContain('catppuccin-mocha');
        expect(names).toContain('gruvbox-dark');
        expect(names).toContain('one-dark');
    });

    it('each theme has a non-empty description', () => {
        for (const { description } of listThemes()) {
            expect(description.length).toBeGreaterThan(0);
        }
    });
});

describe('loadTheme — known themes', () => {
    const themeNames = [
        'default', 'dark', 'light', 'dracula', 'solarized',
        'nord', 'tokyo-night', 'catppuccin-mocha', 'gruvbox-dark', 'one-dark',
    ];

    for (const name of themeNames) {
        it(`${name}: palette covers every SemanticRole`, () => {
            loadTheme(name);
            const palette = theme();
            for (const role of ALL_ROLES) {
                expect(palette[role], `Missing role: ${role}`).toBeDefined();
                expect(typeof palette[role].chalk).toBe('function');
                // ink is a string (may be empty only in identity palette)
                expect(typeof palette[role].ink).toBe('string');
            }
        });

        it(`${name}: every chalk fn returns a string`, () => {
            loadTheme(name);
            const palette = theme();
            for (const role of ALL_ROLES) {
                const result = palette[role].chalk('test');
                expect(typeof result).toBe('string');
            }
        });
    }
});

describe('loadTheme — unknown name fallback', () => {
    it('falls back to default without throwing', () => {
        expect(() => loadTheme('bogus-theme-that-does-not-exist')).not.toThrow();
    });

    it('palette is still fully populated after fallback', () => {
        loadTheme('bogus-theme-that-does-not-exist');
        const palette = theme();
        for (const role of ALL_ROLES) {
            expect(palette[role]).toBeDefined();
        }
    });
});

describe('disableColors', () => {
    it('causes all chalk fns to return the input string unchanged', () => {
        disableColors();
        const palette = theme();
        for (const role of ALL_ROLES) {
            expect(palette[role].chalk('test')).toBe('test');
        }
    });

    it('loadTheme restores real colors after disableColors', () => {
        disableColors();
        chalk.level = 3;
        loadTheme('default');
        const palette = theme();
        // After restoring, urgent should produce ANSI output.
        const result = palette.priorityUrgent.chalk('urgent');
        expect(result).toBe(chalk.red.bold('urgent'));
    });
});

describe('formatTaskOneLine — per-theme snapshot', () => {
    const task = makeTask({
        id: 7,
        title: 'Deploy release',
        priority: 'urgent',
        projectName: 'backend',
        tagNames: ['ops'],
    });

    for (const name of ['default', 'dracula', 'solarized', 'nord', 'tokyo-night', 'catppuccin-mocha', 'gruvbox-dark', 'one-dark']) {
        it(`${name}: output contains all fields`, () => {
            loadTheme(name);
            const line = formatTaskOneLine(task);
            expect(line).toContain('#7');
            expect(line).toContain('Deploy release');
            expect(line).toContain('urgent');
            expect(line).toContain('backend');
            expect(line).toContain('ops');
        });
    }
});
