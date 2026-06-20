// Sandboxed Plugin API — controlled access to core functions.
import { PluginAPI, CredentialStore, SafeTaskUpdate } from './types.js';
import type { Task, CreateTaskInput, TaskFilters, Project, Tag } from '../core/types.js';
import { getContext } from '../commands/context.js';
import { createPluginLogger } from './plugin-logger.js';
import { theme } from '../utils/theme.js';

export function createPluginAPI(pluginName: string, credentialStore: CredentialStore): PluginAPI {
    const pluginLogger = createPluginLogger(pluginName);

    return {
        async getTasks(filters?: TaskFilters): Promise<Task[]> {
            const ctx = getContext();
            if (filters) {
                return ctx.taskRepo.list(filters);
            }
            return ctx.taskRepo.list();
        },

        async getTask(id: number): Promise<Task | null> {
            const ctx = getContext();
            return ctx.taskRepo.getById(id) || null;
        },

        async createTask(input: CreateTaskInput): Promise<Task> {
            const ctx = getContext();
            return ctx.taskRepo.create(input);
        },

        async updateTask(id: number, changes: SafeTaskUpdate): Promise<Task | null> {
            const ctx = getContext();
            // Defense-in-depth: strip any keys not in the allowed set before forwarding.
            const ALLOWED_KEYS = ['title', 'description', 'status', 'priority', 'projectId', 'dueDate', 'jiraKey', 'jiraId', 'githubRef', 'lastSyncedAt', 'syncHash'] as const;
            const safe: SafeTaskUpdate = {};
            for (const k of ALLOWED_KEYS) if (k in changes) (safe as Record<string, unknown>)[k] = (changes as Record<string, unknown>)[k];
            return ctx.taskRepo.update(id, safe);
        },

        async getProjects(): Promise<Project[]> {
            const ctx = getContext();
            return ctx.projectRepo.list();
        },

        async getTags(): Promise<Tag[]> {
            const ctx = getContext();
            return ctx.tagRepo.list();
        },

        async getConfig<T>(_key: string): Promise<T | null> {
            return null;
        },

        async setConfig<T>(_key: string, _value: T): Promise<void> {
        },

        credentials: credentialStore,

        notify(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
            const t = theme();
            const colorFns: Record<string, (s: string) => string> = {
                info: (s) => t.info.chalk(s),
                success: (s) => t.success.chalk(s),
                warning: (s) => t.warning.chalk(s),
                error: (s) => t.error.chalk(s),
            };
            const colorFn = colorFns[type] ?? ((s: string) => s);
            console.log(colorFn(`[${pluginName}] ${message}`));
        },

        log: pluginLogger,
    };
}
