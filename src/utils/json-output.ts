// JSON output shapes and emitter for mutating commands with --json flag

export interface JsonSuccess<T = unknown> {
    // true for full success; false for a partial-result payload (e.g. bulk N-of-M failures)
    ok: boolean;
    command: string;
    data?: T;
    recurring?: { id: number; dueDate: string };
}

export interface JsonError {
    ok: false;
    command: string;
    error: { code: number; message: string };
}

// Writes a single-line JSON payload to stdout and nothing else.
export function emitJson(payload: JsonSuccess | JsonError): void {
    process.stdout.write(JSON.stringify(payload) + '\n');
}
