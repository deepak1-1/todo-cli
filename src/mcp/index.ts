// MCP server entry point — stdio transport, stdout-safety redirect.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './server.js';
import { printMcpConfig } from './config.js';

export interface McpRunOptions {
    printConfig: boolean;
    allowDelete: boolean;
}

/** Restore console.log to its original implementation. Extracted for unit testability. */
export function restoreConsole(original: typeof console.log): void {
    console.log = original;
}

export async function runMcpServer(opts: McpRunOptions): Promise<void> {
    if (opts.printConfig) {
        printMcpConfig();
        return;
    }

    // Redirect console.log → console.error so plugin notify() and logger.log()
    // cannot corrupt the JSON-RPC stream owned by StdioServerTransport.
    const originalLog = console.log;
    console.log = console.error;

    const server = buildMcpServer({ allowDelete: opts.allowDelete });
    const transport = new StdioServerTransport();

    await server.connect(transport);

    // Restore on exit/SIGTERM so teardown prints are visible.
    process.on('exit', () => { restoreConsole(originalLog); });
    // SIGINT is handled in src/index.ts; SIGTERM needs its own teardown here.
    process.on('SIGTERM', () => { restoreConsole(originalLog); process.exit(0); });
}
