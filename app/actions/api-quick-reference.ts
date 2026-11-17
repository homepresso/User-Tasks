'use server'

import { revalidatePath } from 'next/cache'
import { fromSession } from '@/lib/services/context'
import { ServiceError } from '@/lib/services/context'
import * as integrationsService from '@/lib/services/integrations'
import * as referencesService from '@/lib/services/references'
import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { parseApiAddress } from '@/lib/data-sources/api-rows'

/* eslint-disable @typescript-eslint/no-explicit-any -- integration rows */

export interface QuickReferenceInput {
  /** The API address to read, e.g. https://api.example.com/invoices?status=open. */
  address: string
  /** The reference's name (default: from the address). */
  name?: string
  /** Use this connection (its base URL must start the address); default: one that matches, else a new one. */
  connection_id?: string
  /** A new connection's sign-in. Ignored when an existing connection is used (edit it in its settings). */
  auth?: { type: 'none' | 'api_key' | 'bearer'; key_name?: string; value?: string }
}

/**
 * "Create a reference" from the Data table picker, without leaving the
 * designer: a read-only GET operation for a pasted address. An existing REST
 * connection whose base URL starts the address is reused; otherwise a new
 * connection is made for the address's origin. Query parameters become the
 * reference's inputs (their values are the defaults), so the designer can
 * map them to form fields. The services check permissions
 * (integrations.create for a new connection, integrations.manage_references),
 * egress rules and encrypt the key.
 */
export async function quickCreateApiReference(input: QuickReferenceInput): Promise<ActionResult<{ reference_id: string; integration_id: string; name: string; created_connection: boolean }>> {
  return runAction('quickCreateApiReference', 'Could not create the API reference.', async () => {
    const ctx = await fromSession()
    const { data: rows } = await (ctx.supabase as any).from('integrations').select('id, type, config').eq('tenant_id', ctx.tenantId).in('type', ['rest_api', 'odata'])
    const connections = ((rows ?? []) as any[]).map((r) => ({ id: String(r.id), base_url: typeof r.config?.base_url === 'string' ? r.config.base_url : null }))
    const pool = input.connection_id ? connections.filter((c) => c.id === input.connection_id) : connections
    if (input.connection_id && !pool.length) throw ServiceError.validation('That connection was not found')
    const parsed = parseApiAddress(String(input.address ?? '').slice(0, 2000), pool)
    if (!parsed) throw ServiceError.validation('Enter a full web address that starts with https:// (without a user name or password in it)')
    if (input.connection_id && parsed.connectionId !== input.connection_id) throw ServiceError.validation('The address does not start with that connection’s base URL')
    const name = (String(input.name ?? '').trim() || parsed.name).slice(0, 160)
    const reference: referencesService.ReferenceInput = {
      name,
      description: 'Created from the Data table designer',
      method: 'GET',
      path_template: parsed.path,
      query_params: Object.fromEntries(parsed.params.map((p) => [p.name, `{{${p.name}}}`])),
      inputs: parsed.params.map((p) => ({ name: p.name, type: 'string', required: false, default_value: p.value, location: 'query', source: 'variable' })),
    }
    let integrationId = parsed.connectionId
    let createdConnection = false
    let referenceId: string
    if (integrationId) {
      const created: any = await referencesService.createReference(ctx, integrationId, reference)
      referenceId = String(created.id ?? created.reference?.id)
    } else {
      const auth = input.auth ?? { type: 'none' }
      const authType = auth.type === 'api_key' || auth.type === 'bearer' ? auth.type : 'none'
      if (authType !== 'none' && !String(auth.value ?? '').trim()) throw ServiceError.validation(authType === 'api_key' ? 'Enter the API key' : 'Enter the token')
      const keyName = String(auth.key_name ?? '').trim() || 'X-API-Key'
      if (authType === 'api_key' && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(keyName)) throw ServiceError.validation('The key’s header name is not valid')
      const config = {
        base_url: parsed.baseUrl,
        auth_type: authType,
        auth_config: authType === 'api_key' ? { key_name: keyName, key_value: String(auth.value) } : authType === 'bearer' ? { token: String(auth.value) } : {},
        headers: {},
      }
      const host = new URL(parsed.baseUrl).hostname
      const created: any = await integrationsService.createIntegrationWithReferences(ctx, { name: host.slice(0, 120), type: 'rest_api', config, tags: ['rest_api'], references: [reference] })
      integrationId = String(created.integration?.id ?? created.id)
      referenceId = String(created.references?.[0]?.id ?? '')
      createdConnection = true
      if (!referenceId) throw new Error('The reference was not created')
    }
    revalidatePath('/integrations')
    return { reference_id: referenceId, integration_id: integrationId, name, created_connection: createdConnection }
  })
}
