// ============================================================
// Model finder — scans system for existing GGUF models
// ============================================================

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

const HOME = os.homedir();
const LLAMA_GLOB = '**/*[Ll]lama*3*[BbIi]nstruct*.[Gg][Gg][Uu][Ff]';

export async function findExistingModel(): Promise<string | null> {
    if (process.env.TODO_MODEL_PATH) {
        try { await fs.access(process.env.TODO_MODEL_PATH); return process.env.TODO_MODEL_PATH; }
        catch { return null; }
    }

    const ownMatch = await globFirst(path.join(HOME, '.todo-cli', 'models'), '*.gguf');
    if (ownMatch) return ownMatch;

    const lmMatch = await globFirst(path.join(HOME, '.cache', 'lm-studio', 'models'), LLAMA_GLOB);
    if (lmMatch) return lmMatch;

    const hfDir = process.env.HF_HUB_CACHE || path.join(HOME, '.cache', 'huggingface', 'hub');
    const hfMatch = await globFirst(hfDir, 'models--*[Ll]lama*3*/**/snapshots/**/*.gguf');
    if (hfMatch) return hfMatch;

    const llamaDir = process.env.LLAMA_CACHE || path.join(HOME, '.cache', 'llama.cpp');
    const llamaMatch = await globFirst(llamaDir, LLAMA_GLOB);
    if (llamaMatch) return llamaMatch;

    const ollamaMatch = await findOllamaModel();
    if (ollamaMatch) return ollamaMatch;

    return null;
}

async function globFirst(dir: string, pattern: string): Promise<string | null> {
    try { await fs.access(dir); } catch { return null; }
    try {
        const fullPattern = path.join(dir, pattern).split(path.sep).join('/');
        for await (const match of fs.glob(fullPattern)) {
            return match;
        }
    } catch { /* skip */ }
    return null;
}

async function findOllamaModel(): Promise<string | null> {
    const ollamaDir = process.env.OLLAMA_MODELS || path.join(HOME, '.ollama', 'models');
    const manifestBase = path.join(ollamaDir, 'manifests', 'registry.ollama.ai', 'library');

    const candidates = [
        path.join(manifestBase, 'llama3.2', '3b'),
        path.join(manifestBase, 'llama3.2', 'latest'),
        path.join(manifestBase, 'llama3.1', '8b'),
        path.join(manifestBase, 'llama3.1', 'latest'),
    ];

    for (const manifestPath of candidates) {
        try {
            const raw = await fs.readFile(manifestPath, 'utf-8');
            const manifest = JSON.parse(raw);
            const modelLayer = manifest.layers?.find(
                (l: { mediaType: string }) => l.mediaType === 'application/vnd.ollama.image.model'
            );
            if (!modelLayer?.digest) continue;
            const blobName = modelLayer.digest.replace(':', '-');
            const blobPath = path.join(ollamaDir, 'blobs', blobName);
            await fs.access(blobPath);
            return blobPath;
        } catch { continue; }
    }
    return null;
}
