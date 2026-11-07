import { CONNECTOR_CATALOG, CONNECTOR_CATEGORIES, type ConnectorDefinition } from '@/lib/connectors/registry'
import { NODE_CATALOG } from '@/lib/workflow-schema'

/**
 * Connector catalogue as the public site shows it (/connectors and the
 * landing page), generated from the connector registry so names and counts
 * never drift from what the product ships. Groups are for reading; a
 * connector not listed in a group falls into one named after its registry
 * category, so a new connector always appears somewhere.
 */

export type ConnectorGroup = { id: string; title: string; note: string; connectors: Array<Pick<ConnectorDefinition, 'key' | 'name' | 'description'> & { references: number }> }

const GROUPS: Array<{ id: string; title: string; note: string; keys: string[] }> = [
  { id: 'business', title: 'CRM, ERP, HR and IT service management', note: 'Read and update the systems of record your processes run through.', keys: ['salesforce', 'sap_odata', 'workday', 'ukg_pro', 'servicenow', 'ms_dataverse', 'jira'] },
  { id: 'databases', title: 'Databases', note: 'Query, insert, update and delete with typed parameters — no SQL pasted into workflows.', keys: ['postgres', 'mssql', 'mysql', 'oracle', 'snowflake', 'mongodb', 'firebase'] },
  { id: 'storage', title: 'Files and storage', note: 'Upload, download and move the documents a process produces.', keys: ['aws_s3', 'azure_blob', 'google_drive', 'onedrive_business', 'sharepoint', 'box', 'dropbox', 'sftp'] },
  { id: 'messaging', title: 'Email and messaging', note: 'Notify people where they already work.', keys: ['gmail', 'exchange_online', 'sendgrid', 'slack', 'ms_teams', 'twilio'] },
  { id: 'esign', title: 'E-signature', note: 'Send documents or templates for signature, wait for the signature and keep the signed PDF — the same actions for every provider.', keys: ['docusign', 'adobe_sign', 'dropbox_sign', 'pandadoc', 'signnow', 'boldsign'] },
  { id: 'productivity', title: 'Documents and automation', note: 'Shared documents, task lists and other automation tools.', keys: ['google_docs', 'google_tasks', 'n8n'] },
  { id: 'payments', title: 'Payments and banking', note: 'Charge, pay out and reconcile.', keys: ['stripe', 'mercury'] },
]

function entry(connector: ConnectorDefinition) {
  return { key: connector.key, name: connector.name, description: connector.description, references: connector.referenceTemplates.length }
}

/** Non-AI connectors in reading groups (AI providers are listed separately). */
export function connectorGroups(): ConnectorGroup[] {
  const byKey = new Map(CONNECTOR_CATALOG.map((connector) => [connector.key, connector]))
  const placed = new Set<string>()
  const groups: ConnectorGroup[] = GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    note: group.note,
    connectors: group.keys.flatMap((key) => {
      const connector = byKey.get(key)
      if (!connector || connector.category === 'ai') return []
      placed.add(key)
      return [entry(connector)]
    }),
  })).filter((group) => group.connectors.length > 0)
  for (const category of CONNECTOR_CATEGORIES) {
    if (category.value === 'ai') continue
    const rest = CONNECTOR_CATALOG.filter((connector) => connector.category === category.value && !placed.has(connector.key))
    if (rest.length > 0) groups.push({ id: `more-${category.value}`, title: `More ${category.label.toLowerCase()}`, note: '', connectors: rest.map(entry) })
  }
  return groups
}

/** AI model providers with a ready-made connector. */
export function aiConnectors() {
  return CONNECTOR_CATALOG.filter((connector) => connector.category === 'ai').map(entry).sort((a, b) => a.name.localeCompare(b.name))
}

export const CONNECTOR_COUNT = CONNECTOR_CATALOG.length
export const CONNECTOR_REFERENCE_COUNT = CONNECTOR_CATALOG.reduce((sum, connector) => sum + connector.referenceTemplates.length, 0)
/** Node types a designer can place (canvas tools such as sections excluded). */
export const WORKFLOW_NODE_COUNT = NODE_CATALOG.filter((node) => node.category !== 'section').length

/** Short display name for an AI provider chip ("Claude (Anthropic)" → "Claude (Anthropic)", "Ollama (Local)" → "Ollama"). */
export function shortProviderName(name: string): string {
  return name.replace(/\s*\(Local\)$/, '')
}
