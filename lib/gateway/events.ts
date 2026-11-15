/**
 * Gateway security / lifecycle events (public.gateway_events): registrations,
 * rotations, revocations, refused signatures, replays, allowlist refusals
 * reported by gateways. Never throws: an event that cannot be written is
 * logged.
 *
 * Server-only.
 */
import { getServiceDb } from '@/lib/providers/db'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role client */

export interface GatewayEventInput {
  tenantId: string | null
  gatewayId: string | null
  keyId?: string | null
  type: string
  severity?: 'info' | 'warn' | 'error'
  message: string
  detail?: Record<string, unknown>
}

export async function recordGatewayEvent(input: GatewayEventInput): Promise<void> {
  try {
    const { error } = await (getServiceDb() as any).from('gateway_events').insert({
      tenant_id: input.tenantId,
      gateway_id: input.gatewayId,
      key_id: input.keyId ?? null,
      type: input.type.slice(0, 60),
      severity: input.severity ?? 'info',
      message: input.message.slice(0, 1000),
      detail: input.detail ?? null,
    })
    if (error) throw new Error(error.message)
  } catch (error) {
    console.warn(`[gateway] could not record event ${input.type}: ${(error as Error).message}`)
  }
}
