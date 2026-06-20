// ============================================================
// Hook Manager — dispatches lifecycle hooks to plugins
// ============================================================

import { Task } from '../core/types.js';
import { getRegistry } from './plugin-registry.js';
import * as logger from '../utils/logger.js';

export class HookManager {
    async onTaskCreate(task: Task): Promise<void> {
        const registry = getRegistry();
        const plugins = registry.getEnabled();

        for (const plugin of plugins) {
            if (!plugin.provider.hooks?.onTaskCreate) {
                continue;
            }

            try {
                await plugin.provider.hooks.onTaskCreate(task);
            } catch (err: unknown) {
                logger.logWarn(`Plugin ${plugin.manifest.name} error in onTaskCreate: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    async onTaskUpdate(task: Task, changes: Partial<Task>): Promise<void> {
        const registry = getRegistry();
        const plugins = registry.getEnabled();

        for (const plugin of plugins) {
            if (!plugin.provider.hooks?.onTaskUpdate) {
                continue;
            }

            try {
                await plugin.provider.hooks.onTaskUpdate(task, changes);
            } catch (err: unknown) {
                logger.logWarn(`Plugin ${plugin.manifest.name} error in onTaskUpdate: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    async onTaskComplete(task: Task): Promise<void> {
        const registry = getRegistry();
        const plugins = registry.getEnabled();

        for (const plugin of plugins) {
            if (!plugin.provider.hooks?.onTaskComplete) {
                continue;
            }

            try {
                await plugin.provider.hooks.onTaskComplete(task);
            } catch (err: unknown) {
                logger.logWarn(`Plugin ${plugin.manifest.name} error in onTaskComplete: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    async onTaskDelete(task: Task): Promise<void> {
        const registry = getRegistry();
        const plugins = registry.getEnabled();

        for (const plugin of plugins) {
            if (!plugin.provider.hooks?.onTaskDelete) {
                continue;
            }

            try {
                await plugin.provider.hooks.onTaskDelete(task);
            } catch (err: unknown) {
                logger.logWarn(`Plugin ${plugin.manifest.name} error in onTaskDelete: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    async onTimerStart(task: Task): Promise<void> {
        const registry = getRegistry();
        const plugins = registry.getEnabled();

        for (const plugin of plugins) {
            if (!plugin.provider.hooks?.onTimerStart) {
                continue;
            }

            try {
                await plugin.provider.hooks.onTimerStart(task);
            } catch (err: unknown) {
                logger.logWarn(`Plugin ${plugin.manifest.name} error in onTimerStart: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    async onTimerComplete(task: Task, duration: number): Promise<void> {
        const registry = getRegistry();
        const plugins = registry.getEnabled();

        for (const plugin of plugins) {
            if (!plugin.provider.hooks?.onTimerComplete) {
                continue;
            }

            try {
                await plugin.provider.hooks.onTimerComplete(task, duration);
            } catch (err: unknown) {
                logger.logWarn(`Plugin ${plugin.manifest.name} error in onTimerComplete: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
}

let hookManager: HookManager | null = null;

export function getHookManager(): HookManager {
    if (!hookManager) {
        hookManager = new HookManager();
    }
    return hookManager;
}
