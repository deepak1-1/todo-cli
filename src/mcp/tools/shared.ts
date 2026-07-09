// Shared MCP result helpers — used by all tool modules.

/** Success result: text summary + structured JSON content. Arrays wrapped under `items`. */
export function ok(data: unknown, summary: string) {
    return {
        content: [{ type: 'text' as const, text: summary }],
        structuredContent: Array.isArray(data) ? { items: data } : (data as Record<string, unknown>),
    };
}

/** Error result. */
export function err(message: string) {
    return {
        content: [{ type: 'text' as const, text: message }],
        isError: true as const,
    };
}
