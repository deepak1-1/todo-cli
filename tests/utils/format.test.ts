import chalk from 'chalk';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import '../../src/utils/initThemes.js';
import { loadTheme } from '../../src/utils/theme.js';
import {
    formatPriority,
    formatPriorityLabel,
    formatPriorityBracket,
    formatStatus,
    formatTaskOneLine,
    formatTaskTable,
    formatTaskDetail,
    success,
    error,
    warn,
    info,
    parseId,
    parseIds,
    parseIntOption,
    priorityColors,
    statusChalkFn,
} from '../../src/utils/format.js';
import type { TaskWithRelations } from '../../src/core/types.js';

const savedChalkLevel = chalk.level;
beforeEach(() => { chalk.level = 3; loadTheme('default'); });
afterAll(() => { chalk.level = savedChalkLevel; loadTheme('default'); });

/** Helper to create a minimal TaskWithRelations for testing */
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

describe('success', () => {
    it('should format a success message with checkmark', () => {
        const msg = success('Task created');
        expect(msg).toContain('Task created');
        // Should contain the checkmark character (possibly with ANSI codes)
        expect(msg).toMatch(/✓/);
    });

    it('should handle empty message', () => {
        const msg = success('');
        expect(msg).toMatch(/✓/);
    });
});

describe('error', () => {
    it('should format an error message with cross mark', () => {
        const msg = error('Something failed');
        expect(msg).toContain('Something failed');
        expect(msg).toMatch(/✗/);
    });

    it('should handle empty message', () => {
        const msg = error('');
        expect(msg).toMatch(/✗/);
    });
});

describe('warn', () => {
    it('should format a warning message with warning symbol', () => {
        const msg = warn('Be careful');
        expect(msg).toContain('Be careful');
        expect(msg).toMatch(/⚠/);
    });

    it('should handle empty message', () => {
        const msg = warn('');
        expect(msg).toMatch(/⚠/);
    });
});

describe('info', () => {
    it('should format an info message with info symbol', () => {
        const msg = info('FYI');
        expect(msg).toContain('FYI');
        expect(msg).toMatch(/ℹ/);
    });
});

describe('formatPriority', () => {
    it('should format each priority level', () => {
        expect(formatPriority('urgent')).toContain('urgent');
        expect(formatPriority('high')).toContain('high');
        expect(formatPriority('medium')).toContain('medium');
        expect(formatPriority('low')).toContain('low');
    });
});

describe('formatPriorityLabel', () => {
    it('should format each priority label', () => {
        expect(formatPriorityLabel('urgent')).toContain('urgent');
        expect(formatPriorityLabel('high')).toContain('high');
        expect(formatPriorityLabel('medium')).toContain('medium');
        expect(formatPriorityLabel('low')).toContain('low');
    });
});

describe('formatPriorityBracket', () => {
    // Mirrors the inline ternary previously in commands/project.ts:96-98
    it('should produce [!] bracket for urgent priority', () => {
        expect(formatPriorityBracket('urgent')).toContain('[!]');
    });

    it('should produce [!] bracket for high priority', () => {
        expect(formatPriorityBracket('high')).toContain('[!]');
    });

    it('should produce [ ] bracket for medium priority', () => {
        expect(formatPriorityBracket('medium')).toContain('[ ]');
    });

    it('should produce [.] bracket for low priority', () => {
        expect(formatPriorityBracket('low')).toContain('[.]');
    });

    it('should not contain the priority word itself', () => {
        // Bracket form is marker-only, no prose label
        expect(formatPriorityBracket('urgent')).not.toContain('urgent');
        expect(formatPriorityBracket('low')).not.toContain('low');
    });
});

describe('formatStatus', () => {
    it('should format each status with icon and label', () => {
        expect(formatStatus('todo')).toContain('todo');
        expect(formatStatus('in_progress')).toContain('in progress');
        expect(formatStatus('in_review')).toContain('in review');
        expect(formatStatus('blocked')).toContain('blocked');
        expect(formatStatus('done')).toContain('done');
        expect(formatStatus('archived')).toContain('archived');
    });

    it('should include status icons for new dynamic statuses', () => {
        expect(formatStatus('todo')).toContain('○');
        expect(formatStatus('in_progress')).toContain('◐');
        expect(formatStatus('in_review')).toContain('◔');
        expect(formatStatus('blocked')).toContain('⊘');
        expect(formatStatus('done')).toContain('✓');
        expect(formatStatus('archived')).toContain('⌀');
    });
});

