/**
 * Catalog of user-selectable sync sections: manifest section key → display
 * label + the table/filter used to list individual items for the picker.
 * Section keys MUST match SECTION_TO_DIR in lib/github-sync/push.ts and the
 * export sections in lib/portability/export.ts.
 */

export interface SyncSectionInfo {
  section: string
  label: string
  table: string
  /** Column holding the display name (default `name`). */
  nameColumn?: string
  /** Table has no member grants: list it with a service-role client (tenant-filtered). */
  serviceRole?: boolean
  /** Extra filter applied when listing items (PostgREST column → value). */
  filter?: { column: string; op: 'eq' | 'in' | 'not_in'; value: any }
}

export const SYNC_SECTION_CATALOG: SyncSectionInfo[] = [
  { section: 'workflows', label: 'Workflows', table: 'workflows' },
  { section: 'data_tables', label: 'Data tables (schema)', table: 'custom_tables' },
  { section: 'decision_tables', label: 'Business rules (decision tables)', table: 'decision_tables' },
  { section: 'integrations', label: 'Integrations', table: 'integrations' },
  { section: 'references', label: 'Integration references', table: 'integration_references' },
  { section: 'objects', label: 'Integration objects', table: 'integration_objects' },
  { section: 'agents', label: 'AI agents', table: 'agents' },
  { section: 'reports', label: 'Reports', table: 'reports' },
  { section: 'retention_policies', label: 'Retention policies', table: 'retention_policies' },
  { section: 'workflow_activities', label: 'Workflow activities', table: 'custom_workflow_activities' },
  { section: 'roles', label: 'Custom roles', table: 'roles', filter: { column: 'is_system', op: 'eq', value: false } },
  { section: 'mcp_servers', label: 'MCP servers', table: 'mcp_servers' },
  { section: 'email_templates', label: 'Email templates', table: 'email_templates' },
  { section: 'connectors', label: 'Connectors (no credentials)', table: 'tenant_connectors', nameColumn: 'display_name', filter: { column: 'connector_key', op: 'not_in', value: ['github_sync'] } },
  { section: 'log_destinations', label: 'Log export destinations (no credentials)', table: 'log_destinations', serviceRole: true },
  { section: 'form_themes', label: 'Form themes', table: 'form_themes' },
  { section: 'forms', label: 'Forms', table: 'forms' },
]

export const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  SYNC_SECTION_CATALOG.map((s) => [s.section, s.label]),
)
