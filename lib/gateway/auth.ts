/**
 * Authentication of gateway → cloud requests (lib/gateway/protocol.ts):
 * the instance key named in the request must be active, belong to an active
 * gateway, and have signed this exact request within the time window with a
 * nonce never seen before. Failures are answered with a plain 401 / 403 (no
 * detail beyond the reason class) and recorded as gateway events when the
 * key is known.
 *
 * Answers are signed with the cloud key, bound to the request nonce.
 *
 * Server-only.
 */
import { getServiceDb } from '@/lib/providers/db'
import { cloudSigningKey } from './cloud-key'
import {
  canonicalResponse,
  readSignatureHeaders,
  RESPONSE_SIGNATURE_HEADERS,
  sha256Hex,
  signBytes,
  SIGNATURE_WINDOW_MS,
  verifyRequestSignature,
} from './protocol'
import { isMissingTableError } from './queue'
import { recordGatewayEvent } from './events'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role client, untyped tables */

export interface GatewayCaller {
  keyId: string
  gatewayId: string
  tenantId: string
  nonce: string
  key: { id: string; label: string | null; instance_name: string | null; version: string | null; status: string; registered_at: string | null }
  gateway: { id: string; name: string; status: string; tenant_id: string }
}

export class GatewayAuthError extends Error {
  constructor(message: string, readonly status = 401, readonly code = 'gateway_unauthorized') {
    super(message)
    this.name = 'GatewayAuthError'
  }
}

/**
 * Verify a signed request. `pathWithQuery` is what the gateway signed
 * (pathname + search of the request URL).
 */
export async function authenticateGateway(input: {
  method: string
  pathWithQuery: string
  body: Buffer
  get: (name: string) => string | null
  now?: number
}): Promise<GatewayCaller> {
  const parts = readSignatureHeaders(input.get)
  if (!parts) throw new GatewayAuthError('Missing or malformed gateway signature')
  const db = getServiceDb() as any
  const { data: key, error } = await db.from('gateway_keys')
    .select('id, gateway_id, tenant_id, public_key, status, label, instance_name, version, registered_at')
    .eq('id', parts.keyId).maybeSingle()
  if (error) {
    if (isMissingTableError(error)) throw new GatewayAuthError('On-premises gateways are not set up on this server', 503, 'gateway_not_installed')
    throw new GatewayAuthError(`Gateway lookup failed: ${error.message}`, 500, 'gateway_store_error')
  }
  if (!key || !key.public_key) throw new GatewayAuthError('Unknown gateway key')
  const { data: gateway, error: gwError } = await db.from('gateways').select('id, name, status, tenant_id').eq('id', key.gateway_id).maybeSingle()
  if (gwError) throw new GatewayAuthError(`Gateway lookup failed: ${gwError.message}`, 500, 'gateway_store_error')
  const verdict = verifyRequestSignature({ parts, publicKey: key.public_key, method: input.method, path: input.pathWithQuery, body: input.body, now: input.now })
  if (!verdict.ok) {
    await recordGatewayEvent({ tenantId: key.tenant_id, gatewayId: key.gateway_id, keyId: key.id, type: 'signature_rejected', severity: 'warn', message: `Signed request refused (${verdict.problem})`, detail: { path: input.pathWithQuery.split('?')[0].slice(0, 200) } })
    throw new GatewayAuthError('Invalid gateway signature')
  }
  if (key.status !== 'active' || !gateway || gateway.status !== 'active') {
    await recordGatewayEvent({ tenantId: key.tenant_id, gatewayId: key.gateway_id, keyId: key.id, type: 'revoked_key_used', severity: 'warn', message: `A ${key.status === 'active' ? 'revoked gateway' : `${key.status} key`} tried to connect` })
    throw new GatewayAuthError(key.status === 'rotated' ? 'This gateway key was rotated; use the new key' : 'This gateway or key has been revoked', 403, 'gateway_revoked')
  }
  // Replay: each nonce once per key (kept a little longer than the window).
  const { error: nonceError } = await db.from('gateway_nonces').insert({ key_id: key.id, nonce: parts.nonce, expires_at: new Date(Date.now() + 2 * SIGNATURE_WINDOW_MS + 60_000).toISOString() })
  if (nonceError) {
    if (nonceError.code === '23505' || /duplicate key/i.test(nonceError.message ?? '')) {
      await recordGatewayEvent({ tenantId: key.tenant_id, gatewayId: key.gateway_id, keyId: key.id, type: 'replay_rejected', severity: 'warn', message: 'A replayed gateway request was refused' })
      throw new GatewayAuthError('Replayed request')
    }
    throw new GatewayAuthError(`Gateway nonce check failed: ${nonceError.message}`, 500, 'gateway_store_error')
  }
  return {
    keyId: key.id,
    gatewayId: key.gateway_id,
    tenantId: key.tenant_id,
    nonce: parts.nonce,
    key: { id: key.id, label: key.label ?? null, instance_name: key.instance_name ?? null, version: key.version ?? null, status: key.status, registered_at: key.registered_at ?? null },
    gateway: { id: gateway.id, name: gateway.name, status: gateway.status, tenant_id: gateway.tenant_id },
  }
}

/** A JSON answer signed for the gateway (bound to its request nonce). */
export function signedJson(body: unknown, status: number, requestNonce: string): Response {
  const text = JSON.stringify(body)
  const key = cloudSigningKey()
  const signature = signBytes(key.privateKey, canonicalResponse({ status, requestNonce, bodySha256: sha256Hex(text) }))
  return new Response(text, {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      [RESPONSE_SIGNATURE_HEADERS.keyId]: key.id,
      [RESPONSE_SIGNATURE_HEADERS.signature]: signature,
    },
  })
}
