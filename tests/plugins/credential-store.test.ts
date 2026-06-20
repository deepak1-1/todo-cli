// Tests for EncryptedCredentialStore — hermetic, uses temp dirs only

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EncryptedCredentialStore, CredentialFileCorruptError } from '../../src/plugins/credential-store.js';

// Creates a fresh temp dir and returns cleanup + store factory
function makeTempStore(): { dir: string; store: EncryptedCredentialStore; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-creds-test-'));
    const credentialsFile = path.join(dir, 'credentials.json');
    const saltFile = path.join(dir, '.salt');
    const store = new EncryptedCredentialStore({ credentialsDir: dir, credentialsFile, saltFile });
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    return { dir, store, cleanup };
}

// Builds a legacy-format encrypted entry using PBKDF2 master key (no v field)
function buildLegacyEntry(
    plaintext: string,
    saltFile: string,
): { cipher: string; iv: string; authTag: string } {
    const salt = Buffer.from(fs.readFileSync(saltFile, 'utf8'), 'hex');
    const passphrase = `${os.hostname()}:${os.userInfo().username}`;
    const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { cipher: encrypted, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}

describe('EncryptedCredentialStore', () => {
    let dir: string;
    let credentialsFile: string;
    let saltFile: string;
    let store: EncryptedCredentialStore;
    let cleanup: () => void;

    beforeEach(async () => {
        ({ dir, store, cleanup } = makeTempStore());
        credentialsFile = path.join(dir, 'credentials.json');
        saltFile = path.join(dir, '.salt');
        // Trigger salt creation by performing a set so the salt file exists for legacy helpers
        await store.set('_init', 'seed');
        await store.delete('_init');
    });

    afterEach(() => cleanup());

    it('legacy read: no-v entry decrypts correctly', async () => {
        const legacyEntry = buildLegacyEntry('secret-value', saltFile);
        // Write directly as a legacy entry (no v field)
        const creds = { 'jira:token': legacyEntry };
        fs.writeFileSync(credentialsFile, JSON.stringify(creds, null, 2), { encoding: 'utf8', mode: 0o600 });

        const result = await store.get('jira:token');
        expect(result).toBe('secret-value');
    });

    it('v2 write: set produces v:2 entry; get returns correct plaintext', async () => {
        await store.set('jira:token', 'abc');

        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const entry = raw['jira:token'] as { v?: number };
        expect(entry.v).toBe(2);

        const result = await store.get('jira:token');
        expect(result).toBe('abc');
    });

    it('auto-migration: legacy entry becomes v:2 after first get', async () => {
        const legacyEntry = buildLegacyEntry('migrated-value', saltFile);
        fs.writeFileSync(credentialsFile, JSON.stringify({ 'github:token': legacyEntry }, null, 2), {
            encoding: 'utf8',
            mode: 0o600,
        });

        // First get triggers migration
        const result = await store.get('github:token');
        expect(result).toBe('migrated-value');

        // Entry is now v:2 on disk
        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const upgraded = raw['github:token'] as { v?: number };
        expect(upgraded.v).toBe(2);

        // Plaintext still correct after migration
        const result2 = await store.get('github:token');
        expect(result2).toBe('migrated-value');
    });

    it('mixed file: legacy and v2 entries are both readable', async () => {
        const legacyEntry = buildLegacyEntry('legacy-secret', saltFile);
        fs.writeFileSync(
            credentialsFile,
            JSON.stringify({ 'jira:token': legacyEntry }, null, 2),
            { encoding: 'utf8', mode: 0o600 },
        );

        // Write a v2 entry alongside the legacy one
        await store.set('github:token', 'v2-secret');

        const jiraResult = await store.get('jira:token');
        const githubResult = await store.get('github:token');
        expect(jiraResult).toBe('legacy-secret');
        expect(githubResult).toBe('v2-secret');
    });

    it('namespace isolation: v2 entry for jira namespace does not decrypt as github namespace', async () => {
        // Write a legitimate jira:token v2 entry
        await store.set('jira:token', 'real-jira-secret');

        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const jiraEntry = raw['jira:token'] as { v: 2; cipher: string; iv: string; authTag: string };

        // Inject the jira ciphertext as if it were a github entry (wrong namespace key)
        const spoofed = { ...jiraEntry };
        const creds = { 'github:token': spoofed };
        fs.writeFileSync(credentialsFile, JSON.stringify(creds, null, 2), { encoding: 'utf8', mode: 0o600 });

        // Decryption must fail (wrong HKDF namespace → wrong key → auth tag mismatch)
        const result = await store.get('github:token');
        expect(result).toBeNull();
    });

    it('list: returns all stored keys', async () => {
        await store.set('jira:token', 'j');
        await store.set('github:token', 'g');
        const keys = await store.list();
        expect(keys.sort()).toEqual(['github:token', 'jira:token']);
    });

    it('delete: removes the key', async () => {
        await store.set('jira:token', 'to-be-deleted');
        await store.delete('jira:token');
        const result = await store.get('jira:token');
        expect(result).toBeNull();
    });

    it('get on missing key returns null', async () => {
        const result = await store.get('nonexistent:key');
        expect(result).toBeNull();
    });

    it('default-namespace key (no colon) round-trips correctly', async () => {
        await store.set('mytoken', 'plain-value');
        const result = await store.get('mytoken');
        expect(result).toBe('plain-value');

        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const entry = raw['mytoken'] as { v?: number };
        expect(entry.v).toBe(2);
    });

    it('migrate() is a no-op and resolves without error', async () => {
        await expect(store.migrate()).resolves.toBeUndefined();
    });

    // --- C2: error-path distinction ---

    it('ENOENT: missing credentials file returns empty (no error)', async () => {
        // Remove the credentials file written by beforeEach seed
        if (fs.existsSync(credentialsFile)) fs.unlinkSync(credentialsFile);
        const keys = await store.list();
        expect(keys).toEqual([]);
    });

    it('ENOENT: get on missing credentials file returns null (no error)', async () => {
        if (fs.existsSync(credentialsFile)) fs.unlinkSync(credentialsFile);
        const result = await store.get('some:key');
        expect(result).toBeNull();
    });

    it('corrupt JSON: loadCredentials throws CredentialFileCorruptError', async () => {
        fs.writeFileSync(credentialsFile, '{ not valid json !!!', { encoding: 'utf8', mode: 0o600 });
        await expect(store.get('any:key')).rejects.toBeInstanceOf(CredentialFileCorruptError);
    });

    it('corrupt JSON: CredentialFileCorruptError message includes file path', async () => {
        fs.writeFileSync(credentialsFile, 'not-json', { encoding: 'utf8', mode: 0o600 });
        await expect(store.get('any:key')).rejects.toThrow(credentialsFile);
    });

    it('decrypt failure: get returns null and does not throw', async () => {
        // Write a v2 entry with a tampered cipher so auth-tag verification fails
        await store.set('jira:token', 'original-secret');
        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const entry = raw['jira:token'] as { v: 2; cipher: string; iv: string; authTag: string };
        // Tamper the authTag to force AES-GCM auth failure
        entry.authTag = 'deadbeefdeadbeefdeadbeefdeadbeef';
        fs.writeFileSync(credentialsFile, JSON.stringify({ 'jira:token': entry }, null, 2), { encoding: 'utf8', mode: 0o600 });

        const result = await store.get('jira:token');
        expect(result).toBeNull();
    });

    it('decrypt failure: get logs a warning (does not silently swallow)', async () => {
        // logWarn calls console.error internally
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await store.set('jira:token', 'value');
        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const entry = raw['jira:token'] as { v: 2; cipher: string; iv: string; authTag: string };
        entry.authTag = 'ffffffffffffffffffffffffffffffff';
        fs.writeFileSync(credentialsFile, JSON.stringify({ 'jira:token': entry }, null, 2), { encoding: 'utf8', mode: 0o600 });

        await store.get('jira:token');
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });

    it('getOrThrow: throws on missing key with actionable message', async () => {
        await expect(store.getOrThrow('missing:key')).rejects.toThrow('missing:key');
    });

    it('getOrThrow: returns plaintext for valid key', async () => {
        await store.set('jira:apikey', 'super-secret');
        const result = await store.getOrThrow('jira:apikey');
        expect(result).toBe('super-secret');
    });

    it('getOrThrow: throws on decrypt failure', async () => {
        await store.set('github:token', 'value');
        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const entry = raw['github:token'] as { v: 2; cipher: string; iv: string; authTag: string };
        entry.authTag = 'aabbccddaabbccddaabbccddaabbccdd';
        fs.writeFileSync(credentialsFile, JSON.stringify({ 'github:token': entry }, null, 2), { encoding: 'utf8', mode: 0o600 });

        await expect(store.getOrThrow('github:token')).rejects.toThrow('github:token');
    });

    it('getOrThrow: auto-migrates legacy entry and returns correct value', async () => {
        const legacyEntry = buildLegacyEntry('legacy-throw-value', saltFile);
        fs.writeFileSync(credentialsFile, JSON.stringify({ 'jira:secret': legacyEntry }, null, 2), { encoding: 'utf8', mode: 0o600 });

        const result = await store.getOrThrow('jira:secret');
        expect(result).toBe('legacy-throw-value');

        // Entry should now be v:2 on disk
        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        expect((raw['jira:secret'] as { v?: number }).v).toBe(2);
    });
});
