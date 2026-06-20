// ============================================================
// Plugin logger — wraps core logger with plugin prefix
// ============================================================

import * as logger from '../utils/logger.js';
import { PluginLogger } from './types.js';

export function createPluginLogger(pluginName: string): PluginLogger {
    const prefix = `[${pluginName}]`;

    return {
        debug(msg: string, ...args: unknown[]): void {
            logger.debug(`${prefix} ${msg}`, ...args);
        },
        info(msg: string, ..._args: unknown[]): void {
            logger.log(`${prefix} ${msg}`);
        },
        warn(msg: string, ..._args: unknown[]): void {
            logger.logWarn(`${prefix} ${msg}`);
        },
        error(msg: string, ..._args: unknown[]): void {
            logger.logError(`${prefix} ${msg}`);
        },
    };
}
