// ============================================================
// Plugin System Re-exports
// ============================================================

export type {
    ExternalTask,
    PullFilters,
    PushResult,
    PromptFn,
    CredentialStore,
    PluginLogger,
    PluginCommand,
    PluginTuiComponent,
    PluginHooks,
    IntegrationProvider,
    PluginManifest,
    RegisteredPlugin,
    PluginAPI,
} from './types.js';

export { EncryptedCredentialStore, CredentialFileCorruptError } from './credential-store.js';
export { createPluginLogger } from './plugin-logger.js';
export { createPluginAPI } from './plugin-api.js';
export { getRegistry } from './plugin-registry.js';
export { loadBuiltIn, loadLocal, loadGlobal, loadAll, installPlugin } from './plugin-loader.js';
export { getHookManager } from './hook-manager.js';
