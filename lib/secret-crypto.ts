import crypto from "crypto"

/**
 * Envelope encryption for secrets at rest (connector passwords, API tokens,
 * service-account JSON). AES-256-GCM with a key from the ENCRYPTION_KEY env var.
 *
 * Rollout is non-breaking and opt-in:
 *  - If ENCRYPTION_KEY is unset, encryptSecret() is a no-op passthrough (values
 *    stay plaintext) so existing behaviour is unchanged until a key is configured.
 *  - decryptSecret() detects the "enc:v1:" prefix; anything without it (legacy
 *    plaintext) is returned as-is. This lets encrypted and legacy values coexist
 *    during migration/backfill.
 *
 * ENCRYPTION_KEY must be 32 bytes, provided as base64 (44 chars) or hex (64 chars).
 * Generate one with: `openssl rand -base64 32`.
 *
 * The key can also come from the secret store (lib/providers/secrets/bootstrap.ts):
 * at startup it is looked up there when ENCRYPTION_KEY is unset, or when
 * ENCRYPTION_KEY is a `secret://` reference, and installed with
 * installEncryptionKey(). A reference that was never resolved fails closed.
 *
 * KMS envelope encryption (lib/providers/kms): once data keys exist
 * (`usertasks-admin kms rotate`, or `switch kms`), startup unwraps them with
 * the KMS and installs them here (installDataKeys). New ciphertext then uses
 * the newest active data key — `enc:v2:<key id>:<iv>:<tag>:<data>`, with the
 * `enc:v2:<key id>` prefix as additional authenticated data — and decryption
 * picks the key by id. `enc:v1:` ciphertext keeps decrypting with
 * ENCRYPTION_KEY for as long as it is set, so nothing has to be re-encrypted
 * up front (`usertasks-admin kms rewrap` does it, resumably). Without data
 * keys (the default) everything works exactly as before. Key bytes never
 * leave this module except to the env KMS provider (bootstrapKeyBytes), and
 * no error message contains key material.
 */

const PREFIX = "enc:v1:"
const V2_PREFIX = "enc:v2:"
const CIPHERTEXT = /^enc:v\d+:/

interface DataKey {
  id: number
  key: Buffer
  /** Epoch ms from which the key encrypts new values. */
  activatesAt: number
}

/** Unwrapped data keys by id (installDataKeys). */
const dataKeys = new Map<number, DataKey>()

let cachedKey: Buffer | null | undefined
/** Raw key from the secret store (installEncryptionKey), used when set. */
let installedRaw: string | undefined

function parseKey(raw: string): Buffer {
  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex")
  } else {
    key = Buffer.from(raw, "base64")
  }
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (base64 or hex)")
  }
  return key
}

function getKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey
  const raw = installedRaw ?? process.env.ENCRYPTION_KEY
  if (!raw) {
    cachedKey = null
    return null
  }
  if (raw.trim().startsWith("secret://")) {
    // Never fall back to plaintext: the reference must be resolved at startup.
    throw new Error("ENCRYPTION_KEY is a secret reference that was not resolved at startup (see the secrets provider logs)")
  }
  cachedKey = parseKey(raw)
  return cachedKey
}

/** Installs the key read from the secret store (validated; replaces any cached key). */
export function installEncryptionKey(raw: string): void {
  parseKey(raw)
  installedRaw = raw
  cachedKey = undefined
}

/** Whether a key is available (env or installed), without throwing. */
export function hasEncryptionKey(): boolean {
  try {
    return getKey() !== null
  } catch {
    return false
  }
}

/**
 * The bootstrap key's bytes, for the env KMS provider only (it wraps data
 * keys with ENCRYPTION_KEY). Null when none is configured.
 */
export function bootstrapKeyBytes(): Buffer | null {
  const key = getKey()
  return key ? Buffer.from(key) : null
}

// ── data keys (KMS envelope encryption) ─────────────────────────────────────

