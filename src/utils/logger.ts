// Structured logger
import { theme } from './theme.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentLevel: LogLevel = 'info';
let quietMode = false;

const levelOrder: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

export function setQuiet(quiet: boolean): void {
    quietMode = quiet;
}

function shouldLog(level: LogLevel): boolean {
    if (quietMode && level !== 'error') return false;
    return levelOrder[level] >= levelOrder[currentLevel];
}

export function debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
        const suffix = args.length > 0 ? ' ' + args.map(String).join(' ') : '';
        console.error(theme().debug.chalk(`[debug] ${message}${suffix}`));
    }
}

export function log(message: string): void {
    if (shouldLog('info')) {
        console.log(message);
    }
}

export function logWarn(message: string): void {
    if (shouldLog('warn')) {
        console.error(theme().warning.chalk(`⚠ ${message}`));
    }
}

export function logError(message: string): void {
    if (shouldLog('error')) {
        console.error(theme().error.chalk(`✗ ${message}`));
    }
}
