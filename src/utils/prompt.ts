// ============================================================
// Interactive CLI prompts using Node.js readline
// ============================================================

import * as readline from 'node:readline';

export async function promptUser(
    message: string,
    options?: { type?: 'text' | 'password'; default?: string }
): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
    });

    const suffix = options?.default ? ` (${options.default})` : '';
    const prompt = `  ${message}${suffix} `;

    return new Promise<string>((resolve) => {
        if (options?.type === 'password') {
            // For password input, mute the output
            process.stderr.write(prompt);
            const stdin = process.stdin;
            const wasRaw = stdin.isRaw;

            if (stdin.isTTY && stdin.setRawMode) {
                stdin.setRawMode(true);
            }

            let input = '';
            const onData = (char: Buffer) => {
                const c = char.toString();
                if (c === '\n' || c === '\r') {
                    if (stdin.isTTY && stdin.setRawMode) {
                        stdin.setRawMode(wasRaw ?? false);
                    }
                    stdin.removeListener('data', onData);
                    process.stderr.write('\n');
                    rl.close();
                    resolve(input || options?.default || '');
                } else if (c === '\u0003') {
                    // Ctrl+C
                    rl.close();
                    process.exit(0);
                } else if (c === '\u007f' || c === '\b') {
                    // Backspace
                    if (input.length > 0) {
                        input = input.slice(0, -1);
                    }
                } else {
                    input += c;
                    process.stderr.write('*');
                }
            };
            stdin.on('data', onData);
        } else {
            rl.question(prompt, (answer) => {
                rl.close();
                resolve(answer.trim() || options?.default || '');
            });
        }
    });
}