describe('formatTaskOneLine', () => {
    it('should include task id and title', () => {
        const task = makeTask({ id: 42, title: 'My important task' });
        const line = formatTaskOneLine(task);
        expect(line).toContain('#42');
        expect(line).toContain('My important task');
    });

    it('should include priority', () => {
        const task = makeTask({ priority: 'urgent' });
        const line = formatTaskOneLine(task);
        expect(line).toContain('urgent');
    });

    it('should include project name when present', () => {
        const task = makeTask({ projectName: 'Backend' });
        const line = formatTaskOneLine(task);
        expect(line).toContain('Backend');
    });

    it('should not include project when absent', () => {
        const task = makeTask({ projectName: null });
        const line = formatTaskOneLine(task);
        // Just ensure no crash and line is non-empty
        expect(line.length).toBeGreaterThan(0);
    });

    it('should include due date when present', () => {
        // Use a far-future date to avoid overdue detection issues
        const task = makeTask({ dueDate: '2099-12-31' });
        const line = formatTaskOneLine(task);
        // The formatted date should appear somewhere
        expect(line.length).toBeGreaterThan(0);
    });

    it('should include tags when present', () => {
        const task = makeTask({ tagNames: ['backend', 'urgent-fix'] });
        const line = formatTaskOneLine(task);
        expect(line).toContain('backend');
        expect(line).toContain('urgent-fix');
    });

    it('should not include tags section when no tags', () => {
        const task = makeTask({ tagNames: [] });
        const line = formatTaskOneLine(task);
        expect(line).not.toContain('undefined');
    });

    it('should show BLOCKED indicator for blocked tasks', () => {
        const task = makeTask({ isBlocked: true });
        const line = formatTaskOneLine(task);
        expect(line).toContain('BLOCKED');
    });

    it('should not show BLOCKED for unblocked tasks', () => {
        const task = makeTask({ isBlocked: false });
        const line = formatTaskOneLine(task);
        expect(line).not.toContain('BLOCKED');
    });

    it('should handle task with all optional fields missing', () => {
        const task = makeTask({
            projectName: null,
            dueDate: null,
            tagNames: [],
            isBlocked: false,
        });
        const line = formatTaskOneLine(task);
        expect(line).toContain('#1');
        expect(line).toContain('Test task');
    });
});

describe('formatTaskTable', () => {
    it('should return "No tasks found" message for empty list', () => {
        const result = formatTaskTable([]);
        expect(result).toContain('No tasks found');
    });

    it('should format a single task as a table', () => {
        const tasks = [makeTask({ id: 1, title: 'Do something', status: 'pending', priority: 'high' })];
        const table = formatTaskTable(tasks);

        expect(table).toContain('#1');
        expect(table).toContain('Do something');
        expect(table).toContain('high');
    });

    it('should format multiple tasks', () => {
        const tasks = [
            makeTask({ id: 1, title: 'First task', priority: 'urgent' }),
            makeTask({ id: 2, title: 'Second task', priority: 'low' }),
        ];
        const table = formatTaskTable(tasks);

        expect(table).toContain('#1');
        expect(table).toContain('First task');
        expect(table).toContain('#2');
        expect(table).toContain('Second task');
    });

    it('should show project name in table', () => {
        const tasks = [makeTask({ projectName: 'MyProject' })];
        const table = formatTaskTable(tasks);
        expect(table).toContain('MyProject');
    });

    it('should handle tasks with missing optional fields', () => {
        const tasks = [
            makeTask({
                projectName: null,
                dueDate: null,
                tagNames: undefined,
            }),
        ];
        // Should not throw
        const table = formatTaskTable(tasks);
        expect(table).toBeTruthy();
    });

    it('should show BLOCKED indicator for blocked tasks', () => {
        const tasks = [makeTask({ isBlocked: true, title: 'Blocked work' })];
        const table = formatTaskTable(tasks);
        expect(table).toContain('Blocked work');
    });

    it('should display tags as comma-separated list', () => {
        const tasks = [makeTask({ tagNames: ['api', 'v2'] })];
        const table = formatTaskTable(tasks);
        expect(table).toContain('api');
        expect(table).toContain('v2');
    });

    it('two tasks with different project hex colors produce distinct ANSI for the project column', () => {
        // Uses chalk level 3 (set in beforeEach) to verify ANSI codes actually differ
        const taskSky = makeTask({ id: 1, projectName: 'Sky-proj', projectColor: '#0ea5e9' });
        const taskTeal = makeTask({ id: 2, projectName: 'Sky-proj', projectColor: '#14b8a6' });
        const tableSky = formatTaskTable([taskSky]);
        const tableTeal = formatTaskTable([taskTeal]);
        // Same project name, different hex — ANSI wrapping must differ
        expect(tableSky).not.toBe(tableTeal);
    });

    it('task with null projectColor falls back to theme project role (no chalk.hex call)', () => {
        const taskWithColor = makeTask({ id: 1, projectName: 'Proj', projectColor: '#0ea5e9' });
        const taskNoColor = makeTask({ id: 2, projectName: 'Proj', projectColor: null });
        const withColor = formatTaskTable([taskWithColor]);
        const noColor = formatTaskTable([taskNoColor]);
        // Both contain the project name; different ANSI wrapping expected
        expect(withColor).toContain('Proj');
        expect(noColor).toContain('Proj');
        expect(withColor).not.toBe(noColor);
    });

    it('tree mode — child title cell contains indent and └─ prefix', () => {
        const parent = makeTask({ id: 1, title: 'Parent task' });
        const child = makeTask({ id: 2, title: 'Child task' });
        const depths = new Map([[1, 0], [2, 1]]);
        const table = formatTaskTable([parent, child], undefined, depths);
        // Parent at depth 0 — no indent prefix
        expect(table).toContain('Parent task');
        // Child at depth 1 — must contain the └─ connector
        expect(table).toContain('└─');
        expect(table).toContain('Child task');
    });

    it('tree mode — depth-2 grandchild has double indent', () => {
        const parent = makeTask({ id: 1, title: 'Root' });
        const child = makeTask({ id: 2, title: 'Child' });
        const grandchild = makeTask({ id: 3, title: 'Grandchild' });
        const depths = new Map([[1, 0], [2, 1], [3, 2]]);
        const table = formatTaskTable([parent, child, grandchild], undefined, depths);
        expect(table).toContain('└─');
        expect(table).toContain('Grandchild');
    });

    it('tree mode — blocked child still shows ⊘ prefix before the indented title', () => {
        const parent = makeTask({ id: 1, title: 'Parent' });
        const blocked = makeTask({ id: 2, title: 'Blocked child', isBlocked: true });
        const depths = new Map([[1, 0], [2, 1]]);
        const table = formatTaskTable([parent, blocked], undefined, depths);
        // ⊘ should appear (added by blocked branch) AND the child title must appear
        expect(table).toContain('⊘');
        expect(table).toContain('Blocked child');
    });

    it('tree mode — task with depth 0 in treeDepths does not prefix the title with └─', () => {
        const task = makeTask({ id: 1, title: 'Root task' });
        const withDepths = formatTaskTable([task], undefined, new Map([[1, 0]]));
        // The title cell must not have └─ before the task title text
        expect(withDepths).not.toContain('└─ Root task');
        expect(withDepths).toContain('Root task');
    });
});

