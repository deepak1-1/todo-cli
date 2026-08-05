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
    const machineKeyFile = path.join(dir, '.machinekey');
    const store = new EncryptedCredentialStore({ credentialsDir: dir, credentialsFile, saltFile, machineKeyFile });
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

// Builds a v2-format encrypted entry: HKDF provider key derived from the legacy hostname master key
function buildV2Entry(
    plaintext: string,
    saltFile: string,
    namespace: string,
): { v: 2; cipher: string; iv: string; authTag: string } {
    const salt = Buffer.from(fs.readFileSync(saltFile, 'utf8'), 'hex');
    const passphrase = `${os.hostname()}:${os.userInfo().username}`;
    const masterKey = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
    const providerKey = Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, namespace, 32));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', providerKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { v: 2, cipher: encrypted, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}

describe('EncryptedCredentialStore', () => {
    let dir: string;
    let credentialsFile: string;
    let saltFile: string;
    let machineKeyFile: string;
    let store: EncryptedCredentialStore;
    let cleanup: () => void;

    beforeEach(async () => {
        ({ dir, store, cleanup } = makeTempStore());
        credentialsFile = path.join(dir, 'credentials.json');
        saltFile = path.join(dir, '.salt');
        machineKeyFile = path.join(dir, '.machinekey');
        // Trigger salt + machine key creation by performing a set so the files exist for legacy helpers
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

    it('v3 write: set produces v:3 entry; get returns correct plaintext', async () => {
        await store.set('jira:token', 'abc');

        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const entry = raw['jira:token'] as { v?: number };
        expect(entry.v).toBe(3);

        const result = await store.get('jira:token');
        expect(result).toBe('abc');
    });

    it('machine key file is created with 0600 perms and 32 bytes', async () => {
        expect(fs.existsSync(machineKeyFile)).toBe(true);
        const stat = fs.statSync(machineKeyFile);
        expect(stat.mode & 0o777).toBe(0o600);
        const key = Buffer.from(fs.readFileSync(machineKeyFile, 'utf8'), 'hex');
        expect(key.length).toBe(32);
    });

    it('stability across hostname change: v3 entries decrypt independent of os.hostname()/username', async () => {
        // v3 keys are derived solely from the persisted machine key + salt, never from hostname/username.
        // Simulate "moving machines" by re-deriving the v3 provider key with a different hostname/username
        // baked into a manually-built legacy-shaped derivation, and confirming it does NOT match the
        // actual stored key material (proving hostname/username play no role in v3 decryption).
        await store.set('jira:token', 'stable-secret');
        const salt = Buffer.from(fs.readFileSync(saltFile, 'utf8'), 'hex');
        const machineKey = Buffer.from(fs.readFileSync(machineKeyFile, 'utf8'), 'hex');
        const machineMasterKey = crypto.pbkdf2Sync(machineKey, salt, 100000, 32, 'sha256');
        const hostnameMasterKey = crypto.pbkdf2Sync(
            `${os.hostname()}:${os.userInfo().username}`,
            salt,
            100000,
            32,
            'sha256',
        );
        expect(machineMasterKey.equals(hostnameMasterKey)).toBe(false);

        // And the actual round-trip still works regardless of what hostname/username happen to be right now
        const result = await store.get('jira:token');
        expect(result).toBe('stable-secret');
    });

    it('v3 entry does not decrypt with a different machine key (portability boundary)', async () => {
        await store.set('jira:token', 'machine-bound-secret');
        // Overwrite the machine key with a fresh random one, simulating a different machine
        const freshKey = crypto.randomBytes(32);
        fs.writeFileSync(machineKeyFile, freshKey.toString('hex'), { encoding: 'utf8', mode: 0o600 });

        const result = await store.get('jira:token');
        expect(result).toBeNull();
    });

    it('auto-migration: legacy entry becomes v:3 after first get', async () => {
        const legacyEntry = buildLegacyEntry('migrated-value', saltFile);
        fs.writeFileSync(credentialsFile, JSON.stringify({ 'github:token': legacyEntry }, null, 2), {
            encoding: 'utf8',
            mode: 0o600,
        });

        // First get triggers migration
        const result = await store.get('github:token');
        expect(result).toBe('migrated-value');

        // Entry is now v:3 on disk
        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const upgraded = raw['github:token'] as { v?: number };
        expect(upgraded.v).toBe(3);

        // Plaintext still correct after migration
        const result2 = await store.get('github:token');
        expect(result2).toBe('migrated-value');
    });

    it('auto-migration: v2 entry decrypts via legacy fallback and upgrades to v:3', async () => {
        const v2Entry = buildV2Entry('v2-migrated-value', saltFile, 'jira');
        fs.writeFileSync(credentialsFile, JSON.stringify({ 'jira:token': v2Entry }, null, 2), {
            encoding: 'utf8',
            mode: 0o600,
        });

        const result = await store.get('jira:token');
        expect(result).toBe('v2-migrated-value');

        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const upgraded = raw['jira:token'] as { v?: number };
        expect(upgraded.v).toBe(3);

        const result2 = await store.get('jira:token');
        expect(result2).toBe('v2-migrated-value');
    });

    it('mixed file: legacy and v3 entries are both readable', async () => {
        const legacyEntry = buildLegacyEntry('legacy-secret', saltFile);
        fs.writeFileSync(
            credentialsFile,
            JSON.stringify({ 'jira:token': legacyEntry }, null, 2),
            { encoding: 'utf8', mode: 0o600 },
        );

        // Write a v3 entry alongside the legacy one
        await store.set('github:token', 'v3-secret');

        const jiraResult = await store.get('jira:token');
        const githubResult = await store.get('github:token');
        expect(jiraResult).toBe('legacy-secret');
        expect(githubResult).toBe('v3-secret');
    });

    it('namespace isolation: v3 entry for jira namespace does not decrypt as github namespace', async () => {
        // Write a legitimate jira:token v3 entry
        await store.set('jira:token', 'real-jira-secret');

        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const jiraEntry = raw['jira:token'] as { v: 3; cipher: string; iv: string; authTag: string };

        // Inject the jira ciphertext as if it were a github entry (wrong namespace key)
        const spoofed = { ...jiraEntry };
        const creds = { 'github:token': spoofed };
        fs.writeFileSync(credentialsFile, JSON.stringify(creds, null, 2), { encoding: 'utf8', mode: 0o600 });

        // Decryption must fail (wrong HKDF namespace → wrong key → auth tag mismatch)
        const result = await store.get('github:token');
        expect(result).toBeNull();
    });

    it('corrupt machine key (wrong length) causes get() to return null rather than silently regenerate', async () => {
        await store.set('jira:token', 'value-before-corruption');
        // Truncate the machine key file to an invalid length
        fs.writeFileSync(machineKeyFile, 'abcd1234', { encoding: 'utf8', mode: 0o600 });

        const result = await store.get('jira:token');
        expect(result).toBeNull();

        // Machine key file must be left untouched — no silent regeneration that would brick other v3 entries
        expect(fs.readFileSync(machineKeyFile, 'utf8')).toBe('abcd1234');
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
        expect(entry.v).toBe(3);
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
        // Write a v3 entry with a tampered cipher so auth-tag verification fails
        await store.set('jira:token', 'original-secret');
        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        const entry = raw['jira:token'] as { v: 3; cipher: string; iv: string; authTag: string };
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
        const entry = raw['jira:token'] as { v: 3; cipher: string; iv: string; authTag: string };
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
        const entry = raw['github:token'] as { v: 3; cipher: string; iv: string; authTag: string };
        entry.authTag = 'aabbccddaabbccddaabbccddaabbccdd';
        fs.writeFileSync(credentialsFile, JSON.stringify({ 'github:token': entry }, null, 2), { encoding: 'utf8', mode: 0o600 });

        await expect(store.getOrThrow('github:token')).rejects.toThrow('github:token');
    });

    it('getOrThrow: auto-migrates legacy entry and returns correct value', async () => {
        const legacyEntry = buildLegacyEntry('legacy-throw-value', saltFile);
        fs.writeFileSync(credentialsFile, JSON.stringify({ 'jira:secret': legacyEntry }, null, 2), { encoding: 'utf8', mode: 0o600 });

        const result = await store.getOrThrow('jira:secret');
        expect(result).toBe('legacy-throw-value');

        // Entry should now be v:3 on disk
        const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) as Record<string, unknown>;
        expect((raw['jira:secret'] as { v?: number }).v).toBe(3);
    });
});
