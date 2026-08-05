// Encrypted credential storage with per-provider HKDF-SHA256 key derivation from a stable machine key

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { CredentialStore } from './types.js';
import { debug, logWarn } from '../utils/logger.js';
import { getDataDir } from '../utils/data-dir.js';

// Thrown when the credentials file exists but cannot be parsed as valid JSON
export class CredentialFileCorruptError extends Error {
    constructor(filePath: string, cause: unknown) {
        super(`Credentials file is corrupt and cannot be read: ${filePath}. Cause: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = 'CredentialFileCorruptError';
    }
}

// Default paths; overridden per-instance via constructor for test isolation
const DEFAULT_CREDENTIALS_DIR = getDataDir();
const DEFAULT_CREDENTIALS_FILE = path.join(DEFAULT_CREDENTIALS_DIR, 'credentials.json');
const DEFAULT_SALT_FILE = path.join(DEFAULT_CREDENTIALS_DIR, '.salt');
const DEFAULT_MACHINE_KEY_FILE = path.join(DEFAULT_CREDENTIALS_DIR, '.machinekey');

// Machine key must be exactly 32 random bytes (256 bits)
const MACHINE_KEY_BYTES = 32;

// Legacy entry shape: no `v` field
interface LegacyEntry {
    cipher: string;
    iv: string;
    authTag: string;
}

// v2 entry shape: per-provider HKDF key derived from the low-entropy hostname master key
interface V2Entry {
    v: 2;
    cipher: string;
    iv: string;
    authTag: string;
}

// v3 entry shape: per-provider HKDF key derived from the high-entropy machine key
interface V3Entry {
    v: 3;
    cipher: string;
    iv: string;
    authTag: string;
}

type StoredEntry = LegacyEntry | V2Entry | V3Entry;

interface CredentialsFile {
    [key: string]: StoredEntry;
}

// Extracts the namespace (provider) portion of a credential key
function namespaceOf(key: string): string {
    const idx = key.indexOf(':');
    return idx === -1 ? 'default' : key.slice(0, idx);
}

export class EncryptedCredentialStore implements CredentialStore {
    private readonly credentialsDir: string;
    private readonly credentialsFile: string;
    private readonly saltFile: string;
    private readonly machineKeyFile: string;

    constructor(paths?: {
        credentialsDir?: string;
        credentialsFile?: string;
        saltFile?: string;
        machineKeyFile?: string;
    }) {
        this.credentialsDir = paths?.credentialsDir ?? DEFAULT_CREDENTIALS_DIR;
        this.credentialsFile = paths?.credentialsFile ?? DEFAULT_CREDENTIALS_FILE;
        this.saltFile = paths?.saltFile ?? DEFAULT_SALT_FILE;
        this.machineKeyFile = paths?.machineKeyFile ?? DEFAULT_MACHINE_KEY_FILE;
    }

    // Public no-op stub; callers can wire auto-migration later
    async migrate(): Promise<void> {}

    private ensureDir(): void {
        if (!fs.existsSync(this.credentialsDir)) {
            fs.mkdirSync(this.credentialsDir, { recursive: true, mode: 0o700 });
        }
    }

    private getOrCreateSalt(): Buffer {
        this.ensureDir();
        if (fs.existsSync(this.saltFile)) {
            return Buffer.from(fs.readFileSync(this.saltFile, 'utf8'), 'hex');
        }
        const salt = crypto.randomBytes(32);
        fs.writeFileSync(this.saltFile, salt.toString('hex'), { encoding: 'utf8', mode: 0o600 });
        return salt;
    }

    // Reads or creates the persistent high-entropy machine key (256 random bits, 0600 perms)
    private getOrCreateMachineKey(): Buffer {
        this.ensureDir();
        if (fs.existsSync(this.machineKeyFile)) {
            const key = Buffer.from(fs.readFileSync(this.machineKeyFile, 'utf8'), 'hex');
            if (key.length !== MACHINE_KEY_BYTES) {
                throw new Error(
                    `Machine key file is corrupt (expected ${MACHINE_KEY_BYTES} bytes, got ${key.length}): ${this.machineKeyFile}. Restore it from backup or re-authenticate to generate a new one.`,
                );
            }
            return key;
        }
        const machineKey = crypto.randomBytes(MACHINE_KEY_BYTES);
        fs.writeFileSync(this.machineKeyFile, machineKey.toString('hex'), { encoding: 'utf8', mode: 0o600 });
        return machineKey;
    }

    // Derives the master key from the stable machine key + salt via PBKDF2 (stable across hostname/user changes)
    private deriveMachineMasterKey(): Buffer {
        const machineKey = this.getOrCreateMachineKey();
        const salt = this.getOrCreateSalt();
        return crypto.pbkdf2Sync(machineKey, salt, 100000, 32, 'sha256');
    }

    // Derives the legacy master key from hostname:username + salt via PBKDF2 (backward-compat decrypt only)
    private deriveLegacyMasterKey(): Buffer {
        const passphrase = `${os.hostname()}:${os.userInfo().username}`;
        const salt = this.getOrCreateSalt();
        return crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
    }

    // Derives a per-provider key from a given master key + salt via HKDF-SHA256
    private deriveProviderKey(namespace: string, masterKey: Buffer): Buffer {
        const salt = this.getOrCreateSalt();
        return Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, namespace, 32));
    }

    // Encrypts plaintext with the provider key for the given credential key; always writes v:3
    private encrypt(plaintext: string, key: string): V3Entry {
        const derivedKey = this.deriveProviderKey(namespaceOf(key), this.deriveMachineMasterKey());
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);

        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        return {
            v: 3,
            cipher: encrypted,
            iv: iv.toString('hex'),
            authTag: cipher.getAuthTag().toString('hex'),
        };
    }

    // Decrypts an entry: v3 uses machine-key provider key, v2 uses legacy provider key, legacy (no v) uses legacy master key directly
    private decrypt(entry: StoredEntry, key: string): string {
        const isV3 = (e: StoredEntry): e is V3Entry => (e as V3Entry).v === 3;
        const isV2 = (e: StoredEntry): e is V2Entry => (e as V2Entry).v === 2;
        const derivedKey = isV3(entry)
            ? this.deriveProviderKey(namespaceOf(key), this.deriveMachineMasterKey())
            : isV2(entry)
              ? this.deriveProviderKey(namespaceOf(key), this.deriveLegacyMasterKey())
              : this.deriveLegacyMasterKey();

        const iv = Buffer.from(entry.iv, 'hex');
        const authTag = Buffer.from(entry.authTag, 'hex');

        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(entry.cipher, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    private loadCredentials(): CredentialsFile {
        this.ensureDir();
        // ENOENT — file not yet created; silently return empty store
        let content: string;
        try {
            content = fs.readFileSync(this.credentialsFile, 'utf8');
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') return {};
            logWarn(`credential-store: failed to read ${this.credentialsFile}: ${err instanceof Error ? err.message : String(err)}`);
            throw new CredentialFileCorruptError(this.credentialsFile, err);
        }
        // JSON parse failure — file exists but is corrupt
        try {
            return JSON.parse(content) as CredentialsFile;
        } catch (err) {
            logWarn(`credential-store: ${this.credentialsFile} contains invalid JSON`);
            throw new CredentialFileCorruptError(this.credentialsFile, err);
        }
    }

    private saveCredentials(creds: CredentialsFile): void {
        this.ensureDir();
        fs.writeFileSync(this.credentialsFile, JSON.stringify(creds, null, 2), {
            encoding: 'utf8',
            mode: 0o600,
        });
    }

    async get(key: string): Promise<string | null> {
        const creds = this.loadCredentials();
        const entry = creds[key];

        if (!entry) {
            return null;
        }

        let plaintext: string;
        try {
            plaintext = this.decrypt(entry, key);
        } catch (err) {
            // Decrypt failure — likely wrong key or tampered data; log warning and return null
            const msg = err instanceof Error ? err.message : String(err);
            logWarn(`credential-store: failed to decrypt key "${key}": ${msg.slice(0, 120)}`);
            return null;
        }

        // Opportunistic auto-migration: re-encrypt legacy/v2 entry as v3 (machine key) behind try/catch
        const needsUpgrade = (e: StoredEntry): boolean => (e as V3Entry).v !== 3;
        if (needsUpgrade(entry)) {
            try {
                await this.set(key, plaintext);
            } catch (err) {
                debug('credential-store: auto-migration failed for key', key, String(err));
            }
        }

        return plaintext;
    }

    // Like get(), but throws if the key is missing or decryption fails
    async getOrThrow(key: string): Promise<string> {
        const creds = this.loadCredentials();
        const entry = creds[key];

        if (!entry) {
            throw new Error(`Credential key "${key}" not found. Use the appropriate auth command to set it.`);
        }

        try {
            const plaintext = this.decrypt(entry, key);

            // Opportunistic auto-migration: re-encrypt legacy/v2 entry as v3 (machine key) behind try/catch
            const needsUpgrade = (e: StoredEntry): boolean => (e as V3Entry).v !== 3;
            if (needsUpgrade(entry)) {
                try {
                    await this.set(key, plaintext);
                } catch (err) {
                    debug('credential-store: auto-migration failed for key', key, String(err));
                }
            }

            return plaintext;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logWarn(`credential-store: failed to decrypt key "${key}": ${msg.slice(0, 120)}`);
            throw new Error(`Failed to decrypt credential "${key}": ${msg.slice(0, 120)}`);
        }
    }

    async set(key: string, value: string): Promise<void> {
        const creds = this.loadCredentials();
        creds[key] = this.encrypt(value, key);
        this.saveCredentials(creds);
    }

    async delete(key: string): Promise<void> {
        const creds = this.loadCredentials();
        delete creds[key];
        this.saveCredentials(creds);
    }

    async list(): Promise<string[]> {
        const creds = this.loadCredentials();
        return Object.keys(creds);
    }
}