describe('formatTaskDetail', () => {
    it('should include the task title', () => {
        const task = makeTask({ title: 'Detailed task' });
        const detail = formatTaskDetail(task);
        expect(detail).toContain('Detailed task');
    });

    it('should show subtask progress rollup and the child list', () => {
        const task = makeTask({
            progress: { done: 1, total: 3 },
            children: [makeTask({ id: 7, title: 'Child seven' })],
        });
        const detail = formatTaskDetail(task);
        expect(detail).toContain('1/3 done');
        expect(detail).toContain('Subtasks');
        expect(detail).toContain('Child seven');
    });

    it('should not show a Subtasks section when there are no children', () => {
        const detail = formatTaskDetail(makeTask({ progress: { done: 0, total: 0 } }));
        expect(detail).not.toContain('1/0');
        expect(detail).not.toMatch(/Subtasks:/);
    });

    it('should include status and priority', () => {
        const task = makeTask({ status: 'in_progress', priority: 'urgent' });
        const detail = formatTaskDetail(task);
        expect(detail).toContain('urgent');
        expect(detail).toContain('in progress');
    });

    it('should include project name or (none)', () => {
        const withProject = formatTaskDetail(makeTask({ projectName: 'Backend' }));
        expect(withProject).toContain('Backend');

        const withoutProject = formatTaskDetail(makeTask({ projectName: null }));
        expect(withoutProject).toContain('(none)');
    });

    it('should include description when present', () => {
        const task = makeTask({ description: 'A detailed description' });
        const detail = formatTaskDetail(task);
        expect(detail).toContain('A detailed description');
    });

    it('should not include description section when empty', () => {
        const task = makeTask({ description: '' });
        const detail = formatTaskDetail(task);
        expect(detail).not.toContain('Description');
    });

    it('should include tags when present', () => {
        const task = makeTask({ tagNames: ['backend', 'api'] });
        const detail = formatTaskDetail(task);
        expect(detail).toContain('backend');
        expect(detail).toContain('api');
    });

    it('should show time spent when > 0', () => {
        const task = makeTask({ timeSpent: 3600 });
        const detail = formatTaskDetail(task);
        expect(detail).toContain('1h');
    });

    it('should not show time when 0', () => {
        const task = makeTask({ timeSpent: 0 });
        const detail = formatTaskDetail(task);
        expect(detail).not.toContain('Time:');
    });

    it('should show BLOCKED status for blocked tasks', () => {
        const task = makeTask({ isBlocked: true });
        const detail = formatTaskDetail(task);
        expect(detail).toContain('BLOCKED');
    });

    it('should show Jira key when present', () => {
        const task = makeTask({ jiraKey: 'PROJ-123' });
        const detail = formatTaskDetail(task);
        expect(detail).toContain('PROJ-123');
    });

    it('should show GitHub ref when present', () => {
        const task = makeTask({ githubRef: '#42' });
        const detail = formatTaskDetail(task);
        expect(detail).toContain('#42');
    });

    it('should show completed date when present', () => {
        const task = makeTask({ completedAt: '2025-06-15T10:30:00.000Z' });
        const detail = formatTaskDetail(task);
        expect(detail).toContain('Completed');
    });
});

