/**
 * Connector Registry — defines available pre-built connectors.
 * Each connector maps to a standard integration + references when enabled.
 */

export interface ConnectorField {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'number' | 'textarea'
  placeholder?: string
  required?: boolean
  visibleWhen?: {
    field: string
    equals?: string | number | boolean
    notEquals?: string | number | boolean
    in?: Array<string | number | boolean>
  }
  requiredWhen?: {
    field: string
    equals?: string | number | boolean
    notEquals?: string | number | boolean
    in?: Array<string | number | boolean>
  }
  validation?: {
    type:
      | 'url'
      | 'email'
      | 'uuid'
      | 'json'
      | 'json_object'
      | 'hostname'
      | 'mongo_connection'
      | 'azure_storage_account'
      | 'azure_container'
      | 'azure_resource_name'
      | 'aws_bucket'
    message?: string
  }
  setupHint?: string
  exampleText?: string
  options?: { value: string; label: string }[]
  helpText?: string
  defaultValue?: string
}

export interface ReferenceTemplate {
  key: string
  name: string
  description: string
  method: string
  /**
   * Absolute https base URL for this template only, when the provider serves
   * it from another host than the connector's base URL (Box uploads at
   * upload.box.com, Dropbox content.dropboxapi.com …). Same auth applies.
   */
  baseUrl?: string
  pathTemplate: string
  bodyTemplate?: string
  headers?: Record<string, string>
  inputs: { name: string; type: string; required: boolean; description: string; defaultValue?: string; location?: 'query' | 'path' | 'body' | 'header' }[]
  outputs: { name: string; type: string }[]
}

export type ConnectorCategory = 'cloud' | 'communication' | 'ai' | 'payments' | 'productivity' | 'database'

export interface ConnectorDefinition {
  key: string
  name: string
  description: string
  category: ConnectorCategory
  icon: string              // lucide icon name
  color: string             // brand hex color
  docsUrl?: string
  recommendedPermissions?: {
    title?: string
    items: string[]
    note?: string
  }
  fields: ConnectorField[]
  credentialFields: ConnectorField[]
  /**
   * Optional OAuth 2.0 client preset. When present, the generic OAuth2 auth
   * form can prefill authorize_url / token_url / scopes so the tenant only has
   * to supply client_id + client_secret. Purely additive metadata — it does
   * not change buildIntegrationConfig or enableConnector behavior.
   */
  oauth?: {
    authorizeUrl: string
    tokenUrl: string
    defaultScopes: string[]
    extraAuthorizeParams?: Record<string, string>
    /** Refresh-token endpoint when it differs from tokenUrl (Adobe Acrobat Sign). */
    refreshUrl?: string
    /** How the client authenticates at the token endpoint (default: client_id / client_secret in the form body). */
    clientAuth?: 'basic' | 'body'
  }
  referenceTemplates: ReferenceTemplate[]
  /**
   * Migrate-on-read for integration configs stored by older versions of this
   * definition (applied by the reference executor to the decrypted config
   * before every call; must be idempotent and must not drop credentials).
   */
  upgradeIntegrationConfig?: (stored: Record<string, any>) => Record<string, any>
  buildIntegrationConfig: (config: Record<string, any>, credentials: Record<string, any>) => {
    base_url: string
    auth_type: string
    auth_config: Record<string, any>
    headers?: Record<string, string>
  }
}

