import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Application-layer field encryption for sensitive PII (home/pickup address, and
 * any future gov-ID). AES-256-GCM with a **versioned keyring** so keys can be
 * rotated without a data migration: new writes use the active (first) key; old
 * ciphertext still decrypts as long as its key stays in the ring.
 *
 * Ciphertext format (single column, self-describing):
 *   f1:<keyId>:<iv_b64url>:<tag_b64url>:<ct_b64url>
 * GCM's auth tag makes tampering detectable (decrypt throws). Values written
 * before encryption was enabled (plaintext, no `f1:` prefix) pass through
 * unchanged on read, so the feature is safe to switch on over existing data.
 *
 * In production the keys come from a KMS/vault (docs/etms/09); here they are
 * provided via FIELD_ENCRYPTION_KEYS. With no key configured this is a no-op
 * passthrough so local/dev keeps working.
 */
export interface FieldKey {
  id: string;
  key: Buffer; // 32 bytes (AES-256)
}

const PREFIX = 'f1';
const b64 = (b: Buffer): string => b.toString('base64url');
const ub64 = (s: string): Buffer => Buffer.from(s, 'base64url');

export class FieldCrypto {
  private readonly active?: FieldKey;
  private readonly byId: Map<string, FieldKey>;

  constructor(keys: FieldKey[]) {
    for (const k of keys) {
      if (k.key.length !== 32) throw new Error(`field key ${k.id} must be 32 bytes`);
    }
    this.active = keys[0];
    this.byId = new Map(keys.map((k) => [k.id, k]));
  }

  /** True when an active key is configured (writes will be encrypted). */
  get enabled(): boolean {
    return this.active !== undefined;
  }

  /** Encrypt a value for storage. null → null; no active key → passthrough. */
  encrypt(plain: string | null | undefined): string | null {
    if (plain == null) return null;
    if (!this.active) return plain;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.active.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [PREFIX, this.active.id, b64(iv), b64(c.getAuthTag()), b64(ct)].join(':');
  }

  /** Decrypt a stored value. Legacy plaintext (no prefix) is returned as-is. */
  decrypt(blob: string | null | undefined): string | null {
    if (blob == null) return null;
    if (!blob.startsWith(PREFIX + ':')) return blob; // pre-encryption plaintext
    const parts = blob.split(':');
    if (parts.length !== 5) throw new Error('malformed ciphertext');
    const [, id, ivB, tagB, ctB] = parts as [string, string, string, string, string];
    const k = this.byId.get(id);
    if (!k) throw new Error(`no field key '${id}' in the keyring`);
    const d = createDecipheriv('aes-256-gcm', k.key, ub64(ivB));
    d.setAuthTag(ub64(tagB));
    return Buffer.concat([d.update(ub64(ctB)), d.final()]).toString('utf8');
  }

  /**
   * Build from a spec string: `id:base64key[,id2:base64key2,...]`. The FIRST key
   * is active (used for new writes); the rest are kept for decrypt-only during
   * rotation. Empty/undefined → a disabled passthrough instance.
   */
  static fromEnv(spec?: string): FieldCrypto {
    const keys: FieldKey[] = (spec ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf(':');
        if (i < 1) throw new Error('field key spec must be id:base64key');
        return { id: s.slice(0, i), key: Buffer.from(s.slice(i + 1), 'base64') };
      });
    return new FieldCrypto(keys);
  }
}
