/**
 * Friendly labels for the object audit log (object_audit_log): the object
 * types and actions people can filter by on /activity and in Settings →
 * Governance → Audit Log. Client-safe (no server imports).
 */

/** Filterable object types, in menu order. */
export const AUDIT_OBJECT_TYPE_LABELS: Record<string, string> = {
  workflow: 'Workflow',
  form: 'Form',
  form_theme: 'Form theme',
  form_control: 'Form control',
  data_table: 'Data table',
  report: 'Report',
  agent: 'Agent',
  integration: 'Integration',
  decision_table: 'Business rule',
  email_template: 'Email template',
  retention_policy: 'Retention policy',
  team: 'Team',
  role: 'Role',
  member: 'Member',
  org_unit: 'Org unit',
  project: 'Project',
  org: 'Organization',
  api_key: 'API key',
  webhook: 'Webhook',
  licence: 'Licence',
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  publish: 'Published',
  unpublish: 'Unpublished',
  toggle: 'Toggled',
  execute: 'Executed',
  grant: 'Access granted',
  revoke: 'Access removed',
  duplicate: 'Duplicated',
  share: 'Shared',
  retention: 'Retention policy',
  purge: 'Purged',
  legal_hold: 'Legal hold placed',
  legal_hold_release: 'Legal hold released',
  attachment_add: 'Attachment added',
  attachment_delete: 'Attachment deleted',
  attachment_download: 'Attachment downloaded',
}

/** Friendly label of an object type (falls back to the raw value, underscores as spaces). */
export function auditObjectTypeLabel(type: string): string {
  return AUDIT_OBJECT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.replace(/_/g, ' ')
}
