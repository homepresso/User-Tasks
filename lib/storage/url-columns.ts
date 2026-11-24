/**
 * Columns that can hold this app's own storage URLs (logos, theme assets,
 * attachments): the storage move rewrites them (Infrastructure add-on) and
 * the "local to Supabase Cloud" guide's SQL lists them. Data only.
 */

export interface StorageColumn {
  table: string
  column: string
  /** Primary key column(s) used to update the row. */
  key: string
  /**
   * 'asset': every own-storage string becomes a ref (branding, theme, icons).
   * 'data': file objects get `ref` + a target URL; other own URLs are
   * re-pointed at the target, except under ASSET_URL_KEYS (refs).
   */
  mode: 'asset' | 'data'
}

/** Every column known to persist storage URLs. */
export const STORAGE_URL_COLUMNS: StorageColumn[] = [
  { table: 'tenants', column: 'branding', key: 'id', mode: 'asset' },
  { table: 'workspace_themes', column: 'theme', key: 'tenant_id', mode: 'asset' },
  { table: 'integrations', column: 'config', key: 'id', mode: 'asset' },
  { table: 'integration_references', column: 'request_config', key: 'id', mode: 'asset' },
  { table: 'custom_table_rows', column: 'data', key: 'id', mode: 'data' },
  { table: 'workflows', column: 'nodes', key: 'id', mode: 'data' },
  { table: 'workflow_versions', column: 'nodes', key: 'id', mode: 'data' },
  { table: 'workflow_runs', column: 'node_results', key: 'id', mode: 'data' },
  { table: 'workflow_runs', column: 'pause_variables', key: 'id', mode: 'data' },
  { table: 'workflow_runs', column: 'execution_trace', key: 'id', mode: 'data' },
  { table: 'workflow_queue', column: 'result', key: 'id', mode: 'data' },
  { table: 'workflow_queue', column: 'trigger_data', key: 'id', mode: 'data' },
  { table: 'tasks', column: 'metadata', key: 'id', mode: 'data' },
  { table: 'agent_runs', column: 'outputs', key: 'id', mode: 'data' },
  { table: 'agent_runs', column: 'context', key: 'id', mode: 'data' },
]
