'use server'

import { fromSession, isServiceError } from '@/lib/services/context'
import * as gateways from '@/lib/services/gateways'
import { getWorkspaceEmbedding, setWorkspaceEmbedding } from '@/lib/services/tenant-settings'

/*
 * Settings → On-premises gateways and Settings → Trusted embedding: thin
 * wrappers over lib/services/gateways and lib/services/tenant-settings
 * (shared with /api/v1/gateways, /api/v1/workspace/embedding, MCP and the
 * CLI). Expected failures come back as { ok: false, error } so their
 * messages survive production builds.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    throw error
  }
}

export type GatewayList = Awaited<ReturnType<typeof gateways.listGateways>>
export type GatewayDetail = Awaited<ReturnType<typeof gateways.getGateway>>
export type GatewayRegistration = Awaited<ReturnType<typeof gateways.createGatewayRegistrationToken>>

export async function listGatewaysAction() {
  return run(async () => gateways.listGateways(await fromSession()))
}

export async function getGatewayAction(id: string) {
  return run(async () => gateways.getGateway(await fromSession(), id))
}

export async function createGatewayAction(input: { name: string; description?: string | null }) {
  return run(async () => gateways.createGateway(await fromSession(), input))
}

export async function addGatewayInstanceAction(id: string, label?: string | null) {
  return run(async () => gateways.createGatewayRegistrationToken(await fromSession(), id, { label }))
}

export async function revokeGatewayInstanceAction(id: string, keyId: string) {
  return run(async () => gateways.revokeGatewayInstance(await fromSession(), id, keyId))
}

export async function revokeGatewayAction(id: string) {
  return run(async () => gateways.revokeGateway(await fromSession(), id))
}

export async function getEmbeddingAction() {
  return run(async () => getWorkspaceEmbedding(await fromSession()))
}

export async function setEmbeddingAction(origins: string[]) {
  return run(async () => setWorkspaceEmbedding(await fromSession(), { origins }))
}
