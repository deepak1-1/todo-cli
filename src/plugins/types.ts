// ============================================================
// Plugin System Types
// ============================================================

import { Task, CreateTaskInput, TaskStatus } from '../core/types.js';
import type { StatusDef } from '../core/status.js';

export interface ExternalTask {
    externalId: string;
    externalRef: string;
    externalUrl: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    dueDate?: string;
    labels?: string[];
    project?: string;
    assignee?: string;
    metadata?: Record<string, unknown>;
}

export interface PullFilters {
    project?: string;
    status?: string;
    sprint?: string;
    label?: string;
    maxResults?: number;
    since?: string;
}

export interface PushResult {
    success: boolean;
    externalRef: string;
    message: string;
    updatedFields: string[];
}

export type PromptFn = (message: string, options?: { type?: 'text' | 'password'; default?: string }) => Promise<string>;

export interface CredentialStore {
    get(key: string): Promise<string | null>;
    getOrThrow(key: string): Promise<string>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
}

export interface PluginLogger {
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
}

export interface PluginCommand {
    name: string;
    description: string;
    args?: string;
    options?: Array<{ flags: string; description: string; default?: string }>;
    action: (...args: unknown[]) => Promise<void>;
}

export interface IntegrationProvider {
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    readonly version: string;

    auth(store: CredentialStore, prompt: PromptFn): Promise<void>;
    healthCheck(store: CredentialStore): Promise<boolean>;
    pull(store: CredentialStore, filters: PullFilters): Promise<ExternalTask[]>;
    push(store: CredentialStore, task: Task, externalRef: string, statusDefs?: StatusDef[]): Promise<PushResult>;
    /** Optional: create a new remote item for a local task that has no externalRef yet. */
    createRemote?(store: CredentialStore, task: Task, target: { project: string }, statusDefs?: StatusDef[]): Promise<PushResult>;
    mapToLocal(external: ExternalTask): Partial<CreateTaskInput> & { status?: TaskStatus };
    mapToRemote(task: Task): Record<string, unknown>;

    commands?(): PluginCommand[];
}

export interface PluginManifest {
    name: string;
    displayName: string;
    description: string;
    version: string;
    minCoreVersion?: string;
    author?: string;
    homepage?: string;
    builtIn?: boolean;
}

export interface RegisteredPlugin {
    manifest: PluginManifest;
    provider: IntegrationProvider;
    enabled: boolean;
    path?: string;
}