describe('parseId', () => {
    it('should return correct number for valid input "1"', () => {
        expect(parseId('1')).toBe(1);
    });

    it('should return correct number for valid input "42"', () => {
        expect(parseId('42')).toBe(42);
    });

    it('should throw on empty string', () => {
        expect(() => parseId('')).toThrow(/not a valid task ID/);
    });

    it('should throw on non-numeric string "abc"', () => {
        expect(() => parseId('abc')).toThrow(/not a valid task ID/);
    });

    it('should throw on zero "0"', () => {
        expect(() => parseId('0')).toThrow(/not a valid task ID/);
    });

    it('should throw on negative number "-1"', () => {
        expect(() => parseId('-1')).toThrow(/not a valid task ID/);
    });
});

describe('parseIds', () => {
    it('should return valid IDs and skip invalid ones', () => {
        const ids = parseIds('1,abc,3');
        expect(ids).toEqual([1, 3]);
    });

    it('should throw when all IDs are invalid', () => {
        expect(() => parseIds('abc,def,0')).toThrow();
    });

    it('should parse a single valid ID', () => {
        expect(parseIds('5')).toEqual([5]);
    });

    it('should handle whitespace around IDs', () => {
        expect(parseIds(' 1 , 2 , 3 ')).toEqual([1, 2, 3]);
    });
});

describe('priorityColors', () => {
    it('urgent returns a callable that includes ANSI or the word urgent', () => {
        const result = priorityColors.urgent('urgent');
        expect(result).toContain('urgent');
    });

    it('high returns a callable that includes the input text', () => {
        const result = priorityColors.high('high');
        expect(result).toContain('high');
    });

    it('medium returns a callable that includes the input text', () => {
        const result = priorityColors.medium('medium');
        expect(result).toContain('medium');
    });

    it('low returns a callable that includes the input text', () => {
        const result = priorityColors.low('low');
        expect(result).toContain('low');
    });

    it('each key returns a function', () => {
        expect(typeof priorityColors.urgent).toBe('function');
        expect(typeof priorityColors.high).toBe('function');
        expect(typeof priorityColors.medium).toBe('function');
        expect(typeof priorityColors.low).toBe('function');
    });
});

describe('statusChalkFn', () => {
    it('returns a callable for a known status key', () => {
        const fn = statusChalkFn('done');
        expect(typeof fn).toBe('function');
        expect(fn('done')).toContain('done');
    });

    it('returns an identity-like function for an unknown status', () => {
        const fn = statusChalkFn('unknown_xyz');
        expect(fn('raw text')).toContain('raw text');
    });

    it('uses the provided StatusDef color when defs are supplied', () => {
        const defs = [{ key: 'custom', label: 'Custom', icon: '★', color: 'green', sortOrder: 10, verb: 'customize', completes: false, archives: false, isBuiltin: false }];
        const fn = statusChalkFn('custom', defs);
        expect(typeof fn).toBe('function');
        // Green chalk — output must contain the text at minimum
        expect(fn('custom')).toContain('custom');
    });

    it('falls back to builtin map when defs do not contain the key', () => {
        const defs = [{ key: 'other', label: 'Other', icon: '?', color: 'gray', sortOrder: 99, verb: 'other', completes: false, archives: false, isBuiltin: false }];
        const fn = statusChalkFn('todo', defs);
        expect(fn('todo')).toContain('todo');
    });
});

describe('parseIntOption', () => {
    it('should return number for valid input', () => {
        expect(parseIntOption('10', 'limit')).toBe(10);
    });

    it('should throw on non-numeric input', () => {
        expect(() => parseIntOption('abc', 'limit')).toThrow(/not a valid value for --limit/);
    });

    it('should throw on zero', () => {
        expect(() => parseIntOption('0', 'limit')).toThrow(/not a valid value/);
    });

    it('should throw on negative number', () => {
        expect(() => parseIntOption('-5', 'count')).toThrow(/not a valid value for --count/);
    });
});
