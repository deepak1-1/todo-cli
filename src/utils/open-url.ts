// ============================================================
// Cross-platform URL opener using child_process
// ============================================================

import { execFile } from 'node:child_process';

export function openUrl(url: string): void {
    const cmd = process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
            ? 'cmd'
            : 'xdg-open';
    const args = process.platform === 'win32'
        ? ['/c', 'start', '', url]
        : [url];
    execFile(cmd, args, (_err) => {
        // Intentionally ignored: opening a URL is best-effort; the URL is already
        // printed to the console so the user can open it manually if this fails.
    });
}

export default openUrl;
