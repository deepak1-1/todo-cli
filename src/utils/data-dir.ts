import path from 'node:path';
import os from 'node:os';

// Resolves the app data dir; TODO_CLI_HOME overrides for tests/smoke isolation
export function getDataDir(): string {
    return getDataDirOverride() || path.join(os.homedir(), '.todo-cli');
}

// Returns the TODO_CLI_HOME override if set, else undefined (for opt-in consumers like conf)
export function getDataDirOverride(): string | undefined {
    return process.env.TODO_CLI_HOME || undefined;
}
