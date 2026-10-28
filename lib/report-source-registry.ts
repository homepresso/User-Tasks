import type { SupabaseClient } from '@supabase/supabase-js'
import {
  REPORT_SOURCES,
  customTableToSource,
  getReferenceReportSourceId,
  isReferenceReportSourceKey,
  referenceToSource,
  type ReportSource,
} from '@/lib/report-sources'

const STATIC_SOURCE_KEYS = new Set(REPORT_SOURCES.map((source) => source.key))
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function loadCustomTableSource(supabase: SupabaseClient, tenantId: string, sourceKey: string) {
  let candidateTableId: string | null = null
  if (sourceKey.startsWith('custom_table_')) {
    candidateTableId = sourceKey.replace('custom_table_', '')
  } else if (UUID_PATTERN.test(sourceKey)) {
    candidateTableId = sourceKey
  }
  if (!candidateTableId) return undefined

  const { data } = await (supabase as any)
    .from('custom_tables')
    .select('id, name, columns, tenant_id')
    .eq('id', candidateTableId)
    .eq('tenant_id', tenantId)
    .single()

  return data ? customTableToSource(data) : undefined
}

async function loadReferenceSource(supabase: SupabaseClient, tenantId: string, sourceKey: string) {
  const referenceId = getReferenceReportSourceId(sourceKey)
  if (!referenceId) return undefined

  const { data } = await (supabase as any)
    .from('integration_references')
    .select('id, name, description, inputs, outputs, integration:integrations(id, name)')
    .eq('id', referenceId)
    .eq('tenant_id', tenantId)
    .single()

  return data ? referenceToSource(data) : undefined
}

export async function listTenantReportSources(supabase: SupabaseClient, tenantId: string) {
  const [customTablesResult, referenceResult] = await Promise.all([
    (supabase as any)
      .from('custom_tables')
      .select('id, name, columns')
      .eq('tenant_id', tenantId)
      .order('name'),
    (supabase as any)
      .from('integration_references')
      .select('id, name, description, inputs, outputs, integration:integrations(id, name)')
      .eq('tenant_id', tenantId)
      .order('name'),
  ])

  if (customTablesResult.error) throw customTablesResult.error
  if (referenceResult.error) throw referenceResult.error

  const dynamicTableSources = (customTablesResult.data ?? []).map((table: any) => customTableToSource(table))
  const referenceSources = (referenceResult.data ?? []).map((reference: any) => referenceToSource(reference))

  return [...REPORT_SOURCES, ...dynamicTableSources, ...referenceSources]
}

export async function resolveTenantReportSource(
  supabase: SupabaseClient,
  tenantId: string,
  sourceKey: string,
): Promise<ReportSource | undefined> {
  if (STATIC_SOURCE_KEYS.has(sourceKey)) {
    return REPORT_SOURCES.find((source) => source.key === sourceKey)
  }

  if (isReferenceReportSourceKey(sourceKey)) {
    return loadReferenceSource(supabase, tenantId, sourceKey)
  }

  return loadCustomTableSource(supabase, tenantId, sourceKey)
}
