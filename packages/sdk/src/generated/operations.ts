// Generated from openapi.json by scripts/generate.ts. Do not edit.

export interface OperationInfo {
  operationId: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Path template relative to /api/v1, e.g. `/workflows/{id}`. */
  path: string
  /** false = the route returns a bare JSON body (no `{ success, data }` envelope). */
  envelope: boolean
  /** Key within the response data holding the item array (list endpoints). */
  listKey?: string
  /** Has an async variant (`Prefer: respond-async` → 202 with a background job). */
  async?: boolean
  /** Returns a file, not JSON. */
  download?: boolean
}

export const OPERATIONS: readonly OperationInfo[] = [
  {
    "operationId": "getMe",
    "method": "GET",
    "path": "/me",
    "envelope": true
  },
  {
    "operationId": "getOpenApiSpec",
    "method": "GET",
    "path": "/openapi.json",
    "envelope": false
  },
  {
    "operationId": "listWorkflows",
    "method": "GET",
    "path": "/workflows",
    "envelope": true,
    "listKey": "workflows"
  },
  {
    "operationId": "createWorkflow",
    "method": "POST",
    "path": "/workflows",
    "envelope": true
  },
  {
    "operationId": "getWorkflow",
    "method": "GET",
    "path": "/workflows/{id}",
    "envelope": true
  },
  {
    "operationId": "updateWorkflowDefinition",
    "method": "PATCH",
    "path": "/workflows/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteWorkflow",
    "method": "DELETE",
    "path": "/workflows/{id}",
    "envelope": true
  },
  {
    "operationId": "getWorkflowDefinition",
    "method": "GET",
    "path": "/workflows/{id}/definition",
    "envelope": true
  },
  {
    "operationId": "publishWorkflow",
    "method": "POST",
    "path": "/workflows/{id}/publish",
    "envelope": true
  },
  {
    "operationId": "startWorkflow",
    "method": "POST",
    "path": "/workflows/start",
    "envelope": true
  },
  {
    "operationId": "getWorkflowInputs",
    "method": "GET",
    "path": "/workflows/{id}/inputs",
    "envelope": true,
    "listKey": "fields"
  },
  {
    "operationId": "completeWorkflowEvent",
    "method": "POST",
    "path": "/workflows/events/{id}/complete",
    "envelope": true
  },
  {
    "operationId": "listWorkflowRuns",
    "method": "GET",
    "path": "/workflows/runs",
    "envelope": true,
    "listKey": "runs"
  },
  {
    "operationId": "getWorkflowRun",
    "method": "GET",
    "path": "/workflows/runs/{id}",
    "envelope": true
  },
  {
    "operationId": "actOnWorkflowRun",
    "method": "POST",
    "path": "/workflows/runs/{id}/action",
    "envelope": true
  },
  {
    "operationId": "listWorkflowQueue",
    "method": "GET",
    "path": "/workflows/queue",
    "envelope": true,
    "listKey": "jobs"
  },
  {
    "operationId": "actOnWorkflowJob",
    "method": "POST",
    "path": "/workflows/queue/{id}/action",
    "envelope": true
  },
  {
    "operationId": "activateWorkflow",
    "method": "POST",
    "path": "/workflows/{id}/activate",
    "envelope": true
  },
  {
    "operationId": "deactivateWorkflow",
    "method": "POST",
    "path": "/workflows/{id}/deactivate",
    "envelope": true
  },
  {
    "operationId": "listWorkflowVersions",
    "method": "GET",
    "path": "/workflows/{id}/versions",
    "envelope": true,
    "listKey": "versions"
  },
  {
    "operationId": "getWorkflowVersion",
    "method": "GET",
    "path": "/workflows/{id}/versions/{versionId}",
    "envelope": true
  },
  {
    "operationId": "listWorkflowInstances",
    "method": "GET",
    "path": "/workflows/{id}/instances",
    "envelope": true,
    "listKey": "instances"
  },
  {
    "operationId": "migrateWorkflowInstances",
    "method": "POST",
    "path": "/workflows/{id}/instances/migrate",
    "envelope": true,
    "async": true
  },
  {
    "operationId": "listTasks",
    "method": "GET",
    "path": "/tasks",
    "envelope": true,
    "listKey": "tasks"
  },
  {
    "operationId": "listAssignedTasks",
    "method": "GET",
    "path": "/tasks/assigned",
    "envelope": true,
    "listKey": "tasks"
  },
  {
    "operationId": "getTask",
    "method": "GET",
    "path": "/tasks/{id}",
    "envelope": true
  },
  {
    "operationId": "updateTask",
    "method": "PATCH",
    "path": "/tasks/{id}",
    "envelope": true
  },
  {
    "operationId": "actOnTask",
    "method": "POST",
    "path": "/tasks/{id}/action",
    "envelope": true
  },
  {
    "operationId": "lookupTaskField",
    "method": "POST",
    "path": "/tasks/{id}/lookup",
    "envelope": true
  },
  {
    "operationId": "ingestTask",
    "method": "POST",
    "path": "/tasks/ingest",
    "envelope": false
  },
  {
    "operationId": "listAgents",
    "method": "GET",
    "path": "/agents",
    "envelope": true,
    "listKey": "agents"
  },
  {
    "operationId": "createAgent",
    "method": "POST",
    "path": "/agents",
    "envelope": true
  },
  {
    "operationId": "getAgent",
    "method": "GET",
    "path": "/agents/{id}",
    "envelope": true
  },
  {
    "operationId": "updateAgent",
    "method": "PUT",
    "path": "/agents/{id}",
    "envelope": true
  },
  {
    "operationId": "patchAgent",
    "method": "PATCH",
    "path": "/agents/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteAgent",
    "method": "DELETE",
    "path": "/agents/{id}",
    "envelope": true
  },
  {
    "operationId": "executeAgent",
    "method": "POST",
    "path": "/agents/{id}/execute",
    "envelope": true
  },
  {
    "operationId": "listAgentQueue",
    "method": "GET",
    "path": "/agents/queue",
    "envelope": true,
    "listKey": "jobs"
  },
  {
    "operationId": "listDecisionTables",
    "method": "GET",
    "path": "/decision-tables",
    "envelope": true,
    "listKey": "decision_tables"
  },
  {
    "operationId": "createDecisionTable",
    "method": "POST",
    "path": "/decision-tables",
    "envelope": true
  },
  {
    "operationId": "getDecisionTable",
    "method": "GET",
    "path": "/decision-tables/{id}",
    "envelope": true
  },
  {
    "operationId": "updateDecisionTable",
    "method": "PUT",
    "path": "/decision-tables/{id}",
    "envelope": true
  },
  {
    "operationId": "patchDecisionTable",
    "method": "PATCH",
    "path": "/decision-tables/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteDecisionTable",
    "method": "DELETE",
    "path": "/decision-tables/{id}",
    "envelope": true
  },
  {
    "operationId": "testDecisionTable",
    "method": "POST",
    "path": "/decision-tables/{id}/test",
    "envelope": true
  },
  {
    "operationId": "exportDecisionTable",
    "method": "GET",
    "path": "/decision-tables/{id}/export",
    "envelope": true
  },
  {
    "operationId": "importDecisionTable",
    "method": "POST",
    "path": "/decision-tables/import",
    "envelope": true
  },
  {
    "operationId": "listDataTables",
    "method": "GET",
    "path": "/data-tables",
    "envelope": true,
    "listKey": "data_tables"
  },
  {
    "operationId": "createDataTable",
    "method": "POST",
    "path": "/data-tables",
    "envelope": true
  },
  {
    "operationId": "getDataTable",
    "method": "GET",
    "path": "/data-tables/{id}",
    "envelope": true
  },
  {
    "operationId": "updateDataTable",
    "method": "PATCH",
    "path": "/data-tables/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteDataTable",
    "method": "DELETE",
    "path": "/data-tables/{id}",
    "envelope": true
  },
  {
    "operationId": "listDataRows",
    "method": "GET",
    "path": "/data-tables/{id}/rows",
    "envelope": true,
    "listKey": "rows"
  },
  {
    "operationId": "upsertDataRows",
    "method": "POST",
    "path": "/data-tables/{id}/rows",
    "envelope": true
  },
  {
    "operationId": "getDataRow",
    "method": "GET",
    "path": "/data-tables/{id}/rows/{rowId}",
    "envelope": true
  },
  {
    "operationId": "updateDataRow",
    "method": "PATCH",
    "path": "/data-tables/{id}/rows/{rowId}",
    "envelope": true
  },
  {
    "operationId": "deleteDataRow",
    "method": "DELETE",
    "path": "/data-tables/{id}/rows/{rowId}",
    "envelope": true
  },
  {
    "operationId": "bulkDeleteDataRows",
    "method": "POST",
    "path": "/data-tables/{id}/rows/bulk-delete",
    "envelope": true,
    "async": true
  },
  {
    "operationId": "listIntegrations",
    "method": "GET",
    "path": "/integrations",
    "envelope": true,
    "listKey": "integrations"
  },
  {
    "operationId": "createIntegration",
    "method": "POST",
    "path": "/integrations",
    "envelope": true
  },
  {
    "operationId": "importOpenApiIntegration",
    "method": "POST",
    "path": "/integrations/import-openapi",
    "envelope": true
  },
  {
    "operationId": "getIntegration",
    "method": "GET",
    "path": "/integrations/{id}",
    "envelope": true
  },
  {
    "operationId": "updateIntegration",
    "method": "PATCH",
    "path": "/integrations/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteIntegration",
    "method": "DELETE",
    "path": "/integrations/{id}",
    "envelope": true
  },
  {
    "operationId": "testIntegration",
    "method": "POST",
    "path": "/integrations/{id}/test",
    "envelope": true
  },
  {
    "operationId": "listIntegrationReferences",
    "method": "GET",
    "path": "/integrations/{id}/references",
    "envelope": true,
    "listKey": "references"
  },
  {
    "operationId": "createReference",
    "method": "POST",
    "path": "/integrations/{id}/references",
    "envelope": true
  },
  {
    "operationId": "getReference",
    "method": "GET",
    "path": "/references/{id}",
    "envelope": true
  },
  {
    "operationId": "updateReference",
    "method": "PATCH",
    "path": "/references/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteReference",
    "method": "DELETE",
    "path": "/references/{id}",
    "envelope": true
  },
  {
    "operationId": "bulkDeleteReferences",
    "method": "POST",
    "path": "/references/bulk-delete",
    "envelope": true,
    "async": true
  },
  {
    "operationId": "executeReference",
    "method": "POST",
    "path": "/references/{id}/execute",
    "envelope": true
  },
  {
    "operationId": "listObjects",
    "method": "GET",
    "path": "/objects",
    "envelope": true,
    "listKey": "objects"
  },
  {
    "operationId": "createObject",
    "method": "POST",
    "path": "/objects",
    "envelope": true
  },
  {
    "operationId": "getObject",
    "method": "GET",
    "path": "/objects/{id}",
    "envelope": true
  },
  {
    "operationId": "updateObject",
    "method": "PATCH",
    "path": "/objects/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteObject",
    "method": "DELETE",
    "path": "/objects/{id}",
    "envelope": true
  },
  {
    "operationId": "getConnectorCatalog",
    "method": "GET",
    "path": "/connectors/catalog",
    "envelope": true
  },
  {
    "operationId": "listConnectors",
    "method": "GET",
    "path": "/connectors",
    "envelope": true,
    "listKey": "connectors"
  },
  {
    "operationId": "createConnector",
    "method": "POST",
    "path": "/connectors",
    "envelope": true
  },
  {
    "operationId": "getConnector",
    "method": "GET",
    "path": "/connectors/{id}",
    "envelope": true
  },
  {
    "operationId": "updateConnector",
    "method": "PATCH",
    "path": "/connectors/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteConnector",
    "method": "DELETE",
    "path": "/connectors/{id}",
    "envelope": true
  },
  {
    "operationId": "testConnector",
    "method": "POST",
    "path": "/connectors/{id}/test",
    "envelope": true
  },
  {
    "operationId": "enableConnector",
    "method": "POST",
    "path": "/connectors/{id}/enable",
    "envelope": true
  },
  {
    "operationId": "disableConnector",
    "method": "POST",
    "path": "/connectors/{id}/disable",
    "envelope": true
  },
  {
    "operationId": "regenerateConnectorReferences",
    "method": "POST",
    "path": "/connectors/{id}/regenerate-references",
    "envelope": true
  },
  {
    "operationId": "listEmailTemplates",
    "method": "GET",
    "path": "/email-templates",
    "envelope": true,
    "listKey": "email_templates"
  },
  {
    "operationId": "createEmailTemplate",
    "method": "POST",
    "path": "/email-templates",
    "envelope": true
  },
  {
    "operationId": "getEmailTemplate",
    "method": "GET",
    "path": "/email-templates/{id}",
    "envelope": true
  },
  {
    "operationId": "updateEmailTemplate",
    "method": "PATCH",
    "path": "/email-templates/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteEmailTemplate",
    "method": "DELETE",
    "path": "/email-templates/{id}",
    "envelope": true
  },
  {
    "operationId": "previewEmailTemplate",
    "method": "POST",
    "path": "/email-templates/{id}/preview",
    "envelope": true
  },
  {
    "operationId": "listForms",
    "method": "GET",
    "path": "/forms",
    "envelope": true,
    "listKey": "forms"
  },
  {
    "operationId": "createForm",
    "method": "POST",
    "path": "/forms",
    "envelope": true
  },
  {
    "operationId": "getForm",
    "method": "GET",
    "path": "/forms/{id}",
    "envelope": true
  },
  {
    "operationId": "updateForm",
    "method": "PATCH",
    "path": "/forms/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteForm",
    "method": "DELETE",
    "path": "/forms/{id}",
    "envelope": true
  },
  {
    "operationId": "duplicateForm",
    "method": "POST",
    "path": "/forms/{id}/duplicate",
    "envelope": true
  },
  {
    "operationId": "listFormVersions",
    "method": "GET",
    "path": "/forms/{id}/versions",
    "envelope": true,
    "listKey": "versions"
  },
  {
    "operationId": "getFormVersion",
    "method": "GET",
    "path": "/forms/{id}/versions/{version}",
    "envelope": true
  },
  {
    "operationId": "listFormUsages",
    "method": "GET",
    "path": "/forms/{id}/usages",
    "envelope": true,
    "listKey": "usages"
  },
  {
    "operationId": "listFormThemes",
    "method": "GET",
    "path": "/form-themes",
    "envelope": true,
    "listKey": "form_themes"
  },
  {
    "operationId": "createFormTheme",
    "method": "POST",
    "path": "/form-themes",
    "envelope": true
  },
  {
    "operationId": "getFormTheme",
    "method": "GET",
    "path": "/form-themes/{id}",
    "envelope": true
  },
  {
    "operationId": "updateFormTheme",
    "method": "PATCH",
    "path": "/form-themes/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteFormTheme",
    "method": "DELETE",
    "path": "/form-themes/{id}",
    "envelope": true
  },
  {
    "operationId": "submitForm",
    "method": "POST",
    "path": "/forms/{id}/submit",
    "envelope": true
  },
  {
    "operationId": "listFormSubmissions",
    "method": "GET",
    "path": "/forms/{id}/submissions",
    "envelope": true,
    "listKey": "submissions"
  },
  {
    "operationId": "getFormSubmission",
    "method": "GET",
    "path": "/form-submissions/{id}",
    "envelope": true
  },
  {
    "operationId": "lookupFormField",
    "method": "POST",
    "path": "/forms/{id}/lookup",
    "envelope": true
  },
  {
    "operationId": "listWorkflowActivities",
    "method": "GET",
    "path": "/workflow-activities",
    "envelope": true,
    "listKey": "workflow_activities"
  },
  {
    "operationId": "createWorkflowActivity",
    "method": "POST",
    "path": "/workflow-activities",
    "envelope": true
  },
  {
    "operationId": "importWorkflowActivity",
    "method": "POST",
    "path": "/workflow-activities/import",
    "envelope": true
  },
  {
    "operationId": "getWorkflowActivity",
    "method": "GET",
    "path": "/workflow-activities/{id}",
    "envelope": true
  },
  {
    "operationId": "updateWorkflowActivity",
    "method": "PATCH",
    "path": "/workflow-activities/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteWorkflowActivity",
    "method": "DELETE",
    "path": "/workflow-activities/{id}",
    "envelope": true
  },
  {
    "operationId": "exportWorkflowActivity",
    "method": "GET",
    "path": "/workflow-activities/{id}/export",
    "envelope": true
  },
  {
    "operationId": "listReports",
    "method": "GET",
    "path": "/reports",
    "envelope": true,
    "listKey": "reports"
  },
  {
    "operationId": "createReport",
    "method": "POST",
    "path": "/reports",
    "envelope": true
  },
  {
    "operationId": "getReport",
    "method": "GET",
    "path": "/reports/{id}",
    "envelope": true
  },
  {
    "operationId": "updateReport",
    "method": "PUT",
    "path": "/reports/{id}",
    "envelope": true
  },
  {
    "operationId": "patchReport",
    "method": "PATCH",
    "path": "/reports/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteReport",
    "method": "DELETE",
    "path": "/reports/{id}",
    "envelope": true
  },
  {
    "operationId": "previewReport",
    "method": "POST",
    "path": "/reports/preview",
    "envelope": false,
    "listKey": "data"
  },
  {
    "operationId": "listReportSources",
    "method": "GET",
    "path": "/reports/sources",
    "envelope": false,
    "listKey": "sources"
  },
  {
    "operationId": "exportReport",
    "method": "GET",
    "path": "/reports/{id}/export",
    "envelope": true
  },
  {
    "operationId": "importReport",
    "method": "POST",
    "path": "/reports/import",
    "envelope": true
  },
  {
    "operationId": "listRetentionPolicies",
    "method": "GET",
    "path": "/retention-policies",
    "envelope": true,
    "listKey": "retention_policies"
  },
  {
    "operationId": "createRetentionPolicy",
    "method": "POST",
    "path": "/retention-policies",
    "envelope": true
  },
  {
    "operationId": "getRetentionPolicy",
    "method": "GET",
    "path": "/retention-policies/{id}",
    "envelope": true
  },
  {
    "operationId": "updateRetentionPolicy",
    "method": "PUT",
    "path": "/retention-policies/{id}",
    "envelope": true
  },
  {
    "operationId": "patchRetentionPolicy",
    "method": "PATCH",
    "path": "/retention-policies/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteRetentionPolicy",
    "method": "DELETE",
    "path": "/retention-policies/{id}",
    "envelope": true
  },
  {
    "operationId": "getRetentionPolicyAssets",
    "method": "GET",
    "path": "/retention-policies/{id}/assets",
    "envelope": true
  },
  {
    "operationId": "assignRetentionPolicy",
    "method": "POST",
    "path": "/retention-policies/assign",
    "envelope": true
  },
  {
    "operationId": "listRoles",
    "method": "GET",
    "path": "/roles",
    "envelope": true,
    "listKey": "roles"
  },
  {
    "operationId": "createRole",
    "method": "POST",
    "path": "/roles",
    "envelope": true
  },
  {
    "operationId": "getRole",
    "method": "GET",
    "path": "/roles/{id}",
    "envelope": true
  },
  {
    "operationId": "updateRole",
    "method": "PATCH",
    "path": "/roles/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteRole",
    "method": "DELETE",
    "path": "/roles/{id}",
    "envelope": true
  },
  {
    "operationId": "listUsers",
    "method": "GET",
    "path": "/users",
    "envelope": true,
    "listKey": "users"
  },
  {
    "operationId": "assignUserRole",
    "method": "PUT",
    "path": "/users/{id}/roles/{roleId}",
    "envelope": true
  },
  {
    "operationId": "removeUserRole",
    "method": "DELETE",
    "path": "/users/{id}/roles/{roleId}",
    "envelope": true
  },
  {
    "operationId": "getUserManager",
    "method": "GET",
    "path": "/users/{id}/manager",
    "envelope": true
  },
  {
    "operationId": "setUserManager",
    "method": "PUT",
    "path": "/users/{id}/manager",
    "envelope": true
  },
  {
    "operationId": "listUserReports",
    "method": "GET",
    "path": "/users/{id}/reports",
    "envelope": true,
    "listKey": "reports"
  },
  {
    "operationId": "listTeams",
    "method": "GET",
    "path": "/teams",
    "envelope": true,
    "listKey": "teams"
  },
  {
    "operationId": "createTeam",
    "method": "POST",
    "path": "/teams",
    "envelope": true
  },
  {
    "operationId": "getTeam",
    "method": "GET",
    "path": "/teams/{id}",
    "envelope": true
  },
  {
    "operationId": "updateTeam",
    "method": "PATCH",
    "path": "/teams/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteTeam",
    "method": "DELETE",
    "path": "/teams/{id}",
    "envelope": true
  },
  {
    "operationId": "addTeamMember",
    "method": "PUT",
    "path": "/teams/{id}/members/{userId}",
    "envelope": true
  },
  {
    "operationId": "removeTeamMember",
    "method": "DELETE",
    "path": "/teams/{id}/members/{userId}",
    "envelope": true
  },
  {
    "operationId": "listInvitations",
    "method": "GET",
    "path": "/invitations",
    "envelope": true,
    "listKey": "invitations"
  },
  {
    "operationId": "sendInvitation",
    "method": "POST",
    "path": "/invitations",
    "envelope": true
  },
  {
    "operationId": "revokeInvitation",
    "method": "DELETE",
    "path": "/invitations/{id}",
    "envelope": true
  },
  {
    "operationId": "resendInvitation",
    "method": "POST",
    "path": "/invitations/{id}/resend",
    "envelope": true
  },
  {
    "operationId": "listAuditLog",
    "method": "GET",
    "path": "/audit-log",
    "envelope": true,
    "listKey": "events"
  },
  {
    "operationId": "getWorkspaceTheme",
    "method": "GET",
    "path": "/workspace-theme",
    "envelope": true
  },
  {
    "operationId": "updateWorkspaceTheme",
    "method": "PUT",
    "path": "/workspace-theme",
    "envelope": true
  },
  {
    "operationId": "applyWorkspaceThemePreset",
    "method": "POST",
    "path": "/workspace-theme/apply-preset",
    "envelope": true
  },
  {
    "operationId": "listWorkspaceThemePresets",
    "method": "GET",
    "path": "/workspace-theme/presets",
    "envelope": true,
    "listKey": "presets"
  },
  {
    "operationId": "uploadWorkspaceThemeFont",
    "method": "POST",
    "path": "/workspace-theme/fonts",
    "envelope": true
  },
  {
    "operationId": "listApiKeys",
    "method": "GET",
    "path": "/api-keys",
    "envelope": true,
    "listKey": "api_keys"
  },
  {
    "operationId": "createApiKey",
    "method": "POST",
    "path": "/api-keys",
    "envelope": true
  },
  {
    "operationId": "revokeApiKey",
    "method": "POST",
    "path": "/api-keys/{id}/revoke",
    "envelope": true
  },
  {
    "operationId": "deleteApiKey",
    "method": "DELETE",
    "path": "/api-keys/{id}",
    "envelope": true
  },
  {
    "operationId": "listWorkflowWebhooks",
    "method": "GET",
    "path": "/workflows/{id}/webhooks",
    "envelope": true,
    "listKey": "webhooks"
  },
  {
    "operationId": "createWorkflowWebhook",
    "method": "POST",
    "path": "/workflows/{id}/webhooks",
    "envelope": true
  },
  {
    "operationId": "getWebhook",
    "method": "GET",
    "path": "/webhooks/{id}",
    "envelope": true
  },
  {
    "operationId": "updateWebhook",
    "method": "PATCH",
    "path": "/webhooks/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteWebhook",
    "method": "DELETE",
    "path": "/webhooks/{id}",
    "envelope": true
  },
  {
    "operationId": "rotateWebhookSecret",
    "method": "POST",
    "path": "/webhooks/{id}/rotate",
    "envelope": true
  },
  {
    "operationId": "getGitHubSyncStatus",
    "method": "GET",
    "path": "/github-sync/status",
    "envelope": true
  },
  {
    "operationId": "commitGitHubSync",
    "method": "POST",
    "path": "/github-sync/commit",
    "envelope": true
  },
  {
    "operationId": "listGitHubSyncRuns",
    "method": "GET",
    "path": "/github-sync/runs",
    "envelope": true,
    "listKey": "runs"
  },
  {
    "operationId": "startGitHubSyncRun",
    "method": "POST",
    "path": "/github-sync/runs",
    "envelope": true
  },
  {
    "operationId": "getGitHubSyncRun",
    "method": "GET",
    "path": "/github-sync/runs/{id}",
    "envelope": true
  },
  {
    "operationId": "deployGitHubSync",
    "method": "POST",
    "path": "/github-sync/deploy",
    "envelope": true
  },
  {
    "operationId": "listGitHubSyncDeployments",
    "method": "GET",
    "path": "/github-sync/deployments",
    "envelope": true,
    "listKey": "deployments"
  },
  {
    "operationId": "getGitHubSyncDeployment",
    "method": "GET",
    "path": "/github-sync/deployments/{id}",
    "envelope": true
  },
  {
    "operationId": "getGitHubSyncSchedule",
    "method": "GET",
    "path": "/github-sync/schedule",
    "envelope": true
  },
  {
    "operationId": "setGitHubSyncSchedule",
    "method": "PUT",
    "path": "/github-sync/schedule",
    "envelope": true
  },
  {
    "operationId": "deleteGitHubSyncSchedule",
    "method": "DELETE",
    "path": "/github-sync/schedule",
    "envelope": true
  },
  {
    "operationId": "listDirectoryConnections",
    "method": "GET",
    "path": "/directory-sync/connections",
    "envelope": true,
    "listKey": "connections"
  },
  {
    "operationId": "createDirectoryConnection",
    "method": "POST",
    "path": "/directory-sync/connections",
    "envelope": true
  },
  {
    "operationId": "getDirectoryConnection",
    "method": "GET",
    "path": "/directory-sync/connections/{provider}",
    "envelope": true
  },
  {
    "operationId": "updateDirectoryConnection",
    "method": "PATCH",
    "path": "/directory-sync/connections/{provider}",
    "envelope": true
  },
  {
    "operationId": "deleteDirectoryConnection",
    "method": "DELETE",
    "path": "/directory-sync/connections/{provider}",
    "envelope": true
  },
  {
    "operationId": "testDirectoryConnection",
    "method": "POST",
    "path": "/directory-sync/connections/{provider}/test",
    "envelope": true
  },
  {
    "operationId": "startDirectorySync",
    "method": "POST",
    "path": "/directory-sync/connections/{provider}/sync",
    "envelope": true
  },
  {
    "operationId": "listDirectorySyncRuns",
    "method": "GET",
    "path": "/directory-sync/runs",
    "envelope": true,
    "listKey": "runs"
  },
  {
    "operationId": "listScimTokens",
    "method": "GET",
    "path": "/directory-sync/scim-tokens",
    "envelope": true,
    "listKey": "scim_tokens"
  },
  {
    "operationId": "createScimToken",
    "method": "POST",
    "path": "/directory-sync/scim-tokens",
    "envelope": true
  },
  {
    "operationId": "deleteScimToken",
    "method": "DELETE",
    "path": "/directory-sync/scim-tokens/{id}",
    "envelope": true
  },
  {
    "operationId": "rotateScimToken",
    "method": "POST",
    "path": "/directory-sync/scim-tokens/{id}/rotate",
    "envelope": true
  },
  {
    "operationId": "exportConfig",
    "method": "GET",
    "path": "/config/export",
    "envelope": true,
    "async": true
  },
  {
    "operationId": "applyConfig",
    "method": "POST",
    "path": "/config/apply",
    "envelope": true,
    "async": true
  },
  {
    "operationId": "listPackages",
    "method": "GET",
    "path": "/packages",
    "envelope": true,
    "listKey": "packages"
  },
  {
    "operationId": "createPackage",
    "method": "POST",
    "path": "/packages",
    "envelope": true
  },
  {
    "operationId": "previewPackage",
    "method": "POST",
    "path": "/packages/preview",
    "envelope": true
  },
  {
    "operationId": "inspectPackage",
    "method": "POST",
    "path": "/packages/inspect",
    "envelope": true
  },
  {
    "operationId": "searchPackageAssets",
    "method": "GET",
    "path": "/packages/assets",
    "envelope": true,
    "listKey": "assets"
  },
  {
    "operationId": "getPackage",
    "method": "GET",
    "path": "/packages/{id}",
    "envelope": true
  },
  {
    "operationId": "updatePackage",
    "method": "PATCH",
    "path": "/packages/{id}",
    "envelope": true
  },
  {
    "operationId": "deletePackage",
    "method": "DELETE",
    "path": "/packages/{id}",
    "envelope": true
  },
  {
    "operationId": "getPackageContents",
    "method": "GET",
    "path": "/packages/{id}/contents",
    "envelope": true
  },
  {
    "operationId": "listPackageVersions",
    "method": "GET",
    "path": "/packages/{id}/versions",
    "envelope": true,
    "listKey": "versions"
  },
  {
    "operationId": "buildPackageVersion",
    "method": "POST",
    "path": "/packages/{id}/versions",
    "envelope": true,
    "async": true
  },
  {
    "operationId": "getPackageVersion",
    "method": "GET",
    "path": "/packages/{id}/versions/{versionId}",
    "envelope": true
  },
  {
    "operationId": "downloadPackageVersion",
    "method": "GET",
    "path": "/packages/{id}/versions/{versionId}/download",
    "envelope": true
  },
  {
    "operationId": "listPackageInstalls",
    "method": "GET",
    "path": "/package-installs",
    "envelope": true,
    "listKey": "installs"
  },
  {
    "operationId": "installPackage",
    "method": "POST",
    "path": "/package-installs",
    "envelope": true,
    "async": true
  },
  {
    "operationId": "planPackageInstall",
    "method": "POST",
    "path": "/package-installs/plan",
    "envelope": true
  },
  {
    "operationId": "getPackageInstall",
    "method": "GET",
    "path": "/package-installs/{id}",
    "envelope": true
  },
  {
    "operationId": "upgradePackageInstall",
    "method": "POST",
    "path": "/package-installs/{id}/upgrade",
    "envelope": true,
    "async": true
  },
  {
    "operationId": "completePackageInstall",
    "method": "POST",
    "path": "/package-installs/{id}/complete",
    "envelope": true
  },
  {
    "operationId": "uninstallPackage",
    "method": "POST",
    "path": "/package-installs/{id}/uninstall",
    "envelope": true,
    "async": true
  },
  {
    "operationId": "listPackageEvents",
    "method": "GET",
    "path": "/package-events",
    "envelope": true,
    "listKey": "events"
  },
  {
    "operationId": "getPackageEvent",
    "method": "GET",
    "path": "/package-events/{id}",
    "envelope": true
  },
  {
    "operationId": "listJobs",
    "method": "GET",
    "path": "/jobs",
    "envelope": true,
    "listKey": "jobs"
  },
  {
    "operationId": "getJob",
    "method": "GET",
    "path": "/jobs/{id}",
    "envelope": true
  },
  {
    "operationId": "cancelJob",
    "method": "POST",
    "path": "/jobs/{id}/cancel",
    "envelope": true
  },
  {
    "operationId": "retryJob",
    "method": "POST",
    "path": "/jobs/{id}/retry",
    "envelope": true
  },
  {
    "operationId": "getJobResult",
    "method": "GET",
    "path": "/jobs/{id}/result",
    "envelope": true
  },
  {
    "operationId": "downloadJob",
    "method": "GET",
    "path": "/jobs/{id}/download",
    "envelope": false,
    "download": true
  },
  {
    "operationId": "listEvents",
    "method": "GET",
    "path": "/events",
    "envelope": true,
    "listKey": "events"
  },
  {
    "operationId": "streamEvents",
    "method": "GET",
    "path": "/events/stream",
    "envelope": false
  },
  {
    "operationId": "listLogDestinations",
    "method": "GET",
    "path": "/log-destinations",
    "envelope": true,
    "listKey": "log_destinations"
  },
  {
    "operationId": "createLogDestination",
    "method": "POST",
    "path": "/log-destinations",
    "envelope": true
  },
  {
    "operationId": "getLogDestination",
    "method": "GET",
    "path": "/log-destinations/{id}",
    "envelope": true
  },
  {
    "operationId": "updateLogDestination",
    "method": "PATCH",
    "path": "/log-destinations/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteLogDestination",
    "method": "DELETE",
    "path": "/log-destinations/{id}",
    "envelope": true
  },
  {
    "operationId": "resetLogDestinationCursor",
    "method": "POST",
    "path": "/log-destinations/{id}/reset-cursor",
    "envelope": true
  },
  {
    "operationId": "getLogDestinationStatus",
    "method": "GET",
    "path": "/log-destinations/{id}/status",
    "envelope": true
  },
  {
    "operationId": "testLogDestination",
    "method": "POST",
    "path": "/log-destinations/{id}/test",
    "envelope": true
  }
]
