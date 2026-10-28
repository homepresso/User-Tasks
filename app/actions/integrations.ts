'use server'

import { createClient, getCachedUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/permissions-server'
import { getCurrentTenantId } from '@/lib/integrations/auth'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { fromSession } from '@/lib/services/context'
import * as integrationsService from '@/lib/services/integrations'

export async function createIntegration(formData: FormData) {
  await requirePermission('integrations.create')

  const name = String(formData.get('name') ?? '').trim()
  const type = String(formData.get('type') ?? 'rest_api')
  const creatableTypes = new Set(['rest_api', 'odata', 'webhook', 'database'])
  if (!name || name.length > 120) throw new Error('Integration name must be between 1 and 120 characters')
  if (!creatableTypes.has(type)) throw new Error('Unsupported integration type')

  let config: any = {}

  if (type === 'database') {
    const dbType = formData.get('db_type') as string
    const host = formData.get('db_host') as string
    const port = formData.get('db_port') as string
    const database = formData.get('db_database') as string
    const username = formData.get('db_username') as string
    const password = formData.get('db_password') as string

    config = {
      base_url: `${dbType}://${host}:${port}/${database}`,
      db_config: {
        db_type: dbType || 'postgres',
        host,
        port: Number(port) || (dbType === 'mssql' ? 1433 : 5432),
        database,
        username,
        password,
        ssl: false,
        trustServerCertificate: dbType === 'mssql',
      },
    }
  } else {
    const baseUrl = String(formData.get('base_url') ?? '').trim().replace(/\/+$/, '')
    const authType = String(formData.get('auth_type') ?? 'none')
    const authValue = String(formData.get('auth_value') ?? '')
    let parsedBaseUrl: URL
    try { parsedBaseUrl = new URL(baseUrl) } catch { throw new Error('Enter a valid absolute base URL') }
    if (!['https:', 'http:'].includes(parsedBaseUrl.protocol)) throw new Error('Base URL must use HTTP or HTTPS')
    if (parsedBaseUrl.username || parsedBaseUrl.password) throw new Error('Do not put credentials in the base URL')
    if (parsedBaseUrl.hash) throw new Error('Base URL cannot contain a fragment')
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsedBaseUrl.hostname)
    if (parsedBaseUrl.protocol !== 'https:' && !isLoopback) throw new Error('Base URL must use HTTPS outside local development')
    if (!['none', 'api_key', 'bearer', 'basic', 'oauth2'].includes(authType)) throw new Error('Unsupported authentication type')

    config = {
      base_url: baseUrl,
      auth_type: authType || 'none',
      auth_config: {},
      headers: {},
    }

    if (authType === 'api_key') {
      const keyName = String(formData.get('api_key_name') ?? 'X-API-Key').trim()
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(keyName)) throw new Error('API key header name is invalid')
      if (!authValue) throw new Error('API key is required')
      config.auth_config = { key_name: keyName, key_value: authValue }
    }
    if (authType === 'bearer') {
      if (!authValue) throw new Error('Bearer token is required')
      config.auth_config = { token: authValue }
    }
    if (authType === 'basic') {
      const username = String(formData.get('basic_username') ?? '').trim()
      const password = String(formData.get('basic_password') ?? '')
      if (!username) throw new Error('Basic authentication username is required')
      config.auth_config = { username, password }
    }
  }

  const iconUrl = formData.get('icon_url') as string
  if (iconUrl) config.icon_url = iconUrl

  const tagsJson = formData.get('tags') as string
  let tags: string[] = []
  if (tagsJson) { try { tags = JSON.parse(tagsJson) } catch { /* ignore */ } }
  // Auto-add service type tag
  const typeTag = type === 'database' ? (formData.get('db_type') as string || 'database') : type
  if (typeTag && !tags.includes(typeTag)) tags.unshift(typeTag)

  // Encryption at rest, audit and GitHub-sync capture happen in the service.
  const ctx = await fromSession()
  const data = await integrationsService.createIntegration(ctx, {
    name,
    type: type as integrationsService.CreatableIntegrationType,
    config,
    tags,
  })
  revalidatePath('/integrations')
  redirect(`/integrations/${data.id}`)
}

export async function createImportedApiIntegration(input: {
  name: string
  baseUrl: string
  authType: 'none' | 'api_key' | 'bearer' | 'basic'
  authConfig: Record<string, string>
  tags?: string[]
  references: Array<{
    name: string
    description?: string
    method: string
    pathTemplate: string
    bodyTemplate?: string
    headers?: Record<string, string>
    tags?: string[]
    inputs?: Array<Record<string, unknown>>
    outputs?: Array<Record<string, unknown>>
    responseSchema?: unknown
  }>
}): Promise<{ integrationId: string; refCount: number }> {
  await requirePermission('integrations.create')
  if (!['none', 'api_key', 'bearer', 'basic'].includes(input.authType)) throw new Error('Unsupported authentication type')
  const ctx = await fromSession()
  const result = await integrationsService.createIntegrationWithReferences(ctx, {
    name: input.name,
    type: 'rest_api',
    config: { base_url: input.baseUrl, auth_type: input.authType, auth_config: input.authConfig ?? {}, headers: {} },
    tags: input.tags ?? [],
    references: input.references ?? [],
  })
  return { integrationId: result.integration.id, refCount: result.references_created }
}

export async function updateIntegration(integrationId: string, updates: { name?: string; config?: any; is_active?: boolean }) {
  await requirePermission('integrations.edit')
  const ctx = await fromSession()
  await integrationsService.updateIntegration(ctx, integrationId, updates)
  revalidatePath('/integrations')
}

export async function deleteIntegration(integrationId: string) {
  await requirePermission('integrations.delete')
  const ctx = await fromSession()
  // Drains the queue inline so the caller's spinner resolves when the delete
  // is DONE. No redirect() — throws NEXT_REDIRECT, which breaks bulk deletes.
  await integrationsService.deleteIntegration(ctx, integrationId, { processInline: true })
  revalidatePath('/integrations')
}

export async function testIntegration(integrationId: string) {
  await requirePermission('integrations.test')
  const ctx = await fromSession()
  const { status, message } = await integrationsService.testIntegration(ctx, integrationId)
  revalidatePath('/integrations')
  return { status, message }
}

/**
 * GitHub-sync notification for integration OBJECT changes. Objects are
 * created/edited client-side (integrations-view), so the view calls this
 * after a successful mutation to queue the object (and, by extension, its
 * generated reference) for the next push.
 */
export async function notifyIntegrationObjectChange(input: {
  objectId: string
  name?: string | null
  action: 'save' | 'delete'
}) {
  // A queued 'delete' removes the object's file from the synced repo — this
  // must carry the same permission as the mutation itself, not view access.
  await requirePermission('integrations.edit')
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const tenantId = await getCurrentTenantId(supabase, user.id)
  if (!tenantId) throw new Error('No tenant')
  if (input.action === 'save') {
    const { data: owned } = await (supabase as any)
      .from('integration_objects')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', input.objectId)
      .maybeSingle()
    if (!owned) return
  }
  void recordAssetChange({
    supabase,
    tenantId,
    assetType: 'object',
    assetId: input.objectId,
    assetName: input.name ?? null,
    action: input.action,
    actorId: user.id,
  })
}
