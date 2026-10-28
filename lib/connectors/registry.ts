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
  pathTemplate: string
  bodyTemplate?: string
  headers?: Record<string, string>
  inputs: { name: string; type: string; required: boolean; description: string; defaultValue?: string }[]
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
  }
  referenceTemplates: ReferenceTemplate[]
  buildIntegrationConfig: (config: Record<string, any>, credentials: Record<string, any>) => {
    base_url: string
    auth_type: string
    auth_config: Record<string, any>
    headers?: Record<string, string>
  }
}

// ─── Import all definitions ───
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
import { servicenowConnector } from './definitions/servicenow'
import { sftpConnector } from './definitions/sftp'
import { oracleConnector } from './definitions/oracle'
import { onedriveConnector } from './definitions/onedrive'
import { n8nConnector } from './definitions/n8n'
import { sapOdataConnector } from './definitions/sap-odata'
import { groqConnector } from './definitions/groq'
import { mistralConnector } from './definitions/mistral'
import { togetherConnector } from './definitions/together'
import { perplexityConnector } from './definitions/perplexity'
import { ollamaConnector } from './definitions/ollama'
import { azureOpenaiConnector } from './definitions/azure-openai'
import { deepseekConnector } from './definitions/deepseek'
import { firebaseConnector } from './definitions/firebase'
import { workdayConnector } from './definitions/workday'

export const CONNECTOR_CATALOG: ConnectorDefinition[] = [
  slackConnector,
  sendgridConnector,
  openaiConnector,
  claudeConnector,
  googleGeminiConnector,
  groqConnector,
  mistralConnector,
  togetherConnector,
  perplexityConnector,
  deepseekConnector,
  azureOpenaiConnector,
  ollamaConnector,
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
  servicenowConnector,
  sftpConnector,
  oracleConnector,
  onedriveConnector,
  n8nConnector,
  sapOdataConnector,
]

export function getConnectorDefinition(key: string): ConnectorDefinition | undefined {
  return CONNECTOR_CATALOG.find(c => c.key === key)
}

export const CONNECTOR_CATEGORIES: { value: ConnectorCategory; label: string }[] = [
  { value: 'ai', label: 'AI' },
  { value: 'communication', label: 'Communication' },
  { value: 'cloud', label: 'Cloud Storage' },
  { value: 'database', label: 'Databases' },
  { value: 'payments', label: 'Payments' },
  { value: 'productivity', label: 'Productivity' },
]
