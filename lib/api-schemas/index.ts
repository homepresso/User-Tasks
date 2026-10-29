import type { EndpointDef } from './registry'
import { agentEndpoints } from './agents'
import { apiKeyEndpoints } from './api-keys'
import { configEndpoints } from './config'
import { dataTableEndpoints } from './data-tables'
import { decisionTableEndpoints } from './decision-tables'
import { directorySyncEndpoints } from './directory-sync'
import { emailTemplateEndpoints } from './email-templates'
import { eventEndpoints } from './events'
import { fileEndpoints } from './files'
import { formEndpoints } from './forms'
import { githubSyncEndpoints } from './github-sync'
import { governanceEndpoints } from './governance'
import { identityEndpoints } from './identity'
import { integrationEndpoints } from './integrations'
import { jobEndpoints } from './jobs'
import { logDestinationEndpoints } from './log-destinations'
import { packageEndpoints } from './packages'
import { reportEndpoints } from './reports'
import { retentionEndpoints } from './retention-policies'
import { taskEndpoints } from './tasks'
import { workflowActivityEndpoints } from './workflow-activities'
import { webhookEndpoints } from './webhooks'
import { workflowEndpoints } from './workflows'
import { workspaceThemeEndpoints } from './workspace-theme'

/** Every /api/v1 endpoint, in documentation order. */
export const API_ENDPOINTS: readonly EndpointDef[] = [
  ...identityEndpoints,
  ...workflowEndpoints,
  ...taskEndpoints,
  ...agentEndpoints,
  ...decisionTableEndpoints,
  ...dataTableEndpoints,
  ...integrationEndpoints,
  ...emailTemplateEndpoints,
  ...formEndpoints,
  ...fileEndpoints,
  ...workflowActivityEndpoints,
  ...reportEndpoints,
  ...retentionEndpoints,
  ...governanceEndpoints,
  ...workspaceThemeEndpoints,
  ...apiKeyEndpoints,
  ...webhookEndpoints,
  ...githubSyncEndpoints,
  ...directorySyncEndpoints,
  ...configEndpoints,
  ...packageEndpoints,
  ...jobEndpoints,
  ...eventEndpoints,
  ...logDestinationEndpoints,
]
