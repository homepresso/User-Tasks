import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSensitiveFields } from '@/lib/secret-fields'

export async function getCurrentTenantId(supabase: SupabaseClient, userId: string) {
  const { data: profile, error } = await supabase
    .from('users')
    .select('current_tenant_id, tenant_id')
    .eq('id', userId)
    .single()

  if (error) throw new Error(error.message)

  const tenantId = (profile as any)?.current_tenant_id ?? (profile as any)?.tenant_id
  if (!tenantId) throw new Error('No tenant')
  return String(tenantId)
}

export async function getOwnedIntegration(
  supabase: SupabaseClient,
  tenantId: string,
  integrationId: string,
  select = '*',
) {
  const { data, error } = await supabase
    .from('integrations')
    .select(select)
    .eq('id', integrationId)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !data) throw new Error('Integration not found')
  // Central read boundary: credential fields are encrypted at rest — hand
  // callers (test/execute/db paths) the decrypted shape they always consumed.
  const row = data as any
  if (row.config) row.config = decryptSensitiveFields(row.config)
  return data
}

export async function getOwnedReference(
  supabase: SupabaseClient,
  tenantId: string,
  referenceId: string,
  select = 'id, tenant_id, integration_id',
) {
  const { data, error } = await supabase
    .from('integration_references')
    .select(select)
    .eq('id', referenceId)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !data) throw new Error('Reference not found')
  return data
}
