// MCP server construction and tool registration.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerTrackingTools } from './tools/tracking.js';

export interface ServerOptions {
    allowDelete: boolean;
}

export function buildMcpServer(opts: ServerOptions): McpServer {
    const server = new McpServer({
        name: 'todo-cli',
        version: '1.0.0',
    });

    registerTaskTools(server, { allowDelete: opts.allowDelete });
    registerTrackingTools(server, { allowDelete: opts.allowDelete });

    return server;
}
