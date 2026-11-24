/**
 * Every object type that carries tags, in display order. Pure (no server
 * imports): shared by the services (lib/services/object-tags.ts,
 * lib/services/tags.ts), the API / MCP schemas and the UI.
 */
export const TAG_OBJECT_TYPE_KEYS = [
  'tasks', 'workflows', 'forms', 'integrations', 'references', 'agents', 'activities',
  'data_tables', 'reports', 'business_rules', 'email_templates', 'form_controls', 'apps', 'packages',
] as const

export type TagObjectTypeKey = (typeof TAG_OBJECT_TYPE_KEYS)[number]

/** Plural labels (Settings → Tags, API descriptions). */
export const TAG_OBJECT_TYPE_LABELS: Record<TagObjectTypeKey, string> = {
  tasks: 'Tasks',
  workflows: 'Workflows',
  forms: 'Forms',
  integrations: 'Integrations',
  references: 'References',
  agents: 'Agents',
  activities: 'Workflow activities',
  data_tables: 'Data tables',
  reports: 'Reports',
  business_rules: 'Business rules',
  email_templates: 'Email templates',
  form_controls: 'Form controls',
  apps: 'Apps',
  packages: 'Packages',
}

/** The permission that lets someone change an object's tags (its edit permission; the object's service checks again per object). */
export const TAG_EDIT_PERMISSIONS: Record<TagObjectTypeKey, string> = {
  tasks: 'tasks.complete',
  workflows: 'workflows.edit',
  forms: 'forms.edit',
  integrations: 'integrations.edit',
  references: 'integrations.manage_references',
  agents: 'agents.edit',
  activities: 'extensibility.edit',
  data_tables: 'data.edit_schema',
  reports: 'reports.edit_own',
  business_rules: 'workflows.edit',
  email_templates: 'workflows.edit',
  form_controls: 'extensibility.edit',
  apps: 'apps.manage',
  packages: 'packages.manage',
}
