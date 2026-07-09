// ============================================================
// Configuration manager
// ============================================================

import Conf from 'conf';
import { DEFAULT_CONFIG, CONFIG_KEYS, type AppConfig } from './defaults.js';
import { getDataDirOverride } from '../utils/data-dir.js';

let store: Conf<AppConfig> | null = null;

function getStore(): Conf<AppConfig> {
    if (!store) {
        // cwd override keeps config out of the OS config dir under TODO_CLI_HOME isolation
        const cwd = getDataDirOverride();
        store = new Conf<AppConfig>({
            projectName: 'todo-cli',
            defaults: DEFAULT_CONFIG,
            ...(cwd ? { cwd } : {}),
        });
    }
    return store;
}

/** Get a config value */
export function getConfig<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return getStore().get(key);
}

/** Set a config value */
export function setConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    getStore().set(key, value);
}

/** Get all config */
export function getAllConfig(): AppConfig {
    const s = getStore();
    const result: Record<string, unknown> = {};
    for (const key of CONFIG_KEYS) {
        result[key] = s.get(key);
    }
    return result as unknown as AppConfig;
}

/** Reset config to defaults */
export function resetConfig(): void {
    getStore().clear();
}

/** Get the path to the config file */
export function getConfigPath(): string {
    return getStore().path;
}

/** Check if a key is a valid config key */
export function isValidConfigKey(key: string): key is keyof AppConfig {
    return CONFIG_KEYS.includes(key as keyof AppConfig);
}
