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
    "operationId": "getHomeMetrics",
    "method": "GET",
    "path": "/home/metrics",
    "envelope": true
  },
  {
    "operationId": "getHomeStats",
    "method": "GET",
    "path": "/home/stats",
    "envelope": true
  },
  {
    "operationId": "listMyHomeTasks",
    "method": "GET",
    "path": "/home/tasks",
    "envelope": true,
    "listKey": "tasks"
  },
  {
    "operationId": "listHomeQueue",
    "method": "GET",
    "path": "/home/queue",
    "envelope": true,
    "listKey": "tasks"
  },
  {
    "operationId": "listMySubmissions",
    "method": "GET",
    "path": "/home/submissions",
    "envelope": true,
    "listKey": "submissions"
  },
  {
    "operationId": "getRunProgress",
    "method": "GET",
    "path": "/home/runs/{id}/progress",
    "envelope": true
  },
  {
    "operationId": "listFollowedRuns",
    "method": "GET",
    "path": "/home/following",
    "envelope": true,
    "listKey": "runs"
  },
  {
    "operationId": "followRun",
    "method": "PUT",
    "path": "/home/following/{id}",
    "envelope": true
  },
  {
    "operationId": "unfollowRun",
    "method": "DELETE",
    "path": "/home/following/{id}",
    "envelope": true
  },
  {
    "operationId": "listFavoriteForms",
    "method": "GET",
    "path": "/home/favorite-forms",
    "envelope": true,
    "listKey": "forms"
  },
  {
    "operationId": "favoriteForm",
    "method": "PUT",
    "path": "/home/favorite-forms/{id}",
    "envelope": true
  },
  {
    "operationId": "unfavoriteForm",
    "method": "DELETE",
    "path": "/home/favorite-forms/{id}",
    "envelope": true
  },
  {
    "operationId": "getHomePreferences",
    "method": "GET",
    "path": "/home/preferences",
    "envelope": true
  },
  {
    "operationId": "updateHomePreferences",
    "method": "PATCH",
    "path": "/home/preferences",
    "envelope": true
  },
  {
    "operationId": "getHomeLayout",
    "method": "GET",
    "path": "/home/layout",
    "envelope": true
  },
  {
    "operationId": "updateHomeLayout",
    "method": "PUT",
    "path": "/home/layout",
    "envelope": true
  },
  {
    "operationId": "resetHomeLayout",
    "method": "DELETE",
    "path": "/home/layout",
    "envelope": true
  },
  {
    "operationId": "claimTask",
    "method": "POST",
    "path": "/tasks/{id}/claim",
    "envelope": true
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
    "operationId": "queryTaskDataTable",
    "method": "POST",
    "path": "/tasks/{id}/data-table",
    "envelope": true
  },
  {
    "operationId": "ingestTask",
    "method": "POST",
    "path": "/tasks/ingest",
    "envelope": false
  },
  {
    "operationId": "listTaskAttachments",
    "method": "GET",
    "path": "/tasks/{id}/attachments",
    "envelope": true,
    "listKey": "attachments"
  },
  {
    "operationId": "addTaskAttachment",
    "method": "POST",
    "path": "/tasks/{id}/attachments",
    "envelope": true
  },
  {
    "operationId": "completeTaskAttachment",
    "method": "POST",
    "path": "/tasks/{id}/attachments/{attachmentId}/complete",
    "envelope": true
  },
  {
    "operationId": "deleteTaskAttachment",
    "method": "DELETE",
    "path": "/tasks/{id}/attachments/{attachmentId}",
    "envelope": true
  },
  {
    "operationId": "getTaskAttachmentDownloadUrl",
    "method": "GET",
    "path": "/tasks/{id}/attachments/{attachmentId}/download",
    "envelope": true
  },
  {
    "operationId": "listFollowedTasks",
    "method": "GET",
    "path": "/tasks/following",
    "envelope": true,
    "listKey": "tasks"
  },
  {
    "operationId": "followTask",
    "method": "PUT",
    "path": "/tasks/{id}/follow",
    "envelope": true
  },
  {
    "operationId": "unfollowTask",
    "method": "DELETE",
    "path": "/tasks/{id}/follow",
    "envelope": true
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
    "operationId": "getAgentQueueJob",
    "method": "GET",
    "path": "/agents/queue/{id}",
    "envelope": true
  },
  {
    "operationId": "listAgentRuns",
    "method": "GET",
    "path": "/agents/runs",
    "envelope": true,
    "listKey": "runs"
  },
  {
    "operationId": "getAgentRun",
    "method": "GET",
    "path": "/agents/runs/{id}",
    "envelope": true
  },
  {
    "operationId": "getAgentUsage",
    "method": "GET",
    "path": "/agents/{id}/usage",
    "envelope": true
  },
  {
    "operationId": "getWorkspaceAgentUsage",
    "method": "GET",
    "path": "/agents/usage",
    "envelope": true
  },
  {
    "operationId": "updateAgentCostSettings",
    "method": "PUT",
    "path": "/agents/cost-settings",
    "envelope": true
  },
  {
    "operationId": "listAgentVersions",
    "method": "GET",
    "path": "/agents/{id}/versions",
    "envelope": true,
    "listKey": "versions"
  },
  {
    "operationId": "restoreAgentVersion",
    "method": "POST",
    "path": "/agents/{id}/versions/{version}/restore",
    "envelope": true
  },
  {
    "operationId": "listAgentEvalCases",
    "method": "GET",
    "path": "/agents/{id}/evals/cases",
    "envelope": true,
    "listKey": "cases"
  },
  {
    "operationId": "createAgentEvalCase",
    "method": "POST",
    "path": "/agents/{id}/evals/cases",
    "envelope": true
  },
  {
    "operationId": "updateAgentEvalCase",
    "method": "PUT",
    "path": "/agents/{id}/evals/cases/{caseId}",
    "envelope": true
  },
  {
    "operationId": "deleteAgentEvalCase",
    "method": "DELETE",
    "path": "/agents/{id}/evals/cases/{caseId}",
    "envelope": true
  },
  {
    "operationId": "runAgentEvals",
    "method": "POST",
    "path": "/agents/{id}/evals/runs",
    "envelope": true
  },
  {
    "operationId": "listAgentEvalRuns",
    "method": "GET",
    "path": "/agents/{id}/evals/runs",
    "envelope": true,
    "listKey": "runs"
  },
  {
    "operationId": "getAgentEvalRun",
    "method": "GET",
    "path": "/agents/{id}/evals/runs/{runId}",
    "envelope": true
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
    "operationId": "getFormGovernance",
    "method": "GET",
    "path": "/forms/{id}/governance",
    "envelope": true
  },
  {
    "operationId": "setFormLegalHold",
    "method": "POST",
    "path": "/forms/{id}/legal-hold",
    "envelope": true
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
    "operationId": "queryFormDataTable",
    "method": "POST",
    "path": "/forms/{id}/data-table",
    "envelope": true
  },
  {
    "operationId": "checkFormAccessibility",
    "method": "POST",
    "path": "/forms/{id}/accessibility",
    "envelope": true
  },
  {
    "operationId": "checkFormSystemName",
    "method": "GET",
    "path": "/forms/system-name-check",
    "envelope": true
  },
  {
    "operationId": "getFormLinks",
    "method": "GET",
    "path": "/forms/{id}/links",
    "envelope": true
  },
  {
    "operationId": "createWizardForm",
    "method": "POST",
    "path": "/forms/wizard",
    "envelope": true
  },
  {
    "operationId": "listWizardForms",
    "method": "GET",
    "path": "/forms/wizard",
    "envelope": true,
    "listKey": "projects"
  },
  {
    "operationId": "getWizardForm",
    "method": "GET",
    "path": "/forms/wizard/{id}",
    "envelope": true
  },
  {
    "operationId": "updateWizardForm",
    "method": "PATCH",
    "path": "/forms/wizard/{id}",
    "envelope": true
  },
  {
    "operationId": "getWizardResults",
    "method": "GET",
    "path": "/forms/wizard/{id}/results",
    "envelope": true
  },
  {
    "operationId": "getFormAnonymous",
    "method": "GET",
    "path": "/forms/{id}/anonymous",
    "envelope": true
  },
  {
    "operationId": "updateFormAnonymous",
    "method": "PATCH",
    "path": "/forms/{id}/anonymous",
    "envelope": true
  },
  {
    "operationId": "regenerateFormAnonymousLink",
    "method": "POST",
    "path": "/forms/{id}/anonymous/regenerate",
    "envelope": true
  },
  {
    "operationId": "getAnonymousFormsSettings",
    "method": "GET",
    "path": "/anonymous-forms",
    "envelope": true
  },
  {
    "operationId": "updateAnonymousFormsSettings",
    "method": "PATCH",
    "path": "/anonymous-forms",
    "envelope": true
  },
  {
    "operationId": "listFormControls",
    "method": "GET",
    "path": "/form-controls",
    "envelope": true,
    "listKey": "form_controls"
  },
  {
    "operationId": "createFormControl",
    "method": "POST",
    "path": "/form-controls",
    "envelope": true
  },
  {
    "operationId": "importFormControl",
    "method": "POST",
    "path": "/form-controls/import",
    "envelope": true
  },
  {
    "operationId": "getFormControl",
    "method": "GET",
    "path": "/form-controls/{id}",
    "envelope": true
  },
  {
    "operationId": "updateFormControl",
    "method": "PATCH",
    "path": "/form-controls/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteFormControl",
    "method": "DELETE",
    "path": "/form-controls/{id}",
    "envelope": true
  },
  {
    "operationId": "getFormControlVersion",
    "method": "GET",
    "path": "/form-controls/{id}/versions/{version}",
    "envelope": true
  },
  {
    "operationId": "getFormControlUsages",
    "method": "GET",
    "path": "/form-controls/{id}/usages",
    "envelope": true,
    "listKey": "usages"
  },
  {
    "operationId": "exportFormControl",
    "method": "GET",
    "path": "/form-controls/{id}/export",
    "envelope": true
  },
  {
    "operationId": "uploadFile",
    "method": "POST",
    "path": "/files/uploads",
    "envelope": true
  },
  {
    "operationId": "completeFileUpload",
    "method": "POST",
    "path": "/files/uploads/{id}/complete",
    "envelope": true
  },
  {
    "operationId": "uploadWorkflowAction",
    "method": "POST",
    "path": "/workflow-activities/upload",
    "envelope": true
  },
  {
    "operationId": "getWorkflowActivityUsages",
    "method": "GET",
    "path": "/workflow-activities/{id}/usages",
    "envelope": true,
    "listKey": "usages"
  },
  {
    "operationId": "getWorkflowActivityVersion",
    "method": "GET",
    "path": "/workflow-activities/{id}/versions/{version}",
    "envelope": true
  },
  {
    "operationId": "setWorkflowActivitySecrets",
    "method": "PUT",
    "path": "/workflow-activities/{id}/secrets",
    "envelope": true
  },
  {
    "operationId": "testWorkflowActivity",
    "method": "POST",
    "path": "/workflow-activities/{id}/test",
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
    "operationId": "listObjectPermissions",
    "method": "GET",
    "path": "/object-permissions",
    "envelope": true,
    "listKey": "permissions"
  },
  {
    "operationId": "setObjectPermission",
    "method": "POST",
    "path": "/object-permissions",
    "envelope": true
  },
  {
    "operationId": "removeObjectPermission",
    "method": "DELETE",
    "path": "/object-permissions/{id}",
    "envelope": true
  },
  {
    "operationId": "getOrgChart",
    "method": "GET",
    "path": "/org/chart",
    "envelope": true,
    "listKey": "people"
  },
  {
    "operationId": "getOrgPerson",
    "method": "GET",
    "path": "/org/people/{id}",
    "envelope": true
  },
  {
    "operationId": "updateOrgPerson",
    "method": "PATCH",
    "path": "/org/people/{id}",
    "envelope": true
  },
  {
    "operationId": "detachOrgPerson",
    "method": "POST",
    "path": "/org/people/{id}/detach",
    "envelope": true
  },
  {
    "operationId": "listOrgSubordinates",
    "method": "GET",
    "path": "/org/people/{id}/subordinates",
    "envelope": true,
    "listKey": "people"
  },
  {
    "operationId": "getOrgManagerChain",
    "method": "GET",
    "path": "/org/people/{id}/manager-chain",
    "envelope": true,
    "listKey": "chain"
  },
  {
    "operationId": "listOrgPeers",
    "method": "GET",
    "path": "/org/people/{id}/peers",
    "envelope": true,
    "listKey": "peers"
  },
  {
    "operationId": "listOrgPersonTeams",
    "method": "GET",
    "path": "/org/people/{id}/teams",
    "envelope": true,
    "listKey": "teams"
  },
  {
    "operationId": "listOrgPersonProjects",
    "method": "GET",
    "path": "/org/people/{id}/projects",
    "envelope": true,
    "listKey": "projects"
  },
  {
    "operationId": "resolveOrgScope",
    "method": "GET",
    "path": "/org/scope",
    "envelope": true,
    "listKey": "people"
  },
  {
    "operationId": "listOrgUnits",
    "method": "GET",
    "path": "/org/units",
    "envelope": true,
    "listKey": "units"
  },
  {
    "operationId": "createOrgUnit",
    "method": "POST",
    "path": "/org/units",
    "envelope": true
  },
  {
    "operationId": "getOrgUnit",
    "method": "GET",
    "path": "/org/units/{id}",
    "envelope": true
  },
  {
    "operationId": "updateOrgUnit",
    "method": "PATCH",
    "path": "/org/units/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteOrgUnit",
    "method": "DELETE",
    "path": "/org/units/{id}",
    "envelope": true
  },
  {
    "operationId": "detachOrgUnit",
    "method": "POST",
    "path": "/org/units/{id}/detach",
    "envelope": true
  },
  {
    "operationId": "listOrgUnitMembers",
    "method": "GET",
    "path": "/org/units/{id}/members",
    "envelope": true,
    "listKey": "members"
  },
  {
    "operationId": "addOrgUnitMember",
    "method": "PUT",
    "path": "/org/units/{id}/members/{userId}",
    "envelope": true
  },
  {
    "operationId": "removeOrgUnitMember",
    "method": "DELETE",
    "path": "/org/units/{id}/members/{userId}",
    "envelope": true
  },
  {
    "operationId": "getOrgTeamTree",
    "method": "GET",
    "path": "/org/teams",
    "envelope": true,
    "listKey": "teams"
  },
  {
    "operationId": "listOrgTeamMembers",
    "method": "GET",
    "path": "/org/teams/{id}/members",
    "envelope": true,
    "listKey": "members"
  },
  {
    "operationId": "exportOrg",
    "method": "GET",
    "path": "/org/export",
    "envelope": true
  },
  {
    "operationId": "getOrgImportTemplate",
    "method": "GET",
    "path": "/org/import/template",
    "envelope": true
  },
  {
    "operationId": "importOrg",
    "method": "POST",
    "path": "/org/import",
    "envelope": true
  },
  {
    "operationId": "listProjects",
    "method": "GET",
    "path": "/projects",
    "envelope": true,
    "listKey": "projects"
  },
  {
    "operationId": "createProject",
    "method": "POST",
    "path": "/projects",
    "envelope": true
  },
  {
    "operationId": "getProject",
    "method": "GET",
    "path": "/projects/{id}",
    "envelope": true
  },
  {
    "operationId": "updateProject",
    "method": "PATCH",
    "path": "/projects/{id}",
    "envelope": true
  },
  {
    "operationId": "deleteProject",
    "method": "DELETE",
    "path": "/projects/{id}",
    "envelope": true
  },
  {
    "operationId": "archiveProject",
    "method": "POST",
    "path": "/projects/{id}/archive",
    "envelope": true
  },
  {
    "operationId": "listProjectMembers",
    "method": "GET",
    "path": "/projects/{id}/members",
    "envelope": true,
    "listKey": "members"
  },
  {
    "operationId": "addProjectMember",
    "method": "PUT",
    "path": "/projects/{id}/members/{userId}",
    "envelope": true
  },
  {
    "operationId": "removeProjectMember",
    "method": "DELETE",
    "path": "/projects/{id}/members/{userId}",
    "envelope": true
  },
  {
    "operationId": "attachProjectTeam",
    "method": "PUT",
    "path": "/projects/{id}/teams/{teamId}",
    "envelope": true
  },
  {
    "operationId": "detachProjectTeam",
    "method": "DELETE",
    "path": "/projects/{id}/teams/{teamId}",
    "envelope": true
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
    "operationId": "getWorkspaceAddress",
    "method": "GET",
    "path": "/workspace/address",
    "envelope": true
  },
  {
    "operationId": "updateWorkspaceAddress",
    "method": "PATCH",
    "path": "/workspace/address",
    "envelope": true
  },
  {
    "operationId": "checkWorkspaceAddress",
    "method": "GET",
    "path": "/workspace/address/check",
    "envelope": true
  },
  {
    "operationId": "getTaskCompletionSettings",
    "method": "GET",
    "path": "/workspace/task-completion",
    "envelope": true
  },
  {
    "operationId": "updateTaskCompletionSettings",
    "method": "PATCH",
    "path": "/workspace/task-completion",
    "envelope": true
  },
  {
    "operationId": "getTaskNextStep",
    "method": "GET",
    "path": "/tasks/{id}/next",
    "envelope": true
  },
  {
    "operationId": "getFormSignInPage",
    "method": "GET",
    "path": "/workspace/form-sign-in-page",
    "envelope": true
  },
  {
    "operationId": "updateFormSignInPage",
    "method": "PATCH",
    "path": "/workspace/form-sign-in-page",
    "envelope": true
  },
  {
    "operationId": "getDocumentOcr",
    "method": "GET",
    "path": "/document-ocr",
    "envelope": true
  },
  {
    "operationId": "updateDocumentOcr",
    "method": "PUT",
    "path": "/document-ocr",
    "envelope": true
  },
  {
    "operationId": "deleteDocumentOcrKey",
    "method": "DELETE",
    "path": "/document-ocr",
    "envelope": true
  },
  {
    "operationId": "testDocumentOcr",
    "method": "POST",
    "path": "/document-ocr/test",
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
    "operationId": "getDirectoryCapabilities",
    "method": "GET",
    "path": "/directory-sync/capabilities",
    "envelope": true
  },
  {
    "operationId": "searchEntraGroups",
    "method": "GET",
    "path": "/directory-sync/entra/groups",
    "envelope": true,
    "listKey": "groups"
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
  },
  {
    "operationId": "createAdminWorkspace",
    "method": "POST",
    "path": "/admin/workspaces",
    "envelope": true
  },
  {
    "operationId": "getAdminWorkspace",
    "method": "GET",
    "path": "/admin/workspaces/{slug}",
    "envelope": true
  }
]
