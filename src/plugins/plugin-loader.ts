// ============================================================
// Plugin Loader — discovers and loads plugins from multiple sources
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRegistry } from './plugin-registry.js';
import { IntegrationProvider, PluginManifest } from './types.js';
import * as logger from '../utils/logger.js';
import { getDataDir } from '../utils/data-dir.js';

const PLUGINS_DIR = path.join(getDataDir(), 'plugins');

async function validatePlugin(provider: IntegrationProvider): Promise<boolean> {
    try {
        if (!provider.name || !provider.displayName || !provider.description || !provider.version) {
            logger.debug(`Plugin validation failed: missing required properties`);
            return false;
        }

        if (typeof provider.auth !== 'function' || typeof provider.healthCheck !== 'function') {
            logger.debug(`Plugin validation failed: missing required methods`);
            return false;
        }

        return true;
    } catch (err: unknown) {
        logger.debug(`Plugin validation error: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}

async function tryRegisterBuiltIn(
    name: string,
    importFn: () => Promise<{ default?: IntegrationProvider; manifest?: PluginManifest }>
): Promise<void> {
    const registry = getRegistry();
    try {
        const module = await importFn();
        if (!module.default || !module.manifest) {
            logger.debug(`Built-in plugin ${name} missing default or manifest export`);
            return;
        }

        const provider = module.default;
        const manifest: PluginManifest = { ...module.manifest, builtIn: true };

        if (await validatePlugin(provider)) {
            registry.register(manifest, provider);
            logger.debug(`Loaded built-in plugin: ${manifest.name}`);
        }
    } catch (err: unknown) {
        logger.debug(`Failed to load built-in plugin ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export async function loadBuiltIn(): Promise<void> {
    // Register all built-in integrations via direct imports
    // This works regardless of bundling (single file or separate files)
    await Promise.all([
        tryRegisterBuiltIn('jira', () => import('../integrations/jira/index.js')),
        tryRegisterBuiltIn('github', () => import('../integrations/github/index.js')),
    ]);
}

export async function loadGlobal(): Promise<void> {
    // Scan for globally installed todo-plugin-* npm packages
    // Placeholder for future implementation
    try {
        logger.debug('Global plugin scanning not yet implemented');
    } catch (err: unknown) {
        logger.debug(`Failed to load global plugins: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export async function loadLocal(): Promise<void> {
    const registry = getRegistry();

    if (!fs.existsSync(PLUGINS_DIR)) {
        return;
    }

    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        try {
            const indexPath = path.join(PLUGINS_DIR, entry.name, 'index.js');

            if (!fs.existsSync(indexPath)) {
                continue;
            }

            const moduleUrl = `file://${indexPath}`;
            const module = await import(moduleUrl) as { default?: IntegrationProvider; manifest?: PluginManifest };

            if (!module.default || !module.manifest) {
                logger.debug(`Local plugin ${entry.name} missing export`);
                continue;
            }

            const provider = module.default;
            const manifest = module.manifest;

            if (await validatePlugin(provider)) {
                registry.register(manifest, provider, indexPath);
                logger.debug(`Loaded local plugin: ${manifest.name}`);
            }
        } catch (err: unknown) {
            logger.debug(`Failed to load local plugin ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

export async function loadAll(): Promise<void> {
    await loadBuiltIn();
    await loadLocal();
    await loadGlobal();
}
