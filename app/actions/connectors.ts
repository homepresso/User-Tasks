'use server'

import { revalidatePath } from 'next/cache'
import { findRecentDuplicate } from '@/lib/recent-duplicate'
import { getConnectorDefinition } from '@/lib/connectors/registry'
import { requirePermission } from '@/lib/permissions-server'
import { fromSession } from '@/lib/services/context'
import * as connectorsService from '@/lib/services/connectors'

// Validation, encryption at rest, backing-integration upkeep, reference
// generation, probes and audit live in lib/services/connectors.

export async function enableConnector(
  connectorKey: string,
  config: Record<string, unknown>,
  credentials: Record<string, unknown>,
  displayName?: string,
  references?: { mode: 'all' | 'none' | 'selected'; keys?: string[] },
) {
  await requirePermission('integrations.create')
  const ctx = await fromSession()
  // A repeated Enable (double click, retry) reuses the connector this user just
  // set up instead of adding a second one with its own integration.
  const label = displayName?.trim() || getConnectorDefinition(connectorKey)?.name
  if (ctx.actorId && label) {
    const recent = await findRecentDuplicate<{ id: string; integration_id: string }>(ctx.supabase, 'tenant_connectors',
      { tenant_id: ctx.tenantId, created_by: ctx.actorId, connector_key: connectorKey, display_name: label }, { select: 'id, integration_id' })
    if (recent) return { id: recent.id, integration_id: recent.integration_id }
  }
  const result = await connectorsService.createConnector(ctx, {
    connector_key: connectorKey,
    display_name: displayName,
    config,
    credentials,
    reference_mode: references?.mode,
    reference_template_keys: references?.keys,
  })
  revalidatePath('/integrations')
  return { id: result.connector.id, integration_id: result.integration.id }
}

export async function updateConnector(
  connectorId: string,
  config?: Record<string, unknown>,
  credentials?: Record<string, unknown>,
) {
  await requirePermission('integrations.edit')
  const ctx = await fromSession()
  // The settings form submits the full field set, so replace rather than merge.
  await connectorsService.updateConnector(ctx, connectorId, { config, credentials }, { mode: 'replace' })
  revalidatePath('/integrations')
}

export async function disableConnector(connectorId: string) {
  await requirePermission('integrations.edit')
  const ctx = await fromSession()
  await connectorsService.setConnectorEnabled(ctx, connectorId, false)
  revalidatePath('/integrations')
}

export async function reenableConnector(connectorId: string) {
  await requirePermission('integrations.edit')
  const ctx = await fromSession()
  await connectorsService.setConnectorEnabled(ctx, connectorId, true)
  revalidatePath('/integrations')
}

export async function deleteConnector(connectorId: string) {
  await requirePermission('integrations.delete')
  const ctx = await fromSession()
  await connectorsService.deleteConnector(ctx, connectorId)
  revalidatePath('/integrations')
}

export async function regenerateReferences(connectorId: string) {
  await requirePermission('integrations.manage_references')
  const ctx = await fromSession()
  const { count } = await connectorsService.regenerateConnectorReferences(ctx, connectorId)
  revalidatePath('/integrations')
  return { count }
}

export async function testConnectorConnection(
  connectorKey: string,
  config: Record<string, unknown>,
  credentials: Record<string, unknown>,
  connectorId?: string,
) {
  await requirePermission('integrations.test')
  const ctx = await fromSession()
  const result = await connectorsService.testConnector(ctx, {
    connector_key: connectorKey,
    config,
    credentials,
    connector_id: connectorId,
  })
  if (connectorId) revalidatePath('/integrations')
  return result
}
