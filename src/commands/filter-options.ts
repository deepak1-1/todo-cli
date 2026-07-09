// Shared filter option definitions and task-fetch pipeline for ls and bulk commands
import { Command } from 'commander';
import type { TaskFilters, TaskPriority, TaskSort, TaskWithRelations } from '../core/types.js';
import { fuzzySearch } from '../core/filter.js';
import { parseIntOption, parseStrictPositiveInt } from '../utils/format.js';
import type { AppContext } from './context.js';
import { resolveStatusOrThrow } from '../core/status.js';

export function addFilterOptions(cmd: Command): Command {
    return cmd
        .option('-p, --priority <level>', 'Filter by priority')
        .option('-t, --tag <tags...>', 'Filter by tag')
        .option('-P, --project <name>', 'Filter by project ("none" for tasks without a project)')
        .option('-S, --status <status>', 'Filter by status')
        .option('-d, --due <when>', 'Due date filter: today, overdue, this-week')
        .option('-c, --created <when>', 'Created date filter: today, yesterday, this-week, or YYYY-MM-DD')
        .option('-a, --all', 'Include done/archived tasks')
        .option('--parent <id>', 'Show only children of a task ("none" for root tasks only)')
        .option('--sort <field>', 'Sort by: priority, due_date, created_at, title, status')
        .option('--reverse', 'Reverse sort order')
        .option('-n, --limit <count>', 'Limit results')
        .option('-s, --search <query>', 'Fuzzy search tasks');
}

// Map a --project option value onto filters ("none" = tasks without a project)
export function applyProjectFilter(filters: TaskFilters, project: unknown): void {
    if (project === 'none') filters.projectName = null;
    else if (project) filters.projectName = project as string;
}

export function buildFilters(opts: Record<string, unknown>, ctx: AppContext): TaskFilters {
    const filters: TaskFilters = {};
    if (opts.priority) filters.priority = opts.priority as TaskPriority;
    if (opts.tag) filters.tags = opts.tag as string[];
    applyProjectFilter(filters, opts.project);
    if (opts.status) {
        const defs = ctx.statusRepo.list();
        filters.status = resolveStatusOrThrow(defs, opts.status as string).key;
    }
    if (opts.due) filters.dueDate = opts.due as string;
    if (opts.created) filters.createdDate = opts.created as string;
    if (opts.all) filters.includeArchived = true;
    if (opts.parent === 'none') filters.parentId = null;
    else if (opts.parent) {
        const pid = parseStrictPositiveInt(opts.parent as string);
        if (pid === null) {
            throw new Error(`--parent must be a positive task ID or "none", got: ${opts.parent}`);
        }
        filters.parentId = pid;
    }
    if (!opts.status && !opts.all) {
        // Default: exclude archived statuses using the registry
        const defs = ctx.statusRepo.list();
        const nonArchived = defs.filter(d => !d.archives).map(d => d.key);
        filters.status = nonArchived;
    }
    return filters;
}

export function hasAnyFilter(opts: Record<string, unknown>): boolean {
    return !!(opts.priority || opts.tag || opts.project || opts.status || opts.due || opts.created || opts.search || opts.parent);
}

// Opts type accepted by filterAndSearchTasks — union of common filter keys plus search/sort/reverse/limit
export interface FilterOpts {
    priority?: string;
    tag?: string[];
    project?: string;
    status?: string;
    due?: string;
    created?: string;
    all?: boolean;
    parent?: string;
    sort?: string;
    reverse?: boolean;
    limit?: string | number;
    search?: string;
}

/** Build filters, query the repo, apply fuzzy search, and return all three for use by callers */
export function filterAndSearchTasks(
    ctx: AppContext,
    opts: FilterOpts,
): { tasks: TaskWithRelations[]; filters: TaskFilters; sort: TaskSort | undefined } {
    const filters = buildFilters(opts as Record<string, unknown>, ctx);
    const sort: TaskSort | undefined = opts.sort
        ? { field: opts.sort as TaskSort['field'], direction: opts.reverse ? 'asc' : 'desc' }
        : undefined;
    const limit =
        opts.limit !== undefined
            ? typeof opts.limit === 'number'
                ? opts.limit
                : parseIntOption(opts.limit, 'limit')
            : undefined;
    let tasks = ctx.taskRepo.list(filters, sort, limit);
    if (opts.search) {
        tasks = fuzzySearch(tasks, opts.search);
    }
    return { tasks, filters, sort };
}
