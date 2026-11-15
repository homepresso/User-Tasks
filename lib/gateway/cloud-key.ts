/**
 * The cloud's Ed25519 key for gateway answers (lib/gateway/protocol.ts:
 * every answer to a signed gateway request is signed, bound to that
 * request's nonce). Gateways pin the public key at registration.
 *
 *   GATEWAY_SIGNING_KEY       Ed25519 private key: PKCS#8 PEM, or a 32-byte
 *                             seed (base64 / base64url / hex). Optional.
 *   (default)                 a seed derived with HKDF-SHA256 from
 *                             ENCRYPTION_KEY (context label below), so every
 *                             configured server has one without new config.
 *   GATEWAY_SIGNING_KEY_NEXT  the next key (same formats), advertised to
 *                             gateways in signed answers so a later switch to
 *                             it (GATEWAY_SIGNING_KEY = old NEXT) does not
 *                             strand them.
 *
 * Server-only.
 */
import { createPrivateKey, hkdfSync, type KeyObject } from 'node:crypto'
import { encryptionKeyMaterial } from '@/lib/secret-crypto'
import { ed25519FromSeed, keyFingerprint, rawPublicKey } from './protocol'

export const GATEWAY_KEY_INFO = 'usertasks:gateway-signing:v1'

export interface CloudKey {
  id: string
  publicKey: string
  privateKey: KeyObject
}

export class GatewayNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GatewayNotConfiguredError'
  }
}

function parseKey(raw: string, name: string): KeyObject {
  const value = raw.replace(/\\n/g, '\n').trim()
  if (value.includes('-----BEGIN')) {
    const key = createPrivateKey(value)
    if (key.asymmetricKeyType !== 'ed25519') throw new GatewayNotConfiguredError(`${name} must be an Ed25519 private key`)
    return key
  }
  const seed = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (seed.length !== 32) throw new GatewayNotConfiguredError(`${name} must be a PEM key or a 32-byte seed`)
  return ed25519FromSeed(seed)
}

function toCloudKey(privateKey: KeyObject): CloudKey {
  const publicKey = rawPublicKey(privateKey)
  return { id: keyFingerprint(publicKey), publicKey, privateKey }
}

let cached: { material: string; key: CloudKey } | null = null

/** The current signing key (throws GatewayNotConfiguredError when none can be had). */
export function cloudSigningKey(): CloudKey {
  const explicit = process.env.GATEWAY_SIGNING_KEY?.trim()
  const material = explicit ? `explicit:${explicit}` : `derived:${encryptionKeyMaterial() ?? ''}`
  if (cached?.material === material) return cached.key
  let key: CloudKey
  if (explicit) key = toCloudKey(parseKey(explicit, 'GATEWAY_SIGNING_KEY'))
  else {
    const base = encryptionKeyMaterial()
    if (!base) throw new GatewayNotConfiguredError('On-premises gateways need ENCRYPTION_KEY (or GATEWAY_SIGNING_KEY) on the server')
    key = toCloudKey(ed25519FromSeed(Buffer.from(hkdfSync('sha256', Buffer.from(base, 'utf8'), Buffer.alloc(0), GATEWAY_KEY_INFO, 32))))
  }
  cached = { material, key }
  return key
}

/** Public keys to advertise: the current one and GATEWAY_SIGNING_KEY_NEXT when set. */
export function advertisedCloudKeys(): Array<{ id: string; publicKey: string }> {
  const current = cloudSigningKey()
  const out = [{ id: current.id, publicKey: current.publicKey }]
  const next = process.env.GATEWAY_SIGNING_KEY_NEXT?.trim()
  if (next) {
    try {
      const k = toCloudKey(parseKey(next, 'GATEWAY_SIGNING_KEY_NEXT'))
      if (k.id !== current.id) out.push({ id: k.id, publicKey: k.publicKey })
    } catch (error) {
      console.warn(`[gateway] ignoring GATEWAY_SIGNING_KEY_NEXT: ${(error as Error).message}`)
    }
  }
  return out
}

export function gatewaysConfigured(): boolean {
  try { cloudSigningKey(); return true } catch { return false }
}
