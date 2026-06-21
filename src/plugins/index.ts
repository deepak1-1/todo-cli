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
    IntegrationProvider,
    PluginManifest,
    RegisteredPlugin,
} from './types.js';

export { EncryptedCredentialStore, CredentialFileCorruptError } from './credential-store.js';
export { createPluginLogger } from './plugin-logger.js';
export { getRegistry } from './plugin-registry.js';
export { loadBuiltIn, loadLocal, loadGlobal, loadAll } from './plugin-loader.js';
