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
import { formWizardEndpoints } from './form-wizard'
import { anonymousFormEndpoints } from './anonymous-forms'
import { formControlEndpoints } from './form-controls'
import { githubSyncEndpoints } from './github-sync'
import { governanceEndpoints } from './governance'
import { identityEndpoints } from './identity'
import { orgEndpoints, projectEndpoints } from './org'
import { homeEndpoints } from './home'
import { integrationEndpoints } from './integrations'
import { jobEndpoints } from './jobs'
import { logDestinationEndpoints } from './log-destinations'
import { packageEndpoints } from './packages'
import { reportEndpoints } from './reports'
import { retentionEndpoints } from './retention-policies'
import { taskEndpoints } from './tasks'
import { taskAttachmentEndpoints } from './task-attachments'
import { taskFollowEndpoints } from './task-follows'
import { taskViewerEndpoints } from './task-viewers'
import { taskSubtaskEndpoints } from './task-subtasks'
import { timelineEndpoints } from './timeline'
import { workflowActivityEndpoints } from './workflow-activities'
import { webhookEndpoints } from './webhooks'
import { workflowEndpoints } from './workflows'
import { workspaceThemeEndpoints } from './workspace-theme'
import { workspaceAddressEndpoints } from './workspace-address'
import { taskCompletionEndpoints } from './task-completion'
import { formSignInPageEndpoints } from './form-sign-in-page'
import { documentOcrEndpoints } from './document-ocr'
import { instanceAdminEndpoints } from './instance-admin'
import { extensionEndpoints } from './extensions'
import { licenceEndpoints } from './licence'

/** Every /api/v1 endpoint, in documentation order. */
export const API_ENDPOINTS: readonly EndpointDef[] = [
  ...identityEndpoints,
  ...homeEndpoints,
  ...workflowEndpoints,
  ...taskEndpoints,
  ...taskAttachmentEndpoints,
  ...taskFollowEndpoints,
  ...taskViewerEndpoints,
  ...taskSubtaskEndpoints,
  ...timelineEndpoints,
  ...agentEndpoints,
  ...decisionTableEndpoints,
  ...dataTableEndpoints,
  ...integrationEndpoints,
  ...emailTemplateEndpoints,
  ...formEndpoints,
  ...formWizardEndpoints,
  ...anonymousFormEndpoints,
  ...formControlEndpoints,
  ...fileEndpoints,
  ...workflowActivityEndpoints,
  ...reportEndpoints,
  ...retentionEndpoints,
  ...governanceEndpoints,
  ...orgEndpoints,
  ...projectEndpoints,
  ...workspaceThemeEndpoints,
  ...workspaceAddressEndpoints,
  ...taskCompletionEndpoints,
  ...formSignInPageEndpoints,
  ...documentOcrEndpoints,
  ...apiKeyEndpoints,
  ...webhookEndpoints,
  ...githubSyncEndpoints,
  ...directorySyncEndpoints,
  ...configEndpoints,
  ...packageEndpoints,
  ...extensionEndpoints,
  ...jobEndpoints,
  ...eventEndpoints,
  ...logDestinationEndpoints,
  ...instanceAdminEndpoints,
  ...licenceEndpoints,
]