/** Install unwrapped data keys (adds to / replaces by id; never logs them). */
export function installDataKeys(keys: Array<{ id: number; key: Buffer; activatesAt: number }>): void {
  for (const k of keys) {
    if (!Number.isInteger(k.id) || k.id <= 0) throw new Error("Data key ids are positive integers")
    if (k.key.length !== 32) throw new Error(`Data key ${k.id} must be 32 bytes`)
    dataKeys.set(k.id, { id: k.id, key: Buffer.from(k.key), activatesAt: k.activatesAt })
  }
}

/** Forget every data key (tests; the CLI after a command). */
export function clearDataKeys(): void {
  for (const k of dataKeys.values()) k.key.fill(0)
  dataKeys.clear()
}

export function hasDataKey(id: number): boolean {
  return dataKeys.has(id)
}

export function dataKeyIds(): number[] {
  return [...dataKeys.keys()].sort((a, b) => a - b)
}

/** The data key new ciphertext uses: the highest id already active. Null without data keys. */
export function activeDataKeyId(now = Date.now()): number | null {
  let best: DataKey | null = null
  for (const k of dataKeys.values()) if (k.activatesAt <= now && (!best || k.id > best.id)) best = k
  return best?.id ?? null
}

/** The key version of a ciphertext: 1 for enc:v1, the data key id for enc:v2; null for anything else. */
export function ciphertextKeyId(value: string): { version: 1 } | { version: 2; keyId: number } | null {
  if (typeof value !== "string") return null
  if (value.startsWith(PREFIX)) return { version: 1 }
  const m = /^enc:v2:(\d+):/.exec(value)
  return m ? { version: 2, keyId: Number(m[1]) } : null
}

export function isEncrypted(value: string): boolean {
  return typeof value === "string" && CIPHERTEXT.test(value)
}

function seal(key: Buffer, plaintext: string, aad?: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"))
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`
}

function open(key: Buffer, body: string, aad?: string): string {
  const [ivB64, tagB64, dataB64] = body.split(":")
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted secret")
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"))
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}

export interface EncryptOptions {
  /**
   * Always enc:v1 with ENCRYPTION_KEY, even when data keys are loaded: for
   * the settings needed to reach the KMS itself (lib/config/instance-settings).
   */
  bootstrap?: boolean
  /** Encrypt with this data key instead of the active one (`kms rewrap`). */
  keyId?: number
}

/**
 * Encrypt a secret: with the active data key when one is loaded, else with
 * ENCRYPTION_KEY (enc:v1); unchanged when neither is configured.
 */
export function encryptSecret(plaintext: string, options: EncryptOptions = {}): string {
  if (plaintext == null || plaintext === "") return plaintext
  if (isEncrypted(plaintext)) return plaintext // already encrypted
  const keyId = options.bootstrap ? null : options.keyId ?? activeDataKeyId()
  if (keyId !== null) {
    const dataKey = dataKeys.get(keyId)
    if (!dataKey) throw new Error(`Cannot encrypt secret: data key ${keyId} is not loaded`)
    const prefix = `${V2_PREFIX}${keyId}:`
    return `${prefix}${seal(dataKey.key, plaintext, prefix.slice(0, -1))}`
  }
  const key = getKey()
  if (!key) return plaintext // no-op passthrough until a key is set
  return `${PREFIX}${seal(key, plaintext)}`
}

/** Decrypt a secret. Legacy (unprefixed) plaintext is returned unchanged. */
export function decryptSecret(value: string): string {
  if (value == null || !isEncrypted(value)) return value
  const kind = ciphertextKeyId(value)
  if (kind?.version === 2) {
    const dataKey = dataKeys.get(kind.keyId)
    if (!dataKey) {
      throw new Error(`Cannot decrypt secret: data key ${kind.keyId} is not loaded (check the KMS provider configuration and the startup log)`)
    }
    const prefix = `${V2_PREFIX}${kind.keyId}:`
    return open(dataKey.key, value.slice(prefix.length), prefix.slice(0, -1))
  }
  if (kind?.version !== 1) throw new Error("Unsupported encrypted secret version")
  const key = getKey()
  if (!key) {
    throw new Error("Cannot decrypt secret: ENCRYPTION_KEY is not configured")
  }
  return open(key, value.slice(PREFIX.length))
}
