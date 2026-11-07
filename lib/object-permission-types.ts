/**
 * Objects that can carry explicit grants (object_permissions.object_type),
 * how each is labelled and which grant columns mean something for it. Shared
 * by the governance overview, the ObjectPermissions panel, the
 * object-permissions service and the REST / MCP schemas, so every surface
 * describes a grant the same way.
 *
 * Grant columns: can_view, can_edit, can_delete, can_execute. `execute` names
 * can_execute for the type (forms: "Submit" — the grant lists the form in the
 * person's Forms menu and lets them submit it; null = not used). Forms only
 * use View and Submit: editing and deleting a form is governed by the
 * forms.edit / forms.delete role permissions.
 */

export const OBJECT_PERMISSION_TYPES = ['workflow', 'data_table', 'agent', 'integration', 'api_key', 'report', 'form'] as const
export type ObjectPermissionType = (typeof OBJECT_PERMISSION_TYPES)[number]

export interface ObjectPermissionTypeMeta {
  label: string
  plural: string
  /** Table holding the objects (existence checks, names). */
  table: string
  /** App page of one object. */
  href: (id: string) => string
  /** Label of can_execute, or null when the type does not use it. */
  execute: string | null
  /** Whether can_edit / can_delete apply. */
  editDelete: boolean
}

export const OBJECT_PERMISSION_META: Record<ObjectPermissionType, ObjectPermissionTypeMeta> = {
  workflow: { label: 'Workflow', plural: 'Workflows', table: 'workflows', href: (id) => `/automations/${id}`, execute: 'Execute', editDelete: true },
  data_table: { label: 'Data Table', plural: 'Data Tables', table: 'custom_tables', href: (id) => `/data/${id}`, execute: null, editDelete: true },
  agent: { label: 'Agent', plural: 'Agents', table: 'agents', href: (id) => `/agents/${id}`, execute: 'Execute', editDelete: true },
  integration: { label: 'Integration', plural: 'Integrations', table: 'integrations', href: (id) => `/integrations/${id}`, execute: 'Execute', editDelete: true },
  api_key: { label: 'API Key', plural: 'API Keys', table: 'api_keys', href: () => '/settings/api-keys', execute: null, editDelete: true },
  report: { label: 'Report', plural: 'Reports', table: 'reports', href: (id) => `/reports/${id}`, execute: null, editDelete: true },
  form: { label: 'Form', plural: 'Forms', table: 'forms', href: (id) => `/automations/forms?details=${id}`, execute: 'Submit', editDelete: false },
}

export function isObjectPermissionType(value: unknown): value is ObjectPermissionType {
  return typeof value === 'string' && (OBJECT_PERMISSION_TYPES as readonly string[]).includes(value)
}

/** The grant columns that apply to a type, in display order. */
export function grantColumns(type: ObjectPermissionType): Array<'can_view' | 'can_edit' | 'can_delete' | 'can_execute'> {
  const meta = OBJECT_PERMISSION_META[type]
  return [
    'can_view',
    ...(meta.editDelete ? ['can_edit', 'can_delete'] as const : []),
    ...(meta.execute ? ['can_execute'] as const : []),
  ]
}

/** "View, Submit" — the granted columns of a grant, with the type's labels. */
export function describeGrant(type: ObjectPermissionType, grant: { can_view?: boolean; can_edit?: boolean; can_delete?: boolean; can_execute?: boolean }): string {
  const labels: Record<string, string> = { can_view: 'View', can_edit: 'Edit', can_delete: 'Delete', can_execute: OBJECT_PERMISSION_META[type].execute ?? 'Execute' }
  const on = grantColumns(type).filter((col) => grant[col]).map((col) => labels[col])
  return on.length ? on.join(', ') : 'no access'
}
