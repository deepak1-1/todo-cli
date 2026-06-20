// Factory for the shared auth/load-plugin/run-with-error-wrap pattern in integration commands.

import { getRegistry, loadAll, EncryptedCredentialStore } from '../plugins/index.js';
import type { CredentialStore, RegisteredPlugin } from '../plugins/index.js';
import { getContext } from './context.js';
import type { AppContext } from './context.js';
import { fail, EXIT } from '../utils/exit.js';

export interface IntegrationRunOpts {
    // Whether the fn body requires valid credentials (not used to block, just for callers to document intent).
    requiresCreds?: boolean;
    // Prefix prepended to the error message on fn rejection, e.g. 'Pull failed'.
    errorPrefix: string;
}

export interface IntegrationCtx<P> {
    plugin: P;
    credStore: CredentialStore;
    ctx: AppContext;
}

/**
 * Returns a Commander-compatible async action handler that:
 * 1. Loads all plugins and resolves `providerName` from the registry.
 * 2. Exits with NOT_FOUND (3) if the plugin is missing.
 * 3. Constructs an EncryptedCredentialStore and calls getContext().
 * 4. Calls fn(ictx); on rejection exits with GENERIC (1) and prefixed error.
 */
export function runIntegrationCommand<P extends RegisteredPlugin>(
    providerName: string,
    opts: IntegrationRunOpts,
    fn: (ictx: IntegrationCtx<P>) => Promise<void>,
): () => Promise<void> {
    return async () => {
        await loadAll();
        const plugin = getRegistry().get(providerName) as P | undefined;
        if (!plugin) {
            return fail(EXIT.NOT_FOUND, `${capitalize(providerName)} integration not found`);
        }
        const credStore = new EncryptedCredentialStore();
        const ctx = getContext();
        try {
            await fn({ plugin, credStore, ctx });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return fail(EXIT.GENERIC, `${opts.errorPrefix}: ${msg}`);
        }
    };
}

// Capitalizes the first character of a string.
function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
