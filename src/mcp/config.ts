// Emit paste-ready MCP client config JSON to stdout.
import { resolve } from 'path';

/** Resolve bin path from the actually-invoked argv[1] (reliable after bundling). The absolute path is intentional — it's the stable bin-shim path, runnable everywhere including global npm installs and npx. */
function resolveBinPath(): string {
    const invoked = process.argv[1];
    if (invoked && invoked.length > 0) {
        return resolve(invoked);
    }
    // Defensive last-resort for the rare empty-argv[1] case (not hit in normal Node execution).
    return 'todo';
}

export function printMcpConfig(): void {
    const binPath = resolveBinPath();
    const config = {
        mcpServers: {
            todo: {
                command: binPath,
                args: ['mcp'],
            },
        },
    };
    process.stdout.write(JSON.stringify(config, null, 2) + '\n');
}