// ─── Import all definitions ───
import { getLoadedExtensions } from '@/lib/extensions/registry'
import { slackConnector } from './definitions/slack'
import { sendgridConnector } from './definitions/sendgrid'
import { openaiConnector } from './definitions/openai'
import { claudeConnector } from './definitions/claude'
import { stripeConnector } from './definitions/stripe'
import { mercuryConnector } from './definitions/mercury'
import { twilioConnector } from './definitions/twilio'
import { awsS3Connector } from './definitions/aws-s3'
import { googleDriveConnector } from './definitions/google-drive'
import { msTeamsConnector } from './definitions/ms-teams'
import { salesforceConnector } from './definitions/salesforce'
import { sharepointConnector } from './definitions/sharepoint'
import { azureBlobConnector } from './definitions/azure-blob'
import { msDataverseConnector } from './definitions/ms-dataverse'
import { postgresConnector } from './definitions/postgres'
import { mssqlConnector } from './definitions/mssql'
import { snowflakeConnector } from './definitions/snowflake'
import { mysqlConnector } from './definitions/mysql'
import { mongodbConnector } from './definitions/mongodb'
import { ukgProConnector } from './definitions/ukg-pro'
import { boxConnector } from './definitions/box'
import { jiraConnector } from './definitions/jira'
import { dropboxConnector } from './definitions/dropbox'
import { googleDocsConnector } from './definitions/google-docs'
import { googleGeminiConnector } from './definitions/google-gemini'
import { googleTasksConnector } from './definitions/google-tasks'
import { exchangeOnlineConnector } from './definitions/exchange-online'
import { gmailConnector } from './definitions/gmail'
import { docusignConnector } from './definitions/docusign'
import { adobeSignConnector } from './definitions/adobe-sign'
import { dropboxSignConnector } from './definitions/dropbox-sign'
import { pandadocConnector } from './definitions/pandadoc'
import { signnowConnector } from './definitions/signnow'
import { boldsignConnector } from './definitions/boldsign'
import { servicenowConnector } from './definitions/servicenow'
import { sftpConnector } from './definitions/sftp'
import { oracleConnector } from './definitions/oracle'
import { onedriveConnector } from './definitions/onedrive'
import { n8nConnector } from './definitions/n8n'
import { sapOdataConnector } from './definitions/sap-odata'
import { groqConnector } from './definitions/groq'
import { xaiConnector } from './definitions/xai'
import { mistralConnector } from './definitions/mistral'
import { togetherConnector } from './definitions/together'
import { perplexityConnector } from './definitions/perplexity'
import { ollamaConnector } from './definitions/ollama'
import { azureOpenaiConnector } from './definitions/azure-openai'
import { deepseekConnector } from './definitions/deepseek'
import { firebaseConnector } from './definitions/firebase'
import { workdayConnector } from './definitions/workday'
import { azureSpeechConnector } from './definitions/azure-speech'
import { azureAiVisionConnector } from './definitions/azure-ai-vision'
import { azureDocumentIntelligenceConnector } from './definitions/azure-document-intelligence'
import { awsMediaConnector } from './definitions/aws-media'
import { deepgramConnector } from './definitions/deepgram'
import { assemblyaiConnector } from './definitions/assemblyai'
import { elevenlabsConnector } from './definitions/elevenlabs'
import { stabilityAiConnector } from './definitions/stability-ai'

export const CONNECTOR_CATALOG: ConnectorDefinition[] = [
  slackConnector,
  sendgridConnector,
  openaiConnector,
  claudeConnector,
  googleGeminiConnector,
  groqConnector,
  xaiConnector,
  mistralConnector,
  togetherConnector,
  perplexityConnector,
  deepseekConnector,
  azureOpenaiConnector,
  ollamaConnector,
  azureSpeechConnector,
  azureAiVisionConnector,
  azureDocumentIntelligenceConnector,
  awsMediaConnector,
  deepgramConnector,
  assemblyaiConnector,
  elevenlabsConnector,
  stabilityAiConnector,
  stripeConnector,
  mercuryConnector,
  twilioConnector,
  awsS3Connector,
  azureBlobConnector,
  googleDriveConnector,
  sharepointConnector,
  msTeamsConnector,
  msDataverseConnector,
  salesforceConnector,
  postgresConnector,
  mssqlConnector,
  mysqlConnector,
  snowflakeConnector,
  mongodbConnector,
  firebaseConnector,
  ukgProConnector,
  workdayConnector,
  boxConnector,
  jiraConnector,
  dropboxConnector,
  googleDocsConnector,
  googleTasksConnector,
  exchangeOnlineConnector,
  gmailConnector,
  docusignConnector,
  adobeSignConnector,
  dropboxSignConnector,
  pandadocConnector,
  signnowConnector,
  boldsignConnector,
  servicenowConnector,
  sftpConnector,
  oracleConnector,
  onedriveConnector,
  n8nConnector,
  sapOdataConnector,
]

/** A built-in connector, or one an extension in the build defines (`ext.<id>.<key>`). */
export function getConnectorDefinition(key: string): ConnectorDefinition | undefined {
  const core = CONNECTOR_CATALOG.find(c => c.key === key)
  if (core || !key.startsWith('ext.')) return core
  for (const ext of getLoadedExtensions()) {
    const found = ext.connectors.find((c) => c.key === key)
    if (found) return found
  }
  return undefined
}

/**
 * The built-in catalog plus the connectors of these extensions (the ones a
 * workspace may use; all extensions in the build when omitted).
 */
export function connectorCatalogWith(extensionIds?: Iterable<string>): ConnectorDefinition[] {
  const loaded = getLoadedExtensions()
  if (!loaded.length) return CONNECTOR_CATALOG
  const ids = extensionIds ? new Set(extensionIds) : null
  const extra = loaded.filter((e) => !ids || ids.has(e.manifest.id)).flatMap((e) => e.connectors)
  return extra.length ? [...CONNECTOR_CATALOG, ...extra] : CONNECTOR_CATALOG
}

export const CONNECTOR_CATEGORIES: { value: ConnectorCategory; label: string }[] = [
  { value: 'ai', label: 'AI' },
  { value: 'communication', label: 'Communication' },
  { value: 'cloud', label: 'Cloud Storage' },
  { value: 'database', label: 'Databases' },
  { value: 'payments', label: 'Payments' },
  { value: 'productivity', label: 'Productivity' },
]
