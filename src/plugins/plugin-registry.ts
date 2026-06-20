// ============================================================
// Plugin Registry — singleton tracking loaded plugins
// ============================================================

import { RegisteredPlugin, IntegrationProvider, PluginManifest } from './types.js';

class PluginRegistry {
    private plugins: Map<string, RegisteredPlugin> = new Map();

    register(manifest: PluginManifest, provider: IntegrationProvider, path?: string): void {
        const plugin: RegisteredPlugin = {
            manifest,
            provider,
            enabled: true,
            path,
        };

        this.plugins.set(manifest.name, plugin);
    }

    unregister(name: string): boolean {
        return this.plugins.delete(name);
    }

    get(name: string): RegisteredPlugin | undefined {
        return this.plugins.get(name);
    }

    getAll(): RegisteredPlugin[] {
        return Array.from(this.plugins.values());
    }

    getEnabled(): RegisteredPlugin[] {
        return Array.from(this.plugins.values()).filter((p) => p.enabled);
    }

    isRegistered(name: string): boolean {
        return this.plugins.has(name);
    }

    setEnabled(name: string, enabled: boolean): boolean {
        const plugin = this.plugins.get(name);
        if (!plugin) {
            return false;
        }
        plugin.enabled = enabled;
        return true;
    }

    clear(): void {
        this.plugins.clear();
    }
}

let registry: PluginRegistry | null = null;

export function getRegistry(): PluginRegistry {
    if (!registry) {
        registry = new PluginRegistry();
    }
    return registry;
}
