'use server'

import { revalidatePath } from 'next/cache'
import { fromSession } from '@/lib/services/context'
import * as apiKeys from '@/lib/services/api-keys'

/*
 * API key server actions: thin wrappers over lib/services/api-keys (shared
 * with /api/v1/api-keys and MCP), which caps new keys to the signed-in
 * user's permissions, rate-limits creation and audits every change.
 */

function parseIds(raw: FormDataEntryValue | null): string[] {
  try {
    const value = JSON.parse((raw as string) || '[]')
    return Array.isArray(value) ? value.map(String) : []
  } catch {
    return []
  }
}

export async function generateApiKey(formData: FormData) {
  const expiresIn = Number(formData.get('expires_in') || 0)
  const { key } = await apiKeys.createApiKey(await fromSession(), {
    name: String(formData.get('name') ?? ''),
    key_type: (formData.get('key_type') as string) === 'user' ? 'user' : 'tenant',
    user_id: (formData.get('user_id') as string) || null,
    workflow_ids: parseIds(formData.get('workflow_ids_json')),
    table_ids: parseIds(formData.get('table_ids_json')),
    expires_in_days: expiresIn > 0 ? Math.round(expiresIn) : null,
    workflow_source_id: (formData.get('workflow_source_id') as string) || null,
  })
  revalidatePath('/settings/api-keys')
  // Returned once — it can never be retrieved again.
  return key
}

export async function revokeApiKey(keyId: string) {
  await apiKeys.revokeApiKey(await fromSession(), keyId)
  revalidatePath('/settings/api-keys')
}

export async function deleteApiKey(keyId: string) {
  await apiKeys.deleteApiKey(await fromSession(), keyId)
  revalidatePath('/settings/api-keys')
}

export async function bulkDeleteApiKeys(keyIds: string[]) {
  const { deleted } = await apiKeys.deleteApiKeys(await fromSession(), keyIds)
  revalidatePath('/settings/api-keys')
  return { deleted }
}
