// Generated from packages/sdk/openapi.json by scripts/generate.ts. Do not edit.
import type { CommandSpec } from '../spec'

export const COMMAND_SPECS: readonly CommandSpec[] = [
  {
    "operationId": "getMe",
    "method": "GET",
    "path": "/me",
    "resource": "me",
    "verb": "get",
    "summary": "Describe the calling credential: tenant, user, auth kind and permissions",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listWorkflows",
    "method": "GET",
    "path": "/workflows",
    "resource": "workflows",
    "verb": "list",
    "summary": "List workflows",
    "permission": "workflows.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "active",
        "flag": "active",
        "description": "Only active workflows (default true; pass false for all)",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "workflows",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createWorkflow",
    "method": "POST",
    "path": "/workflows",
    "resource": "workflows",
    "verb": "create",
    "summary": "Create a workflow from nodes and edges",
    "permission": "workflows.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "trigger_type",
          "type": "string",
          "required": false
        },
        {
          "name": "nodes",
          "type": "array",
          "required": true
        },
        {
          "name": "edges",
          "type": "array",
          "required": false
        },
        {
          "name": "user_variables",
          "type": "array",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "trigger_config",
          "required": false
        },
        {
          "name": "swimlanes",
          "required": false
        },
        {
          "name": "sections",
          "required": false
        },
        {
          "name": "tags",
          "required": false
        },
        {
          "name": "is_active",
          "type": "boolean",
          "required": false
        },
        {
          "name": "publish",
          "type": "boolean",
          "required": false,
          "description": "Also publish version 1 (needs workflows.activate)"
        },
        {
          "name": "publish_notes",
          "type": "string",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWorkflow",
    "method": "GET",
    "path": "/workflows/{id}",
    "resource": "workflows",
    "verb": "get",
    "summary": "Get a workflow with its recent runs",
    "permission": "workflows.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "run_id",
        "flag": "run-id",
        "description": "Include detail for this run",
        "required": false,
        "type": "string"
      },
      {
        "name": "include_logs",
        "flag": "include-logs",
        "description": "Include node logs for the selected run",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "include_definition",
        "flag": "include-definition",
        "description": "Include the draft definition (author payload)",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateWorkflowDefinition",
    "method": "PATCH",
    "path": "/workflows/{id}",
    "resource": "workflows",
    "verb": "update",
    "summary": "Save draft changes to a workflow (publish separately, or with publish: true)",
    "permission": "workflows.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "trigger_type",
          "type": "string",
          "required": false
        },
        {
          "name": "nodes",
          "type": "array",
          "required": false,
          "description": "Replaces all nodes"
        },
        {
          "name": "edges",
          "type": "array",
          "required": false,
          "description": "Replaces all edges"
        },
        {
          "name": "user_variables",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "trigger_config",
          "required": false
        },
        {
          "name": "swimlanes",
          "required": false
        },
        {
          "name": "sections",
          "required": false
        },
        {
          "name": "tags",
          "required": false
        },
        {
          "name": "is_active",
          "type": "boolean",
          "required": false,
          "description": "Changing it needs workflows.activate"
        },
        {
          "name": "publish",
          "type": "boolean",
          "required": false,
          "description": "Publish the saved draft as a new version (needs workflows.activate)"
        },
        {
          "name": "publish_notes",
          "type": "string",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteWorkflow",
    "method": "DELETE",
    "path": "/workflows/{id}",
    "resource": "workflows",
    "verb": "delete",
    "summary": "Delete a workflow (queued: its versions, runs and spawned tasks go with it)",
    "permission": "workflows.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "getWorkflowDefinition",
    "method": "GET",
    "path": "/workflows/{id}/definition",
    "resource": "workflows",
    "verb": "definition",
    "summary": "Get the draft definition in author-payload shape (edit it and send it back to PATCH /workflows/{id})",
    "permission": "workflows.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "publishWorkflow",
    "method": "POST",
    "path": "/workflows/{id}/publish",
    "resource": "workflows",
    "verb": "publish",
    "summary": "Publish the draft as a new version (runs use it) and activate the workflow",
    "permission": "workflows.activate",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "notes",
          "type": "string",
          "required": false,
          "description": "Publish notes describing what changed"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "startWorkflow",
    "method": "POST",
    "path": "/workflows/start",
    "resource": "workflows",
    "verb": "start",
    "summary": "Start a workflow run (sync, or async via the queue)",
    "permission": "workflows.activate",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "workflow_id",
          "type": "string",
          "required": true
        },
        {
          "name": "variables",
          "type": "object",
          "required": false,
          "description": "Input values keyed by input name (GET /workflows/{id}/inputs lists them). Declared inputs are validated and coerced to their type; other keys pass through unchanged."
        },
        {
          "name": "async",
          "type": "boolean",
          "required": false
        },
        {
          "name": "task_id",
          "type": "string",
          "required": false
        },
        {
          "name": "priority",
          "type": "integer",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWorkflowInputs",
    "method": "GET",
    "path": "/workflows/{id}/inputs",
    "resource": "workflows",
    "verb": "inputs",
    "summary": "Get the input parameters a workflow run accepts",
    "permission": "workflows.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "fields",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "completeWorkflowEvent",
    "method": "POST",
    "path": "/workflows/events/{id}/complete",
    "resource": "events",
    "verb": "complete",
    "summary": "Resume a run waiting on an external event",
    "permission": "workflows.activate",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "return_variables",
          "type": "object",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listWorkflowRuns",
    "method": "GET",
    "path": "/workflows/runs",
    "resource": "runs",
    "verb": "list",
    "summary": "List workflow runs",
    "permission": "workflows.view_runs",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "workflow_id",
        "flag": "workflow-id",
        "required": false,
        "type": "string"
      },
      {
        "name": "version_id",
        "flag": "version-id",
        "description": "Only runs of this workflow version",
        "required": false,
        "type": "string"
      },
      {
        "name": "status",
        "flag": "status",
        "description": "Run statuses (running, waiting_for_event, paused, completed, failed, migrated) (comma-separated)",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "runs",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWorkflowRun",
    "method": "GET",
    "path": "/workflows/runs/{id}",
    "resource": "runs",
    "verb": "get",
    "summary": "Get a workflow run with its logs",
    "permission": "workflows.view_runs",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "actOnWorkflowRun",
    "method": "POST",
    "path": "/workflows/runs/{id}/action",
    "resource": "runs",
    "verb": "action",
    "summary": "Pause, resume or cancel a run",
    "permission": "workflows.activate",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "action",
          "type": "string",
          "required": true
        },
        {
          "name": "return_variables",
          "type": "object",
          "required": false
        },
        {
          "name": "goto_node_id",
          "type": "string",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listWorkflowQueue",
    "method": "GET",
    "path": "/workflows/queue",
    "resource": "queue",
    "verb": "list",
    "summary": "List queued workflow jobs",
    "permission": "workflows.view_runs",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "workflow_id",
        "flag": "workflow-id",
        "required": false,
        "type": "string"
      },
      {
        "name": "status",
        "flag": "status",
        "description": "Job statuses (comma-separated)",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "jobs",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "actOnWorkflowJob",
    "method": "POST",
    "path": "/workflows/queue/{id}/action",
    "resource": "queue",
    "verb": "action",
    "summary": "Cancel or retry a queued job",
    "permission": "workflows.activate",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "action",
          "type": "string",
          "required": true
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "activateWorkflow",
    "method": "POST",
    "path": "/workflows/{id}/activate",
    "resource": "workflows",
    "verb": "activate",
    "summary": "Activate a workflow (it responds to its trigger)",
    "permission": "workflows.activate",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deactivateWorkflow",
    "method": "POST",
    "path": "/workflows/{id}/deactivate",
    "resource": "workflows",
    "verb": "deactivate",
    "summary": "Deactivate a workflow (its trigger is paused)",
    "permission": "workflows.activate",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listWorkflowVersions",
    "method": "GET",
    "path": "/workflows/{id}/versions",
    "resource": "workflows",
    "verb": "versions",
    "summary": "List published versions of a workflow (newest first)",
    "permission": "workflows.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "versions",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWorkflowVersion",
    "method": "GET",
    "path": "/workflows/{id}/versions/{versionId}",
    "resource": "workflows",
    "verb": "version",
    "summary": "Get one published version with its full definition",
    "permission": "workflows.view",
    "positional": [
      "id",
      "versionId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listWorkflowInstances",
    "method": "GET",
    "path": "/workflows/{id}/instances",
    "resource": "workflows",
    "verb": "instances",
    "summary": "List live instances (waiting or paused runs) with their current node and version",
    "permission": "workflows.view_runs",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "status",
        "flag": "status",
        "description": "active (default) = waiting_for_event and paused",
        "required": false,
        "type": "string",
        "enum": [
          "active",
          "waiting_for_event",
          "paused"
        ]
      },
      {
        "name": "version_id",
        "flag": "version-id",
        "description": "Only instances on this version",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "instances",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "migrateWorkflowInstances",
    "method": "POST",
    "path": "/workflows/{id}/instances/migrate",
    "resource": "workflows",
    "verb": "migrate-instances",
    "summary": "Migrate live instances to another version (or dry-run the plan)",
    "permission": "workflows.manage_runs",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "to_version_id",
          "type": "string",
          "required": true,
          "description": "Version the instances continue on (any version of this workflow)"
        },
        {
          "name": "run_ids",
          "type": "array",
          "required": false,
          "description": "Instances to migrate (at most 500)"
        },
        {
          "name": "from_version_id",
          "type": "string",
          "required": false,
          "description": "Migrate every live instance on this version"
        },
        {
          "name": "all_active",
          "type": "boolean",
          "required": false,
          "description": "Migrate every live instance not already on to_version_id (500 per request; `truncated` says more remain)"
        },
        {
          "name": "node_map",
          "type": "object",
          "required": false,
          "description": "Current node id → node id in the target version where the instance continues"
        },
        {
          "name": "default_target_node_id",
          "type": "string",
          "required": false,
          "description": "Target node for instances whose node is not in node_map (default: the node with the same id)"
        },
        {
          "name": "dry_run",
          "type": "boolean",
          "required": false,
          "description": "Only plan: list each instance → target node, what is closed and created, warnings"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "async": true,
    "destructive": false
  },
  {
    "operationId": "listTasks",
    "method": "GET",
    "path": "/tasks",
    "resource": "tasks",
    "verb": "list",
    "summary": "List tasks",
    "permission": "tasks.view_all",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "scope",
        "flag": "scope",
        "description": "reports: open tasks of your direct reports (add indirect=true for all levels)",
        "required": false,
        "type": "string",
        "enum": [
          "all",
          "reports"
        ]
      },
      {
        "name": "indirect",
        "flag": "indirect",
        "description": "scope=reports: include indirect reports (reports of reports, up to 10 levels)",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "overdue",
        "flag": "overdue",
        "description": "scope=reports: only overdue tasks",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "sla_breached",
        "flag": "sla-breached",
        "description": "scope=reports: only tasks whose run SLA is breached or whose escalation fired",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "workflow_id",
        "flag": "workflow-id",
        "description": "scope=reports: tasks of one workflow",
        "required": false,
        "type": "string"
      },
      {
        "name": "status",
        "flag": "status",
        "description": "Task statuses (comma-separated)",
        "required": false,
        "type": "string"
      },
      {
        "name": "priority",
        "flag": "priority",
        "description": "Priorities (comma-separated)",
        "required": false,
        "type": "string"
      },
      {
        "name": "assignee_id",
        "flag": "assignee-id",
        "required": false,
        "type": "string"
      },
      {
        "name": "is_workflow_task",
        "flag": "is-workflow-task",
        "description": "Filter workflow-generated tasks",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "parent_task_id",
        "flag": "parent-task-id",
        "required": false,
        "type": "string"
      },
      {
        "name": "strip_html",
        "flag": "strip-html",
        "description": "Return `description` as plain text (HTML stripped). `description_text` is always included.",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "tasks",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listAssignedTasks",
    "method": "GET",
    "path": "/tasks/assigned",
    "resource": "tasks",
    "verb": "assigned",
    "summary": "List open tasks assigned to a user or team",
    "permission": "tasks.view_all",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "assignee_id",
        "flag": "assignee-id",
        "required": false,
        "type": "string"
      },
      {
        "name": "team_id",
        "flag": "team-id",
        "required": false,
        "type": "string"
      },
      {
        "name": "status",
        "flag": "status",
        "description": "Task statuses (default todo,in_progress) (comma-separated)",
        "required": false,
        "type": "string"
      },
      {
        "name": "acceptance_status",
        "flag": "acceptance-status",
        "description": "Acceptance statuses (comma-separated)",
        "required": false,
        "type": "string"
      },
      {
        "name": "strip_html",
        "flag": "strip-html",
        "description": "Return `description` as plain text (HTML stripped). `description_text` is always included.",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "tasks",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getTask",
    "method": "GET",
    "path": "/tasks/{id}",
    "resource": "tasks",
    "verb": "get",
    "summary": "Get a task",
    "permission": "tasks.view_all",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "strip_html",
        "flag": "strip-html",
        "description": "Return `description` as plain text (HTML stripped). `description_text` is always included.",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateTask",
    "method": "PATCH",
    "path": "/tasks/{id}",
    "resource": "tasks",
    "verb": "update",
    "summary": "Update task fields and User Task field values",
    "permission": "tasks.complete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "title",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false,
          "description": "Plain text or HTML. HTML is sanitised to an allowlist (formatting, lists, headings, links, tables, https images); scripts, styles, event handlers and unsafe URLs are removed."
        },
        {
          "name": "status",
          "type": "string",
          "required": false,
          "description": "Complete through POST /tasks/{id}/action instead"
        },
        {
          "name": "priority",
          "type": "string",
          "required": false
        },
        {
          "name": "due_date",
          "required": false,
          "description": "ISO 8601"
        },
        {
          "name": "progress_pct",
          "required": false
        },
        {
          "name": "estimated_completion",
          "required": false,
          "description": "ISO 8601"
        },
        {
          "name": "tags",
          "required": false
        },
        {
          "name": "values",
          "type": "object",
          "required": false,
          "description": "User Task field values (validated against the task's fields; saved as a draft, required fields are checked on completion)"
        },
        {
          "name": "on_behalf",
          "type": "boolean",
          "required": false,
          "description": "Save a workflow task's values for its assignee (their manager, or tasks.complete_any)"
        },
        {
          "name": "on_behalf_note",
          "type": "string",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "actOnTask",
    "method": "POST",
    "path": "/tasks/{id}/action",
    "resource": "tasks",
    "verb": "action",
    "summary": "Accept, hold, reject, complete, escalate or redirect a task",
    "permission": "tasks.complete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "action",
          "type": "string",
          "required": true
        },
        {
          "name": "outcome",
          "type": "string",
          "required": false
        },
        {
          "name": "outcome_notes",
          "type": "string",
          "required": false
        },
        {
          "name": "target_user_id",
          "type": "string",
          "required": false
        },
        {
          "name": "target_user_ids",
          "type": "array",
          "required": false
        },
        {
          "name": "target_email",
          "type": "string",
          "required": false
        },
        {
          "name": "target_emails",
          "type": "array",
          "required": false
        },
        {
          "name": "invite_if_needed",
          "type": "boolean",
          "required": false
        },
        {
          "name": "invite_role",
          "type": "string",
          "required": false
        },
        {
          "name": "comment",
          "type": "string",
          "required": false
        },
        {
          "name": "values",
          "type": "object",
          "required": false
        },
        {
          "name": "on_behalf",
          "type": "boolean",
          "required": false,
          "description": "Act for the assignee of a workflow task: their manager (anyone in their manager chain), or a holder of tasks.complete_any. Requires on_behalf_note"
        },
        {
          "name": "on_behalf_note",
          "type": "string",
          "required": false,
          "description": "Why you are acting on behalf (required with on_behalf; shown to the assignee and recorded in the task history)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "lookupTaskField",
    "method": "POST",
    "path": "/tasks/{id}/lookup",
    "resource": "tasks",
    "verb": "lookup",
    "summary": "Suggestions for an Autocomplete / lookup field of an open task",
    "permission": "tasks.complete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "field_key",
          "type": "string",
          "required": true,
          "description": "Key of an Autocomplete / lookup field of the task's form"
        },
        {
          "name": "query",
          "type": "string",
          "required": false,
          "description": "The typed text (matched against the configured search columns / passed to the reference as {{search}})"
        },
        {
          "name": "values",
          "type": "object",
          "required": false,
          "description": "The form's current values, for {{task_data.<key>}} placeholders in the lookup's filters or reference inputs"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "ingestTask",
    "method": "POST",
    "path": "/tasks/ingest",
    "resource": "tasks",
    "verb": "ingest",
    "summary": "Create a task (with optional subtasks) from an external system",
    "permission": "tasks.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "title",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "type": "string",
          "required": false,
          "description": "Plain text or HTML. HTML is sanitised to an allowlist (formatting, lists, headings, links, tables, https images); scripts, styles, event handlers and unsafe URLs are removed."
        },
        {
          "name": "priority",
          "type": "string",
          "required": false
        },
        {
          "name": "due_date",
          "type": "string",
          "required": false
        },
        {
          "name": "assignee_email",
          "type": "string",
          "required": false
        },
        {
          "name": "estimated_effort",
          "type": "number",
          "required": false
        },
        {
          "name": "subtasks",
          "type": "array",
          "required": false
        },
        {
          "name": "workflow",
          "type": "object",
          "required": false
        },
        {
          "name": "idempotency_key",
          "type": "string",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": false,
    "destructive": false
  },
  {
    "operationId": "listAgents",
    "method": "GET",
    "path": "/agents",
    "resource": "agents",
    "verb": "list",
    "summary": "List agents",
    "permission": "agents.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "active",
        "flag": "active",
        "description": "Filter by active flag",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "agents",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createAgent",
    "method": "POST",
    "path": "/agents",
    "resource": "agents",
    "verb": "create",
    "summary": "Create an agent",
    "permission": "agents.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "model",
          "type": "string",
          "required": false
        },
        {
          "name": "system_prompt",
          "type": "string",
          "required": false
        },
        {
          "name": "role",
          "type": "string",
          "required": false
        },
        {
          "name": "task",
          "type": "string",
          "required": false
        },
        {
          "name": "boundaries",
          "type": "string",
          "required": false
        },
        {
          "name": "tools",
          "type": "array",
          "required": false
        },
        {
          "name": "output_config",
          "type": "object",
          "required": false
        },
        {
          "name": "integration_id",
          "required": false
        },
        {
          "name": "temperature",
          "type": "number",
          "required": false
        },
        {
          "name": "max_tokens",
          "type": "integer",
          "required": false
        },
        {
          "name": "max_iterations",
          "type": "integer",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getAgent",
    "method": "GET",
    "path": "/agents/{id}",
    "resource": "agents",
    "verb": "get",
    "summary": "Get an agent",
    "permission": "agents.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "include_runs",
        "flag": "include-runs",
        "description": "Include the 20 most recent runs",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateAgent",
    "method": "PUT",
    "path": "/agents/{id}",
    "resource": "agents",
    "verb": "update",
    "summary": "Update an agent",
    "permission": "agents.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "model",
          "type": "string",
          "required": false
        },
        {
          "name": "system_prompt",
          "type": "string",
          "required": false
        },
        {
          "name": "role",
          "type": "string",
          "required": false
        },
        {
          "name": "task",
          "type": "string",
          "required": false
        },
        {
          "name": "boundaries",
          "type": "string",
          "required": false
        },
        {
          "name": "tools",
          "type": "array",
          "required": false
        },
        {
          "name": "output_config",
          "type": "object",
          "required": false
        },
        {
          "name": "integration_id",
          "required": false
        },
        {
          "name": "temperature",
          "type": "number",
          "required": false
        },
        {
          "name": "max_tokens",
          "type": "integer",
          "required": false
        },
        {
          "name": "max_iterations",
          "type": "integer",
          "required": false
        },
        {
          "name": "is_active",
          "type": "boolean",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteAgent",
    "method": "DELETE",
    "path": "/agents/{id}",
    "resource": "agents",
    "verb": "delete",
    "summary": "Delete an agent (deactivates workflows that reference it)",
    "permission": "agents.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "executeAgent",
    "method": "POST",
    "path": "/agents/{id}/execute",
    "resource": "agents",
    "verb": "execute",
    "summary": "Run an agent (sync, or async via the agent queue)",
    "permission": "agents.test",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "message",
          "type": "string",
          "required": true
        },
        {
          "name": "shared_context",
          "required": false
        },
        {
          "name": "async",
          "type": "boolean",
          "required": false,
          "description": "Queue the run and return a job id (202)"
        },
        {
          "name": "max_iterations",
          "type": "integer",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listAgentQueue",
    "method": "GET",
    "path": "/agents/queue",
    "resource": "agents",
    "verb": "queue",
    "summary": "List queued agent jobs",
    "permission": "agents.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "status",
        "flag": "status",
        "required": false,
        "type": "string"
      },
      {
        "name": "agent_id",
        "flag": "agent-id",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "jobs",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listDecisionTables",
    "method": "GET",
    "path": "/decision-tables",
    "resource": "decision-tables",
    "verb": "list",
    "summary": "List decision tables",
    "permission": "workflows.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Name or description contains",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "decision_tables",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createDecisionTable",
    "method": "POST",
    "path": "/decision-tables",
    "resource": "decision-tables",
    "verb": "create",
    "summary": "Create a decision table",
    "permission": "workflows.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "inputs",
          "type": "array",
          "required": false
        },
        {
          "name": "outputs",
          "type": "array",
          "required": false
        },
        {
          "name": "rules",
          "type": "array",
          "required": false,
          "description": "Ordered; the first enabled matching rule wins"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getDecisionTable",
    "method": "GET",
    "path": "/decision-tables/{id}",
    "resource": "decision-tables",
    "verb": "get",
    "summary": "Get a decision table",
    "permission": "workflows.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateDecisionTable",
    "method": "PUT",
    "path": "/decision-tables/{id}",
    "resource": "decision-tables",
    "verb": "update",
    "summary": "Update a decision table (omitted fields are kept)",
    "permission": "workflows.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "inputs",
          "type": "array",
          "required": false,
          "description": "Replaces all inputs"
        },
        {
          "name": "outputs",
          "type": "array",
          "required": false,
          "description": "Replaces all outputs"
        },
        {
          "name": "rules",
          "type": "array",
          "required": false,
          "description": "Replaces all rules"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteDecisionTable",
    "method": "DELETE",
    "path": "/decision-tables/{id}",
    "resource": "decision-tables",
    "verb": "delete",
    "summary": "Delete a decision table (queued)",
    "permission": "workflows.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "testDecisionTable",
    "method": "POST",
    "path": "/decision-tables/{id}/test",
    "resource": "decision-tables",
    "verb": "test",
    "summary": "Evaluate a decision table against input values",
    "permission": "workflows.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "values",
          "type": "object",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "exportDecisionTable",
    "method": "GET",
    "path": "/decision-tables/{id}/export",
    "resource": "decision-tables",
    "verb": "export",
    "summary": "Export a decision table as portable JSON",
    "permission": "workflows.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "importDecisionTable",
    "method": "POST",
    "path": "/decision-tables/import",
    "resource": "decision-tables",
    "verb": "import",
    "summary": "Create a decision table from an export document",
    "permission": "workflows.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "decision_table",
          "type": "object",
          "required": false,
          "description": "An export document from GET /decision-tables/{id}/export (or send the table fields at the top level)"
        },
        {
          "name": "name",
          "type": "string",
          "required": false,
          "description": "Table name, when the table is sent at the top level"
        },
        {
          "name": "name_override",
          "type": "string",
          "required": false,
          "description": "Replacement name"
        },
        {
          "name": "description_override",
          "type": "string",
          "required": false,
          "description": "Replacement description"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listDataTables",
    "method": "GET",
    "path": "/data-tables",
    "resource": "tables",
    "verb": "list",
    "summary": "List data tables",
    "permission": "data.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Name contains",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "data_tables",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createDataTable",
    "method": "POST",
    "path": "/data-tables",
    "resource": "tables",
    "verb": "create",
    "summary": "Create a data table",
    "permission": "data.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "columns",
          "type": "array",
          "required": false,
          "description": "Custom columns; the system ID and Date Created columns are added automatically"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getDataTable",
    "method": "GET",
    "path": "/data-tables/{id}",
    "resource": "tables",
    "verb": "get",
    "summary": "Get a data table with its columns",
    "permission": "data.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateDataTable",
    "method": "PATCH",
    "path": "/data-tables/{id}",
    "resource": "tables",
    "verb": "update",
    "summary": "Rename a data table or replace its custom columns",
    "permission": "data.edit_schema",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "columns",
          "type": "array",
          "required": false,
          "description": "Full replacement list of custom columns (system columns are kept)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteDataTable",
    "method": "DELETE",
    "path": "/data-tables/{id}",
    "resource": "tables",
    "verb": "delete",
    "summary": "Delete a data table and all its rows (queued)",
    "permission": "data.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "listDataRows",
    "method": "GET",
    "path": "/data-tables/{id}/rows",
    "resource": "rows",
    "verb": "list",
    "summary": "List or search rows",
    "permission": "data.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Text matched against the row id and every cell",
        "required": false,
        "type": "string"
      },
      {
        "name": "filters",
        "flag": "filters",
        "description": "JSON array of {field, operator, value}, e.g. [{\"field\":\"status\",\"operator\":\"equals\",\"value\":\"open\"}]",
        "required": false,
        "type": "string"
      },
      {
        "name": "order",
        "flag": "order",
        "description": "Sort: field, -field (descending) or field.desc / field.asc (default -created_at)",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "rows",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "upsertDataRows",
    "method": "POST",
    "path": "/data-tables/{id}/rows",
    "resource": "rows",
    "verb": "upsert",
    "summary": "Insert rows, or replace existing ones by row_id (single or bulk)",
    "permission": "data.manage_rows",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "row_id",
          "type": "string",
          "required": false,
          "description": "Single row: existing row to replace (omit to insert)"
        },
        {
          "name": "data",
          "type": "object",
          "required": false,
          "description": "Single row: cells keyed by column key (or name)"
        },
        {
          "name": "rows",
          "type": "array",
          "required": false,
          "description": "Bulk: up to 500 rows, validated before any is written"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getDataRow",
    "method": "GET",
    "path": "/data-tables/{id}/rows/{rowId}",
    "resource": "rows",
    "verb": "get",
    "summary": "Get a row",
    "permission": "data.view",
    "positional": [
      "id",
      "rowId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateDataRow",
    "method": "PATCH",
    "path": "/data-tables/{id}/rows/{rowId}",
    "resource": "rows",
    "verb": "update",
    "summary": "Change cells of a row (others are kept)",
    "permission": "data.manage_rows",
    "positional": [
      "id",
      "rowId"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "data",
          "type": "object",
          "required": true,
          "description": "Cells to change; other cells are kept"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteDataRow",
    "method": "DELETE",
    "path": "/data-tables/{id}/rows/{rowId}",
    "resource": "rows",
    "verb": "delete",
    "summary": "Delete a row (queued; fires data_table_event \"deleted\" workflows)",
    "permission": "data.manage_rows",
    "positional": [
      "id",
      "rowId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "bulkDeleteDataRows",
    "method": "POST",
    "path": "/data-tables/{id}/rows/bulk-delete",
    "resource": "rows",
    "verb": "bulk-delete",
    "summary": "Delete up to 500 rows of a table (queued); unknown ids are ignored",
    "permission": "data.manage_rows",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "row_ids",
          "type": "array",
          "required": true
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "async": true,
    "destructive": true
  },
  {
    "operationId": "listIntegrations",
    "method": "GET",
    "path": "/integrations",
    "resource": "integrations",
    "verb": "list",
    "summary": "List integrations",
    "permission": "integrations.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "active",
        "flag": "active",
        "description": "Filter by active flag",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "type",
        "flag": "type",
        "description": "Integration type (rest_api, odata, database, webhook or a connector key)",
        "required": false,
        "type": "string"
      },
      {
        "name": "search",
        "flag": "search",
        "description": "Name contains",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "integrations",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createIntegration",
    "method": "POST",
    "path": "/integrations",
    "resource": "integrations",
    "verb": "create",
    "summary": "Create an integration (credentials are encrypted at rest)",
    "permission": "integrations.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "type",
          "type": "string",
          "required": true
        },
        {
          "name": "config",
          "type": "object",
          "required": true,
          "description": "REST/OData/webhook: { base_url, auth_type: none|api_key|bearer|basic|oauth2, auth_config: { token | key_name+key_value | username+password }, headers }. Database: { db_config: { db_type, host, port, database, username, password, ssl } }"
        },
        {
          "name": "tags",
          "type": "array",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "importOpenApiIntegration",
    "method": "POST",
    "path": "/integrations/import-openapi",
    "resource": "integrations",
    "verb": "import-openapi",
    "summary": "Create an integration with one reference per operation from an OpenAPI 2/3 or Postman document",
    "permission": "integrations.create",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "name",
        "flag": "name",
        "description": "Integration name override (raw-document bodies)",
        "required": false,
        "type": "string"
      },
      {
        "name": "base_url",
        "flag": "base-url",
        "description": "Base URL override (raw-document bodies)",
        "required": false,
        "type": "string"
      },
      {
        "name": "auth_type",
        "flag": "auth-type",
        "description": "Auth type override (raw-document bodies)",
        "required": false,
        "type": "string",
        "enum": [
          "none",
          "api_key",
          "bearer",
          "basic"
        ]
      }
    ],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "spec",
          "required": false,
          "description": "OpenAPI 2/3 or Postman document (object, or JSON/YAML text). Omit to send the document itself as the body."
        },
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "base_url",
          "type": "string",
          "required": false
        },
        {
          "name": "auth_type",
          "type": "string",
          "required": false
        },
        {
          "name": "auth_config",
          "type": "object",
          "required": false
        },
        {
          "name": "selected_reference_indexes",
          "type": "array",
          "required": false
        },
        {
          "name": "tags",
          "type": "array",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getIntegration",
    "method": "GET",
    "path": "/integrations/{id}",
    "resource": "integrations",
    "verb": "get",
    "summary": "Get an integration (masked config) with its references",
    "permission": "integrations.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateIntegration",
    "method": "PATCH",
    "path": "/integrations/{id}",
    "resource": "integrations",
    "verb": "update",
    "summary": "Update an integration",
    "permission": "integrations.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "config",
          "type": "object",
          "required": false,
          "description": "Full config object. Secrets are returned masked as \"__SECRET__\"; send the sentinel back to keep a stored value."
        },
        {
          "name": "is_active",
          "type": "boolean",
          "required": false
        },
        {
          "name": "tags",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteIntegration",
    "method": "DELETE",
    "path": "/integrations/{id}",
    "resource": "integrations",
    "verb": "delete",
    "summary": "Delete an integration and its references",
    "permission": "integrations.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "testIntegration",
    "method": "POST",
    "path": "/integrations/{id}/test",
    "resource": "integrations",
    "verb": "test",
    "summary": "Test the connection (GET base URL with the configured auth)",
    "permission": "integrations.test",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listIntegrationReferences",
    "method": "GET",
    "path": "/integrations/{id}/references",
    "resource": "references",
    "verb": "list",
    "summary": "List an integration's references",
    "permission": "integrations.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Name/description contains",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "references",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createReference",
    "method": "POST",
    "path": "/integrations/{id}/references",
    "resource": "references",
    "verb": "create",
    "summary": "Create a reference on an integration",
    "permission": "integrations.manage_references",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "method",
          "type": "string",
          "required": false,
          "description": "HTTP or database method (default GET)"
        },
        {
          "name": "path_template",
          "type": "string",
          "required": false,
          "description": "e.g. /users/{{id}}"
        },
        {
          "name": "body_template",
          "type": "string",
          "required": false
        },
        {
          "name": "headers",
          "type": "object",
          "required": false
        },
        {
          "name": "query_params",
          "type": "object",
          "required": false
        },
        {
          "name": "request_config",
          "type": "object",
          "required": false,
          "description": "Full request config; overrides the shorthand fields"
        },
        {
          "name": "inputs",
          "type": "array",
          "required": false
        },
        {
          "name": "outputs",
          "type": "array",
          "required": false
        },
        {
          "name": "response_schema",
          "required": false,
          "description": "Response model: { source?, root: { type, description?, example?, fields?: [{ name, ...node }], items?: node } } (a bare root node is accepted). null clears it; it is then derived from outputs again."
        },
        {
          "name": "tags",
          "type": "array",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getReference",
    "method": "GET",
    "path": "/references/{id}",
    "resource": "references",
    "verb": "get",
    "summary": "Get a reference (request config, inputs, outputs, response model)",
    "permission": "integrations.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateReference",
    "method": "PATCH",
    "path": "/references/{id}",
    "resource": "references",
    "verb": "update",
    "summary": "Update a reference",
    "permission": "integrations.manage_references",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "method",
          "type": "string",
          "required": false,
          "description": "Sets request_config.method"
        },
        {
          "name": "request_config",
          "type": "object",
          "required": false
        },
        {
          "name": "inputs",
          "type": "array",
          "required": false
        },
        {
          "name": "outputs",
          "type": "array",
          "required": false
        },
        {
          "name": "response_schema",
          "required": false,
          "description": "Response model: { source?, root: { type, description?, example?, fields?: [{ name, ...node }], items?: node } } (a bare root node is accepted). null clears it; it is then derived from outputs again."
        },
        {
          "name": "tags",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteReference",
    "method": "DELETE",
    "path": "/references/{id}",
    "resource": "references",
    "verb": "delete",
    "summary": "Delete a reference",
    "permission": "integrations.manage_references",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "bulkDeleteReferences",
    "method": "POST",
    "path": "/references/bulk-delete",
    "resource": "references",
    "verb": "bulk-delete",
    "summary": "Delete several references (ids outside the workspace are ignored)",
    "permission": "integrations.manage_references",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "ids",
          "type": "array",
          "required": true
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "async": true,
    "destructive": true
  },
  {
    "operationId": "executeReference",
    "method": "POST",
    "path": "/references/{id}/execute",
    "resource": "references",
    "verb": "execute",
    "summary": "Call a reference with input values",
    "permission": "integrations.test",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "inputs",
          "type": "object",
          "required": false,
          "description": "Input values by input name"
        },
        {
          "name": "capture_schema",
          "type": "boolean",
          "required": false,
          "description": "Fold a successful response into the reference's response model (inferred from the sample, merged with earlier samples) and return it as response_schema"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listObjects",
    "method": "GET",
    "path": "/objects",
    "resource": "objects",
    "verb": "list",
    "summary": "List composite objects with their sources",
    "permission": "integrations.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "objects",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createObject",
    "method": "POST",
    "path": "/objects",
    "resource": "objects",
    "verb": "create",
    "summary": "Create a composite object (also generates its callable reference)",
    "permission": "integrations.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "sources",
          "type": "array",
          "required": true
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getObject",
    "method": "GET",
    "path": "/objects/{id}",
    "resource": "objects",
    "verb": "get",
    "summary": "Get a composite object with its sources and generated references",
    "permission": "integrations.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateObject",
    "method": "PATCH",
    "path": "/objects/{id}",
    "resource": "objects",
    "verb": "update",
    "summary": "Update a composite object (name, description, or a full replacement source list)",
    "permission": "integrations.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "sources",
          "type": "array",
          "required": false,
          "description": "Full replacement source list (rebuilds the generated reference outputs)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteObject",
    "method": "DELETE",
    "path": "/objects/{id}",
    "resource": "objects",
    "verb": "delete",
    "summary": "Delete a composite object, its sources and generated references",
    "permission": "integrations.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "getConnectorCatalog",
    "method": "GET",
    "path": "/connectors/catalog",
    "resource": "connectors",
    "verb": "catalog",
    "summary": "List the built-in connector templates",
    "permission": "integrations.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "category",
        "flag": "category",
        "required": false,
        "type": "string",
        "enum": [
          "cloud",
          "communication",
          "ai",
          "payments",
          "productivity",
          "database"
        ]
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listConnectors",
    "method": "GET",
    "path": "/connectors",
    "resource": "connectors",
    "verb": "list",
    "summary": "List enabled connectors (credentials masked)",
    "permission": "integrations.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "enabled",
        "flag": "enabled",
        "description": "Filter by enabled flag",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "connector_key",
        "flag": "connector-key",
        "description": "Catalog key",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "connectors",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createConnector",
    "method": "POST",
    "path": "/connectors",
    "resource": "connectors",
    "verb": "create",
    "summary": "Enable a connector: creates its integration and templated references",
    "permission": "integrations.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "connector_key",
          "type": "string",
          "required": true,
          "description": "Catalog key (see connectors catalog)"
        },
        {
          "name": "display_name",
          "type": "string",
          "required": false
        },
        {
          "name": "config",
          "type": "object",
          "required": false,
          "description": "Connector configuration fields"
        },
        {
          "name": "credentials",
          "type": "object",
          "required": false,
          "description": "Connector credential fields (write-only)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getConnector",
    "method": "GET",
    "path": "/connectors/{id}",
    "resource": "connectors",
    "verb": "get",
    "summary": "Get a connector with its template, integration and references",
    "permission": "integrations.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateConnector",
    "method": "PATCH",
    "path": "/connectors/{id}",
    "resource": "connectors",
    "verb": "update",
    "summary": "Update connector config/credentials (merged) and keep its integration in step",
    "permission": "integrations.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "display_name",
          "type": "string",
          "required": false
        },
        {
          "name": "config",
          "type": "object",
          "required": false,
          "description": "Fields to change (merged over the stored config)"
        },
        {
          "name": "credentials",
          "type": "object",
          "required": false,
          "description": "Credential fields to change (merged). Secrets are returned masked as \"__SECRET__\"; send the sentinel back to keep a stored value."
        },
        {
          "name": "enabled",
          "type": "boolean",
          "required": false
        },
        {
          "name": "regenerate_references",
          "type": "boolean",
          "required": false,
          "description": "Rebuild the generated references from the template"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteConnector",
    "method": "DELETE",
    "path": "/connectors/{id}",
    "resource": "connectors",
    "verb": "delete",
    "summary": "Delete a connector, its integration and generated references",
    "permission": "integrations.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "testConnector",
    "method": "POST",
    "path": "/connectors/{id}/test",
    "resource": "connectors",
    "verb": "test",
    "summary": "Run the connector preflight and probe with its stored credentials",
    "permission": "integrations.test",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "enableConnector",
    "method": "POST",
    "path": "/connectors/{id}/enable",
    "resource": "connectors",
    "verb": "enable",
    "summary": "Re-enable a connector and its integration",
    "permission": "integrations.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "disableConnector",
    "method": "POST",
    "path": "/connectors/{id}/disable",
    "resource": "connectors",
    "verb": "disable",
    "summary": "Disable a connector and deactivate its integration",
    "permission": "integrations.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "regenerateConnectorReferences",
    "method": "POST",
    "path": "/connectors/{id}/regenerate-references",
    "resource": "connectors",
    "verb": "regenerate-references",
    "summary": "Replace the generated references with the current template set",
    "permission": "integrations.manage_references",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listEmailTemplates",
    "method": "GET",
    "path": "/email-templates",
    "resource": "email-templates",
    "verb": "list",
    "summary": "List email templates (without bodies)",
    "permission": "workflows.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Name contains",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "email_templates",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createEmailTemplate",
    "method": "POST",
    "path": "/email-templates",
    "resource": "email-templates",
    "verb": "create",
    "summary": "Create an email template",
    "permission": "workflows.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "subject",
          "type": "string",
          "required": true,
          "description": "Subject line; supports {{variable}} and {{=FUNC(...)}} expressions"
        },
        {
          "name": "html_body",
          "type": "string",
          "required": true,
          "description": "HTML body; supports {{variable}} and {{=FUNC(...)}} expressions"
        },
        {
          "name": "text_body",
          "required": false,
          "description": "Plain-text / in-app notification body (default: generated from the HTML)"
        },
        {
          "name": "is_default",
          "type": "boolean",
          "required": false,
          "description": "Make this the workspace default template"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getEmailTemplate",
    "method": "GET",
    "path": "/email-templates/{id}",
    "resource": "email-templates",
    "verb": "get",
    "summary": "Get an email template with its subject and bodies",
    "permission": "workflows.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateEmailTemplate",
    "method": "PATCH",
    "path": "/email-templates/{id}",
    "resource": "email-templates",
    "verb": "update",
    "summary": "Update an email template",
    "permission": "workflows.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "subject",
          "type": "string",
          "required": false
        },
        {
          "name": "html_body",
          "type": "string",
          "required": false,
          "description": "New HTML body (the text body is regenerated unless text_body is also sent)"
        },
        {
          "name": "text_body",
          "required": false
        },
        {
          "name": "is_default",
          "type": "boolean",
          "required": false,
          "description": "true makes this the workspace default (clearing the previous one)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteEmailTemplate",
    "method": "DELETE",
    "path": "/email-templates/{id}",
    "resource": "email-templates",
    "verb": "delete",
    "summary": "Delete an email template (409 for the default template)",
    "permission": "workflows.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "previewEmailTemplate",
    "method": "POST",
    "path": "/email-templates/{id}/preview",
    "resource": "email-templates",
    "verb": "preview",
    "summary": "Render the subject and bodies with sample variables (nothing is sent)",
    "permission": "workflows.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "variables",
          "type": "object",
          "required": false,
          "description": "Sample workflow variables, e.g. { \"user_task_title\": \"Approve PO\" }; app_url defaults to the server URL"
        },
        {
          "name": "task",
          "type": "object",
          "required": false,
          "description": "Sample task record for {{task.*}} references"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listForms",
    "method": "GET",
    "path": "/forms",
    "resource": "forms",
    "verb": "list",
    "summary": "List reusable task forms (with field and usage counts)",
    "permission": "forms.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Name or description contains",
        "required": false,
        "type": "string"
      },
      {
        "name": "tag",
        "flag": "tag",
        "description": "Only forms with this tag",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "forms",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createForm",
    "method": "POST",
    "path": "/forms",
    "resource": "forms",
    "verb": "create",
    "summary": "Create a reusable task form (version 1)",
    "permission": "forms.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "tags",
          "required": false,
          "description": "Tags (lower-cased, de-duplicated)"
        },
        {
          "name": "fields",
          "type": "array",
          "required": true,
          "description": "Field definitions (at least one)"
        },
        {
          "name": "layout",
          "required": false,
          "description": "Grid layout; omitted or null = one full-width row per field"
        },
        {
          "name": "theme",
          "required": false,
          "description": "Theme reference (default { source: \"workspace\" })"
        },
        {
          "name": "buttons",
          "required": false,
          "description": "The button bar: [{ id, label, kind (submit, cancel, draft, outcome), style (primary, secondary, danger), outcome? (outcome buttons: the task outcome), hidden? (cancel), actions? [{ type: message | success_screen | start_workflow | redirect | close, text?, title?, screen_button?, url?, workflow_id?, inputs? { <workflow input>: \"{{field}}\" } }] }]; null = Submit and Cancel. A start_workflow action needs workflows.activate to add."
        },
        {
          "name": "header",
          "required": false,
          "description": "Header: { enabled, image (default = the UserTasks mark, workspace_logo, upload, none), image_url? (an uploaded header image), title?, subtitle? ({{field}} placeholders), align? (left, center), banner? (the mini theme banner colour) }."
        },
        {
          "name": "submission_retention_days",
          "required": false,
          "description": "Delete submissions older than this many days (null = keep)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getForm",
    "method": "GET",
    "path": "/forms/{id}",
    "resource": "forms",
    "verb": "get",
    "summary": "Get a form with its fields, layout, theme and usages",
    "permission": "forms.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateForm",
    "method": "PATCH",
    "path": "/forms/{id}",
    "resource": "forms",
    "verb": "update",
    "summary": "Update a form",
    "permission": "forms.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "tags",
          "required": false
        },
        {
          "name": "fields",
          "type": "array",
          "required": false,
          "description": "New field list (a content change: new version)"
        },
        {
          "name": "layout",
          "required": false,
          "description": "New grid layout; null = classic one-field-per-row"
        },
        {
          "name": "theme",
          "required": false,
          "description": "New theme reference"
        },
        {
          "name": "buttons",
          "required": false,
          "description": "New buttons (a content change). The button bar: [{ id, label, kind (submit, cancel, draft, outcome), style (primary, secondary, danger), outcome? (outcome buttons: the task outcome), hidden? (cancel), actions? [{ type: message | success_screen | start_workflow | redirect | close, text?, title?, screen_button?, url?, workflow_id?, inputs? { <workflow input>: \"{{field}}\" } }] }]; null = Submit and Cancel. A start_workflow action needs workflows.activate to add."
        },
        {
          "name": "header",
          "required": false,
          "description": "New header (a content change); null = none. Header: { enabled, image (default = the UserTasks mark, workspace_logo, upload, none), image_url? (an uploaded header image), title?, subtitle? ({{field}} placeholders), align? (left, center), banner? (the mini theme banner colour) }."
        },
        {
          "name": "submission_retention_days",
          "required": false,
          "description": "Delete submissions older than this many days (null = keep)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteForm",
    "method": "DELETE",
    "path": "/forms/{id}",
    "resource": "forms",
    "verb": "delete",
    "summary": "Delete a form (409 with the usages while a workflow uses it)",
    "permission": "forms.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "duplicateForm",
    "method": "POST",
    "path": "/forms/{id}/duplicate",
    "resource": "forms",
    "verb": "duplicate",
    "summary": "Copy a form into a new form (version 1)",
    "permission": "forms.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "required": false,
          "description": "Name of the copy (default \"<name> (copy)\")"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listFormVersions",
    "method": "GET",
    "path": "/forms/{id}/versions",
    "resource": "forms",
    "verb": "versions",
    "summary": "List a form's versions (newest first, without content)",
    "permission": "forms.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "versions",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getFormVersion",
    "method": "GET",
    "path": "/forms/{id}/versions/{version}",
    "resource": "forms",
    "verb": "version",
    "summary": "Get one form version snapshot (fields, layout, theme)",
    "permission": "forms.view",
    "positional": [
      "id",
      "version"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listFormUsages",
    "method": "GET",
    "path": "/forms/{id}/usages",
    "resource": "forms",
    "verb": "usages",
    "summary": "Where a form is used (workflow drafts and active published versions)",
    "permission": "forms.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "usages",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listFormThemes",
    "method": "GET",
    "path": "/form-themes",
    "resource": "form-themes",
    "verb": "list",
    "summary": "List saved form themes",
    "permission": "forms.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Name contains",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "form_themes",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createFormTheme",
    "method": "POST",
    "path": "/form-themes",
    "resource": "form-themes",
    "verb": "create",
    "summary": "Create a saved form theme",
    "permission": "forms.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "overrides",
          "type": "object",
          "required": true,
          "description": "Mini-theme overrides: colors { light, dark: { accent, background, text } }, radius, font, density, label_position, header"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getFormTheme",
    "method": "GET",
    "path": "/form-themes/{id}",
    "resource": "form-themes",
    "verb": "get",
    "summary": "Get a saved form theme",
    "permission": "forms.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateFormTheme",
    "method": "PATCH",
    "path": "/form-themes/{id}",
    "resource": "form-themes",
    "verb": "update",
    "summary": "Update a saved form theme (forms using it pick the change up)",
    "permission": "forms.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "overrides",
          "type": "object",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteFormTheme",
    "method": "DELETE",
    "path": "/form-themes/{id}",
    "resource": "form-themes",
    "verb": "delete",
    "summary": "Delete a saved form theme (409 while a form or step uses it)",
    "permission": "forms.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "submitForm",
    "method": "POST",
    "path": "/forms/{id}/submit",
    "resource": "forms",
    "verb": "submit",
    "summary": "Submit a reusable form",
    "permission": "forms.submit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "values",
          "type": "object",
          "required": false,
          "description": "Field values keyed by field key (validated like a task form: types, required, rules, people, lookup values against their source)"
        },
        {
          "name": "button_id",
          "type": "string",
          "required": false,
          "description": "The button pressed (default: the first submitting button); its start-workflow actions run"
        },
        {
          "name": "idempotency_key",
          "type": "string",
          "required": false,
          "description": "Repeating a key returns the first submission instead of submitting again"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listFormSubmissions",
    "method": "GET",
    "path": "/forms/{id}/submissions",
    "resource": "forms",
    "verb": "submissions",
    "summary": "List a form's submissions (newest first)",
    "permission": "forms.submit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "submitted_by",
        "flag": "submitted-by",
        "description": "Only this submitter (user id)",
        "required": false,
        "type": "string"
      },
      {
        "name": "button_id",
        "flag": "button-id",
        "description": "Only submissions with this button",
        "required": false,
        "type": "string"
      },
      {
        "name": "source",
        "flag": "source",
        "description": "Where it was submitted",
        "required": false,
        "type": "string",
        "enum": [
          "standalone",
          "task",
          "api"
        ]
      },
      {
        "name": "since",
        "flag": "since",
        "description": "ISO 8601: submitted at or after",
        "required": false,
        "type": "string"
      },
      {
        "name": "until",
        "flag": "until",
        "description": "ISO 8601: submitted at or before",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "submissions",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getFormSubmission",
    "method": "GET",
    "path": "/form-submissions/{id}",
    "resource": "form-submissions",
    "verb": "get",
    "summary": "Get one form submission (values, button, runs started)",
    "permission": "forms.submit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "lookupFormField",
    "method": "POST",
    "path": "/forms/{id}/lookup",
    "resource": "forms",
    "verb": "lookup",
    "summary": "Suggestions for an Autocomplete / lookup field of a reusable form",
    "permission": "forms.submit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "field_key",
          "type": "string",
          "required": true
        },
        {
          "name": "query",
          "type": "string",
          "required": false
        },
        {
          "name": "values",
          "type": "object",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listWorkflowActivities",
    "method": "GET",
    "path": "/workflow-activities",
    "resource": "activities",
    "verb": "list",
    "summary": "List custom workflow activities (without source code)",
    "permission": "extensibility.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "status",
        "flag": "status",
        "required": false,
        "type": "string",
        "enum": [
          "draft",
          "active",
          "archived"
        ]
      },
      {
        "name": "search",
        "flag": "search",
        "description": "Name, description or key contains",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "workflow_activities",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createWorkflowActivity",
    "method": "POST",
    "path": "/workflow-activities",
    "resource": "activities",
    "verb": "create",
    "summary": "Create a custom workflow activity",
    "permission": "extensibility.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "source_code",
          "type": "string",
          "required": true,
          "description": "JavaScript exposing run, execute, handler, main, module.exports or module.exports.default"
        },
        {
          "name": "manifest",
          "type": "object",
          "required": true,
          "description": "Typed inputs/outputs (at least one of each) and presentation metadata"
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "key",
          "type": "string",
          "required": false,
          "description": "Stable workflow node key (default: slug of the name; unique per workspace)"
        },
        {
          "name": "status",
          "type": "string",
          "required": false,
          "description": "Default draft"
        },
        {
          "name": "source_kind",
          "type": "string",
          "required": false,
          "description": "Default inline"
        },
        {
          "name": "version",
          "type": "string",
          "required": false,
          "description": "Default 1.0.0"
        },
        {
          "name": "icon_name",
          "type": "string",
          "required": false
        },
        {
          "name": "color",
          "type": "string",
          "required": false
        },
        {
          "name": "demo_inputs",
          "type": "object",
          "required": false,
          "description": "Sample inputs for previews and testing"
        },
        {
          "name": "tags",
          "type": "array",
          "required": false
        },
        {
          "name": "source_filename",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "importWorkflowActivity",
    "method": "POST",
    "path": "/workflow-activities/import",
    "resource": "activities",
    "verb": "import",
    "summary": "Create an activity from a portable export",
    "permission": "extensibility.create",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "publish",
        "flag": "publish",
        "description": "true = import as active regardless of the exported status",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "workflow_activity",
          "type": "object",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWorkflowActivity",
    "method": "GET",
    "path": "/workflow-activities/{id}",
    "resource": "activities",
    "verb": "get",
    "summary": "Get an activity with source code, manifest and readiness findings",
    "permission": "extensibility.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateWorkflowActivity",
    "method": "PATCH",
    "path": "/workflow-activities/{id}",
    "resource": "activities",
    "verb": "update",
    "summary": "Update an activity (omitted fields are kept)",
    "permission": "extensibility.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "source_code",
          "type": "string",
          "required": false
        },
        {
          "name": "manifest",
          "type": "object",
          "required": false,
          "description": "Replacement manifest"
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "key",
          "type": "string",
          "required": false,
          "description": "Stable workflow node key (default: slug of the name; unique per workspace)"
        },
        {
          "name": "status",
          "type": "string",
          "required": false,
          "description": "Default draft"
        },
        {
          "name": "source_kind",
          "type": "string",
          "required": false,
          "description": "Default inline"
        },
        {
          "name": "version",
          "type": "string",
          "required": false,
          "description": "Default 1.0.0"
        },
        {
          "name": "icon_name",
          "type": "string",
          "required": false
        },
        {
          "name": "color",
          "type": "string",
          "required": false
        },
        {
          "name": "demo_inputs",
          "type": "object",
          "required": false,
          "description": "Sample inputs for previews and testing"
        },
        {
          "name": "tags",
          "type": "array",
          "required": false
        },
        {
          "name": "source_filename",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteWorkflowActivity",
    "method": "DELETE",
    "path": "/workflow-activities/{id}",
    "resource": "activities",
    "verb": "delete",
    "summary": "Delete an activity",
    "permission": "extensibility.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "exportWorkflowActivity",
    "method": "GET",
    "path": "/workflow-activities/{id}/export",
    "resource": "activities",
    "verb": "export",
    "summary": "Export an activity as portable JSON (accepted by POST /workflow-activities/import)",
    "permission": "extensibility.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listReports",
    "method": "GET",
    "path": "/reports",
    "resource": "reports",
    "verb": "list",
    "summary": "List saved reports",
    "permission": "reports.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "shared",
        "flag": "shared",
        "description": "Filter by shared flag",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "category",
        "flag": "category",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "reports",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createReport",
    "method": "POST",
    "path": "/reports",
    "resource": "reports",
    "verb": "create",
    "summary": "Create a saved report",
    "permission": "reports.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "type": "string",
          "required": false
        },
        {
          "name": "category",
          "type": "string",
          "required": false
        },
        {
          "name": "is_shared",
          "type": "boolean",
          "required": false
        },
        {
          "name": "config",
          "type": "object",
          "required": false,
          "description": "Report configuration (data_source, columns, filters, ...)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getReport",
    "method": "GET",
    "path": "/reports/{id}",
    "resource": "reports",
    "verb": "get",
    "summary": "Get a saved report",
    "permission": "reports.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateReport",
    "method": "PUT",
    "path": "/reports/{id}",
    "resource": "reports",
    "verb": "update",
    "summary": "Update a saved report",
    "permission": "reports.edit_own",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "category",
          "required": false
        },
        {
          "name": "is_shared",
          "type": "boolean",
          "required": false
        },
        {
          "name": "config",
          "type": "object",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteReport",
    "method": "DELETE",
    "path": "/reports/{id}",
    "resource": "reports",
    "verb": "delete",
    "summary": "Delete a saved report",
    "permission": "reports.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "previewReport",
    "method": "POST",
    "path": "/reports/preview",
    "resource": "reports",
    "verb": "preview",
    "summary": "Run a report configuration without saving it",
    "permission": "reports.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "data_source",
          "type": "string",
          "required": true,
          "description": "Report source key"
        }
      ]
    },
    "listKey": "data",
    "paginated": false,
    "envelope": false,
    "destructive": false
  },
  {
    "operationId": "listReportSources",
    "method": "GET",
    "path": "/reports/sources",
    "resource": "reports",
    "verb": "sources",
    "summary": "List report data sources",
    "permission": "reports.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "sources",
    "paginated": false,
    "envelope": false,
    "destructive": false
  },
  {
    "operationId": "exportReport",
    "method": "GET",
    "path": "/reports/{id}/export",
    "resource": "reports",
    "verb": "export",
    "summary": "Export a saved report as portable JSON",
    "permission": "reports.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "importReport",
    "method": "POST",
    "path": "/reports/import",
    "resource": "reports",
    "verb": "import",
    "summary": "Create a saved report from an export document",
    "permission": "reports.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "report",
          "type": "object",
          "required": false,
          "description": "An export document from GET /reports/{id}/export (or send the report fields at the top level)"
        },
        {
          "name": "name",
          "type": "string",
          "required": false,
          "description": "Report name, when the report is sent at the top level"
        },
        {
          "name": "name_override",
          "type": "string",
          "required": false,
          "description": "Replacement name"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listRetentionPolicies",
    "method": "GET",
    "path": "/retention-policies",
    "resource": "retention",
    "verb": "list",
    "summary": "List retention policies",
    "permission": "settings.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "required": false,
        "type": "string"
      },
      {
        "name": "applies_to",
        "flag": "applies-to",
        "required": false,
        "type": "string"
      },
      {
        "name": "policy_mode",
        "flag": "policy-mode",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "retention_policies",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createRetentionPolicy",
    "method": "POST",
    "path": "/retention-policies",
    "resource": "retention",
    "verb": "create",
    "summary": "Create a retention policy",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "policy_mode",
          "type": "string",
          "required": true,
          "description": "Retention mode (see lib/retention-policy-api.ts RETENTION_POLICY_MODES)"
        },
        {
          "name": "duration_value",
          "type": "number",
          "required": false
        },
        {
          "name": "duration_unit",
          "type": "string",
          "required": false
        },
        {
          "name": "exact_date",
          "type": "string",
          "required": false
        },
        {
          "name": "applies_to",
          "type": "array",
          "required": false,
          "description": "Asset types the policy can be assigned to"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getRetentionPolicy",
    "method": "GET",
    "path": "/retention-policies/{id}",
    "resource": "retention",
    "verb": "get",
    "summary": "Get a retention policy",
    "permission": "settings.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateRetentionPolicy",
    "method": "PUT",
    "path": "/retention-policies/{id}",
    "resource": "retention",
    "verb": "update",
    "summary": "Update a retention policy",
    "permission": "settings.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "policy_mode",
          "type": "string",
          "required": false,
          "description": "Retention mode (see lib/retention-policy-api.ts RETENTION_POLICY_MODES)"
        },
        {
          "name": "duration_value",
          "type": "number",
          "required": false
        },
        {
          "name": "duration_unit",
          "type": "string",
          "required": false
        },
        {
          "name": "exact_date",
          "type": "string",
          "required": false
        },
        {
          "name": "applies_to",
          "type": "array",
          "required": false,
          "description": "Asset types the policy can be assigned to"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteRetentionPolicy",
    "method": "DELETE",
    "path": "/retention-policies/{id}",
    "resource": "retention",
    "verb": "delete",
    "summary": "Delete a retention policy",
    "permission": "settings.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "getRetentionPolicyAssets",
    "method": "GET",
    "path": "/retention-policies/{id}/assets",
    "resource": "retention",
    "verb": "assets",
    "summary": "List assets governed by a retention policy",
    "permission": "settings.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "assignRetentionPolicy",
    "method": "POST",
    "path": "/retention-policies/assign",
    "resource": "retention",
    "verb": "assign",
    "summary": "Assign (or clear) the retention policy on an asset",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "target_type",
          "type": "string",
          "required": true
        },
        {
          "name": "target_id",
          "type": "string",
          "required": true
        },
        {
          "name": "retention_policy_id",
          "required": false,
          "description": "Omit or null to clear the assignment"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listRoles",
    "method": "GET",
    "path": "/roles",
    "resource": "roles",
    "verb": "list",
    "summary": "List system and custom roles with their permissions",
    "permission": "team.view_members",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "roles",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createRole",
    "method": "POST",
    "path": "/roles",
    "resource": "roles",
    "verb": "create",
    "summary": "Create a custom role",
    "permission": "team.change_roles",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "permissions",
          "type": "array",
          "required": false,
          "description": "Permission keys, e.g. [\"tasks.view_all\", \"workflows.view\"]"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getRole",
    "method": "GET",
    "path": "/roles/{id}",
    "resource": "roles",
    "verb": "get",
    "summary": "Get a role",
    "permission": "team.view_members",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateRole",
    "method": "PATCH",
    "path": "/roles/{id}",
    "resource": "roles",
    "verb": "update",
    "summary": "Update a role",
    "permission": "team.change_roles",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false,
          "description": "New name (custom roles only)"
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "permissions",
          "type": "array",
          "required": false,
          "description": "Replaces the role permission list"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteRole",
    "method": "DELETE",
    "path": "/roles/{id}",
    "resource": "roles",
    "verb": "delete",
    "summary": "Delete a custom role (its assignments are removed; 409 for system roles)",
    "permission": "team.change_roles",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "listUsers",
    "method": "GET",
    "path": "/users",
    "resource": "users",
    "verb": "list",
    "summary": "List workspace users",
    "permission": "team.view_members",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Display name or email contains",
        "required": false,
        "type": "string"
      },
      {
        "name": "include_roles",
        "flag": "include-roles",
        "description": "Include each user's roles",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "include_teams",
        "flag": "include-teams",
        "description": "Include each user's teams",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "users",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "assignUserRole",
    "method": "PUT",
    "path": "/users/{id}/roles/{roleId}",
    "resource": "users",
    "verb": "add-role",
    "summary": "Give a user a role (idempotent)",
    "permission": "team.change_roles",
    "positional": [
      "id",
      "roleId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "removeUserRole",
    "method": "DELETE",
    "path": "/users/{id}/roles/{roleId}",
    "resource": "users",
    "verb": "remove-role",
    "summary": "Remove a role from a user",
    "permission": "team.change_roles",
    "positional": [
      "id",
      "roleId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "getUserManager",
    "method": "GET",
    "path": "/users/{id}/manager",
    "resource": "users",
    "verb": "manager",
    "summary": "A member's manager, manager chain and direct reports",
    "permission": "team.view_members",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "setUserManager",
    "method": "PUT",
    "path": "/users/{id}/manager",
    "resource": "users",
    "verb": "set-manager",
    "summary": "Set or clear a member's manager in this workspace",
    "permission": "team.change_roles",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "manager_user_id",
          "required": true,
          "description": "The member's manager in this workspace (null clears it). Must be an active member; loops are refused"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listUserReports",
    "method": "GET",
    "path": "/users/{id}/reports",
    "resource": "users",
    "verb": "reports",
    "summary": "A member's reports (direct, or all levels with indirect=true)",
    "permission": "team.view_members",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "indirect",
        "flag": "indirect",
        "description": "Include reports of reports (up to 10 levels, cycle-safe)",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "reports",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listTeams",
    "method": "GET",
    "path": "/teams",
    "resource": "teams",
    "verb": "list",
    "summary": "List teams with member counts",
    "permission": "team.view_members",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "teams",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createTeam",
    "method": "POST",
    "path": "/teams",
    "resource": "teams",
    "verb": "create",
    "summary": "Create a team",
    "permission": "team.invite",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "parent_id",
          "required": false,
          "description": "Parent team id"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getTeam",
    "method": "GET",
    "path": "/teams/{id}",
    "resource": "teams",
    "verb": "get",
    "summary": "Get a team with its members",
    "permission": "team.view_members",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateTeam",
    "method": "PATCH",
    "path": "/teams/{id}",
    "resource": "teams",
    "verb": "update",
    "summary": "Update a team",
    "permission": "team.invite",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "parent_id",
          "required": false,
          "description": "Parent team id"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteTeam",
    "method": "DELETE",
    "path": "/teams/{id}",
    "resource": "teams",
    "verb": "delete",
    "summary": "Delete a team and its memberships",
    "permission": "team.remove",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "addTeamMember",
    "method": "PUT",
    "path": "/teams/{id}/members/{userId}",
    "resource": "teams",
    "verb": "add-member",
    "summary": "Add a user to a team (idempotent)",
    "permission": "team.invite",
    "positional": [
      "id",
      "userId"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "role",
          "type": "string",
          "required": false,
          "description": "Member role within the team (default member)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "removeTeamMember",
    "method": "DELETE",
    "path": "/teams/{id}/members/{userId}",
    "resource": "teams",
    "verb": "remove-member",
    "summary": "Remove a user from a team",
    "permission": "team.remove",
    "positional": [
      "id",
      "userId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "listInvitations",
    "method": "GET",
    "path": "/invitations",
    "resource": "invitations",
    "verb": "list",
    "summary": "List invitations (pending by default)",
    "permission": "team.invite",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "status",
        "flag": "status",
        "description": "pending (default) or all",
        "required": false,
        "type": "string",
        "enum": [
          "pending",
          "all"
        ]
      }
    ],
    "body": null,
    "listKey": "invitations",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "sendInvitation",
    "method": "POST",
    "path": "/invitations",
    "resource": "invitations",
    "verb": "send",
    "summary": "Invite someone to the workspace by email",
    "permission": "team.invite",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "email",
          "type": "string",
          "required": true
        },
        {
          "name": "role",
          "type": "string",
          "required": false,
          "description": "Workspace role granted on acceptance"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "revokeInvitation",
    "method": "DELETE",
    "path": "/invitations/{id}",
    "resource": "invitations",
    "verb": "revoke",
    "summary": "Revoke an invitation (its link stops working)",
    "permission": "team.invite",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "resendInvitation",
    "method": "POST",
    "path": "/invitations/{id}/resend",
    "resource": "invitations",
    "verb": "resend",
    "summary": "Email a pending invitation again with a fresh link and expiry",
    "permission": "team.invite",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listAuditLog",
    "method": "GET",
    "path": "/audit-log",
    "resource": "audit-log",
    "verb": "list",
    "summary": "Query the object audit log (newest first)",
    "permission": "settings.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "object_type",
        "flag": "object-type",
        "description": "e.g. workflow, role, api_key, webhook",
        "required": false,
        "type": "string"
      },
      {
        "name": "object_id",
        "flag": "object-id",
        "required": false,
        "type": "string"
      },
      {
        "name": "actor_id",
        "flag": "actor-id",
        "description": "User id of the actor",
        "required": false,
        "type": "string"
      },
      {
        "name": "action",
        "flag": "action",
        "description": "e.g. create, update, delete, grant, revoke",
        "required": false,
        "type": "string"
      },
      {
        "name": "from",
        "flag": "from",
        "description": "ISO timestamp: events at or after",
        "required": false,
        "type": "string"
      },
      {
        "name": "to",
        "flag": "to",
        "description": "ISO timestamp: events at or before",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "events",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWorkspaceTheme",
    "method": "GET",
    "path": "/workspace-theme",
    "resource": "workspace-theme",
    "verb": "get",
    "summary": "Get the workspace theme (any member)",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateWorkspaceTheme",
    "method": "PUT",
    "path": "/workspace-theme",
    "resource": "workspace-theme",
    "verb": "update",
    "summary": "Replace the workspace theme",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "meta",
          "type": "object",
          "required": true
        },
        {
          "name": "colors",
          "type": "object",
          "required": true
        },
        {
          "name": "typography",
          "type": "object",
          "required": true
        },
        {
          "name": "shape",
          "type": "object",
          "required": true
        },
        {
          "name": "shadows",
          "type": "object",
          "required": true
        },
        {
          "name": "layout",
          "type": "object",
          "required": true
        },
        {
          "name": "chrome",
          "type": "object",
          "required": true
        },
        {
          "name": "branding",
          "type": "object",
          "required": true
        },
        {
          "name": "expected_version",
          "type": "integer",
          "required": false,
          "description": "Optimistic check: refuse with 409 unless the stored version still equals this (0 = never saved)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "applyWorkspaceThemePreset",
    "method": "POST",
    "path": "/workspace-theme/apply-preset",
    "resource": "workspace-theme",
    "verb": "apply-preset",
    "summary": "Replace the workspace theme with a built-in template",
    "permission": "settings.edit",
    "positional": [],
    "bodyPositional": [
      "preset_id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "preset_id",
          "type": "string",
          "required": true,
          "description": "Template id from GET /workspace-theme/presets"
        },
        {
          "name": "expected_version",
          "type": "integer",
          "required": false,
          "description": "Optimistic check: refuse with 409 unless the stored version still equals this (0 = never saved)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listWorkspaceThemePresets",
    "method": "GET",
    "path": "/workspace-theme/presets",
    "resource": "workspace-theme",
    "verb": "presets",
    "summary": "List the built-in theme templates",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "presets",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "uploadWorkspaceThemeFont",
    "method": "POST",
    "path": "/workspace-theme/fonts",
    "resource": "workspace-theme",
    "verb": "upload-font",
    "summary": "Upload a woff2 font for the workspace theme",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "file_name",
          "type": "string",
          "required": true,
          "description": "Original file name; must end in .woff2"
        },
        {
          "name": "content_base64",
          "type": "string",
          "required": true,
          "description": "The woff2 file, base64-encoded (at most 1 MB decoded)"
        },
        {
          "name": "family",
          "type": "string",
          "required": false,
          "description": "CSS family name to register (letters, digits, spaces, hyphens); derived from the file name when omitted"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listApiKeys",
    "method": "GET",
    "path": "/api-keys",
    "resource": "api-keys",
    "verb": "list",
    "summary": "List API keys (never the key itself)",
    "permission": "settings.manage_api_keys",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "include_revoked",
        "flag": "include-revoked",
        "description": "Include revoked keys (default true)",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "api_keys",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createApiKey",
    "method": "POST",
    "path": "/api-keys",
    "resource": "api-keys",
    "verb": "create",
    "summary": "Create an API key (the key is shown once)",
    "permission": "settings.manage_api_keys",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "key_type",
          "type": "string",
          "required": false,
          "description": "tenant (workspace-wide) or user (acts as user_id); default tenant, or user for user-context callers"
        },
        {
          "name": "user_id",
          "type": "string",
          "required": false,
          "description": "User a user-context key acts as (default: the calling user)"
        },
        {
          "name": "permissions",
          "type": "array",
          "required": false,
          "description": "Permission keys for the key (subset of the caller's; omit to inherit)"
        },
        {
          "name": "workflow_ids",
          "type": "array",
          "required": false,
          "description": "Restrict the key to these workflows"
        },
        {
          "name": "table_ids",
          "type": "array",
          "required": false,
          "description": "Restrict the key to these data tables"
        },
        {
          "name": "expires_in_days",
          "type": "integer",
          "required": false,
          "description": "Days until expiry (required, at most 90, for OAuth callers)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "revokeApiKey",
    "method": "POST",
    "path": "/api-keys/{id}/revoke",
    "resource": "api-keys",
    "verb": "revoke",
    "summary": "Revoke an API key (kept for history, stops authenticating)",
    "permission": "settings.manage_api_keys",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "deleteApiKey",
    "method": "DELETE",
    "path": "/api-keys/{id}",
    "resource": "api-keys",
    "verb": "delete",
    "summary": "Delete an API key",
    "permission": "settings.manage_api_keys",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "listWorkflowWebhooks",
    "method": "GET",
    "path": "/workflows/{id}/webhooks",
    "resource": "webhooks",
    "verb": "list",
    "summary": "List the inbound webhooks of a workflow (secrets are never returned)",
    "permission": "settings.manage_webhooks",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "webhooks",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createWorkflowWebhook",
    "method": "POST",
    "path": "/workflows/{id}/webhooks",
    "resource": "webhooks",
    "verb": "create",
    "summary": "Create an inbound webhook that triggers the workflow",
    "permission": "settings.manage_webhooks",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "slug",
          "type": "string",
          "required": false,
          "description": "URL slug (?hook=<slug>); generated when omitted"
        },
        {
          "name": "payload_mapping",
          "type": "array",
          "required": false,
          "description": "[{ incoming_field, variable_name, type }] mappings from the payload to workflow variables"
        },
        {
          "name": "is_active",
          "type": "boolean",
          "required": false,
          "description": "Default true"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWebhook",
    "method": "GET",
    "path": "/webhooks/{id}",
    "resource": "webhooks",
    "verb": "get",
    "summary": "Get a webhook (the secret is never returned)",
    "permission": "settings.manage_webhooks",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateWebhook",
    "method": "PATCH",
    "path": "/webhooks/{id}",
    "resource": "webhooks",
    "verb": "update",
    "summary": "Update a webhook slug, payload mapping or active flag",
    "permission": "settings.manage_webhooks",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "slug",
          "type": "string",
          "required": false,
          "description": "New URL slug (callers must switch to the new url)"
        },
        {
          "name": "payload_mapping",
          "type": "array",
          "required": false,
          "description": "Replacement payload mappings"
        },
        {
          "name": "is_active",
          "type": "boolean",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteWebhook",
    "method": "DELETE",
    "path": "/webhooks/{id}",
    "resource": "webhooks",
    "verb": "delete",
    "summary": "Delete a webhook",
    "permission": "settings.manage_webhooks",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "rotateWebhookSecret",
    "method": "POST",
    "path": "/webhooks/{id}/rotate",
    "resource": "webhooks",
    "verb": "rotate",
    "summary": "Replace a webhook secret (the old one stops working)",
    "permission": "settings.manage_webhooks",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getGitHubSyncStatus",
    "method": "GET",
    "path": "/github-sync/status",
    "resource": "github-sync",
    "verb": "status",
    "summary": "Connection status, pending changes and latest run/deployment",
    "permission": "sync.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "commitGitHubSync",
    "method": "POST",
    "path": "/github-sync/commit",
    "resource": "github-sync",
    "verb": "commit",
    "summary": "Commit pending changes to the repository",
    "permission": "sync.manage",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "message",
          "type": "string",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listGitHubSyncRuns",
    "method": "GET",
    "path": "/github-sync/runs",
    "resource": "github-sync",
    "verb": "runs",
    "summary": "List sync runs",
    "permission": "sync.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "status",
        "flag": "status",
        "required": false,
        "type": "string"
      },
      {
        "name": "kind",
        "flag": "kind",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "runs",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "startGitHubSyncRun",
    "method": "POST",
    "path": "/github-sync/runs",
    "resource": "github-sync",
    "verb": "sync",
    "summary": "Enqueue a full, pending-change or scoped sync",
    "permission": "sync.manage",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "kind",
          "type": "string",
          "required": false,
          "description": "Default full_resync"
        },
        {
          "name": "scope",
          "type": "object",
          "required": false
        },
        {
          "name": "message",
          "type": "string",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getGitHubSyncRun",
    "method": "GET",
    "path": "/github-sync/runs/{id}",
    "resource": "github-sync",
    "verb": "run",
    "summary": "Get a sync run",
    "permission": "sync.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deployGitHubSync",
    "method": "POST",
    "path": "/github-sync/deploy",
    "resource": "github-sync",
    "verb": "deploy",
    "summary": "Deploy the repository manifest into this workspace",
    "permission": "sync.deploy",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "dry_run",
          "type": "boolean",
          "required": false
        },
        {
          "name": "commit_sha",
          "type": "string",
          "required": false
        },
        {
          "name": "ref",
          "type": "string",
          "required": false,
          "description": "Branch or ref to resolve when commit_sha is omitted"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listGitHubSyncDeployments",
    "method": "GET",
    "path": "/github-sync/deployments",
    "resource": "github-sync",
    "verb": "deployments",
    "summary": "List deployments",
    "permission": "sync.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "deployments",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getGitHubSyncDeployment",
    "method": "GET",
    "path": "/github-sync/deployments/{id}",
    "resource": "github-sync",
    "verb": "deployment",
    "summary": "Get a deployment",
    "permission": "sync.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getGitHubSyncSchedule",
    "method": "GET",
    "path": "/github-sync/schedule",
    "resource": "github-sync",
    "verb": "schedule",
    "summary": "Get the scheduled sync configuration",
    "permission": "sync.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "setGitHubSyncSchedule",
    "method": "PUT",
    "path": "/github-sync/schedule",
    "resource": "github-sync",
    "verb": "set-schedule",
    "summary": "Set the scheduled sync configuration",
    "permission": "sync.manage",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "schedule",
          "type": "object",
          "required": false,
          "description": "Schedule config (schedule_mode hourly|daily|weekly, time_of_day, day_of_week, minute_of_hour, timezone); may also be sent at the top level"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteGitHubSyncSchedule",
    "method": "DELETE",
    "path": "/github-sync/schedule",
    "resource": "github-sync",
    "verb": "unschedule",
    "summary": "Disable scheduled sync",
    "permission": "sync.manage",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "listDirectoryConnections",
    "method": "GET",
    "path": "/directory-sync/connections",
    "resource": "directory-sync",
    "verb": "list",
    "summary": "List directory connections (Entra ID, Okta, LDAP, Google Workspace, SCIM) with sync state",
    "permission": "settings.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "connections",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createDirectoryConnection",
    "method": "POST",
    "path": "/directory-sync/connections",
    "resource": "directory-sync",
    "verb": "connect",
    "summary": "Connect a directory (the connection is verified before it is saved)",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "provider",
          "type": "string",
          "required": true
        },
        {
          "name": "settings",
          "type": "object",
          "required": false,
          "description": "Provider settings: ldap { url, start_tls?, ca_cert?, tls_reject_unauthorized?, tls_server_name?, bind_dn, base_dn, user_base_dn?, group_base_dn?, flavor? (active_directory|openldap|generic), user_filter?, group_filter?, attributes? { id, username, email, display_name, first_name, last_name, group_name, group_description, member }, nested_groups?, page_size?, timeout_ms?, deprovision_missing?, bind_login?, login_attributes? }; google { admin_email, customer?, domain?, user_query?, deprovision_missing? }; scim { rate_limit_per_minute? }; every pull provider: sync_interval_minutes? (default 60, minimum 10)"
        },
        {
          "name": "credentials",
          "type": "object",
          "required": false,
          "description": "Secrets: entra { tenant_id, client_id, client_secret }; okta { org_url, api_token }; ldap { bind_password }; google { service_account_json }; scim: none (use SCIM tokens). Write-only: reads show __SECRET__; values may be secret://tenants/<workspace id>/<name>"
        },
        {
          "name": "sync_groups",
          "type": "boolean",
          "required": false,
          "description": "Directory groups become teams (default true)"
        },
        {
          "name": "auto_provision",
          "type": "boolean",
          "required": false,
          "description": "Create accounts for directory users without one (default true)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getDirectoryConnection",
    "method": "GET",
    "path": "/directory-sync/connections/{provider}",
    "resource": "directory-sync",
    "verb": "get",
    "summary": "Get a directory connection (credentials masked)",
    "permission": "settings.view",
    "positional": [
      "provider"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateDirectoryConnection",
    "method": "PATCH",
    "path": "/directory-sync/connections/{provider}",
    "resource": "directory-sync",
    "verb": "update",
    "summary": "Update a directory connection (re-verified when settings or credentials change)",
    "permission": "settings.edit",
    "positional": [
      "provider"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "provider",
          "type": "string",
          "required": false,
          "description": "Cannot change; accepted so a fetched connection can be sent back"
        },
        {
          "name": "settings",
          "type": "object",
          "required": false,
          "description": "Merged over the stored settings (null removes a key)"
        },
        {
          "name": "credentials",
          "type": "object",
          "required": false,
          "description": "Merged over the stored credentials; __SECRET__ keeps a value"
        },
        {
          "name": "sync_groups",
          "type": "boolean",
          "required": false
        },
        {
          "name": "auto_provision",
          "type": "boolean",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteDirectoryConnection",
    "method": "DELETE",
    "path": "/directory-sync/connections/{provider}",
    "resource": "directory-sync",
    "verb": "disconnect",
    "summary": "Disconnect a directory: syncing stops and credentials are removed (SCIM: every token is revoked). Links and accounts are kept.",
    "permission": "settings.edit",
    "positional": [
      "provider"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "testDirectoryConnection",
    "method": "POST",
    "path": "/directory-sync/connections/{provider}/test",
    "resource": "directory-sync",
    "verb": "test",
    "summary": "Test a directory connection (optionally with unsaved settings/credentials)",
    "permission": "settings.edit",
    "positional": [
      "provider"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "settings",
          "type": "object",
          "required": false,
          "description": "Try these settings (merged over the stored ones) without saving"
        },
        {
          "name": "credentials",
          "type": "object",
          "required": false,
          "description": "Try these credentials (merged over the stored ones) without saving"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "startDirectorySync",
    "method": "POST",
    "path": "/directory-sync/connections/{provider}/sync",
    "resource": "directory-sync",
    "verb": "sync",
    "summary": "Start a sync run now (runs in the background)",
    "permission": "settings.edit",
    "positional": [
      "provider"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "full",
          "type": "boolean",
          "required": false,
          "description": "Force a full sync (LDAP otherwise syncs only changes since the last run)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listDirectorySyncRuns",
    "method": "GET",
    "path": "/directory-sync/runs",
    "resource": "directory-sync",
    "verb": "runs",
    "summary": "List directory sync runs, newest first",
    "permission": "settings.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "provider",
        "flag": "provider",
        "required": false,
        "type": "string",
        "enum": [
          "entra",
          "okta",
          "ldap",
          "google"
        ]
      }
    ],
    "body": null,
    "listKey": "runs",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listScimTokens",
    "method": "GET",
    "path": "/directory-sync/scim-tokens",
    "resource": "scim-tokens",
    "verb": "list",
    "summary": "List SCIM tokens (never the tokens themselves)",
    "permission": "settings.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "scim_tokens",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createScimToken",
    "method": "POST",
    "path": "/directory-sync/scim-tokens",
    "resource": "scim-tokens",
    "verb": "create",
    "summary": "Create a SCIM token for the identity provider (shown once); enables SCIM provisioning",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true,
          "description": "Label, e.g. \"Entra ID provisioning\""
        },
        {
          "name": "scopes",
          "type": "array",
          "required": false,
          "description": "Default all four"
        },
        {
          "name": "expires_in_days",
          "type": "integer",
          "required": false,
          "description": "Default: never expires"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteScimToken",
    "method": "DELETE",
    "path": "/directory-sync/scim-tokens/{id}",
    "resource": "scim-tokens",
    "verb": "delete",
    "summary": "Revoke and delete a SCIM token",
    "permission": "settings.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "rotateScimToken",
    "method": "POST",
    "path": "/directory-sync/scim-tokens/{id}/rotate",
    "resource": "scim-tokens",
    "verb": "rotate",
    "summary": "Replace a SCIM token with a new one (same name and scopes); the old one stops working now or after grace_minutes",
    "permission": "settings.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "grace_minutes",
          "type": "integer",
          "required": false,
          "description": "Keep the old token working this long (default 0: revoked now)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listPackages",
    "method": "GET",
    "path": "/packages",
    "resource": "packages",
    "verb": "list",
    "summary": "List packages authored in this workspace",
    "permission": "packages.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "packages",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createPackage",
    "method": "POST",
    "path": "/packages",
    "resource": "packages",
    "verb": "create",
    "summary": "Create a package from root artifacts (dependencies are included automatically)",
    "permission": "packages.manage",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true
        },
        {
          "name": "slug",
          "type": "string",
          "required": false,
          "description": "Default: from the name"
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "author",
          "required": false
        },
        {
          "name": "icon",
          "required": false
        },
        {
          "name": "readme",
          "required": false,
          "description": "Markdown shown before install"
        },
        {
          "name": "roots",
          "type": "array",
          "required": true,
          "description": "Root artifacts (e.g. a workflow); everything they use is added automatically"
        },
        {
          "name": "items",
          "type": "array",
          "required": false,
          "description": "Extra artifacts added by hand"
        },
        {
          "name": "excluded",
          "type": "array",
          "required": false,
          "description": "Auto-included artifacts to leave out"
        },
        {
          "name": "data_modes",
          "type": "object",
          "required": false,
          "description": "Per data table id: \"schema\" (default) or \"rows\" (schema + rows, at most 10,000)"
        },
        {
          "name": "package_uid",
          "type": "string",
          "required": false,
          "description": "Re-create a package with an existing identity (another workspace)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "previewPackage",
    "method": "POST",
    "path": "/packages/preview",
    "resource": "packages",
    "verb": "preview",
    "summary": "Preview what a package of these roots would contain (dependencies and requirements)",
    "permission": "packages.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "roots",
          "type": "array",
          "required": true
        },
        {
          "name": "items",
          "type": "array",
          "required": false
        },
        {
          "name": "excluded",
          "type": "array",
          "required": false
        },
        {
          "name": "data_modes",
          "type": "object",
          "required": false,
          "description": "Per data table id: \"schema\" (default) or \"rows\" (schema + rows, at most 10,000)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "searchPackageAssets",
    "method": "GET",
    "path": "/packages/assets",
    "resource": "packages",
    "verb": "assets",
    "summary": "Search the assets a package can contain (every type, paged, with counts)",
    "permission": "packages.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Case-insensitive substring of the name or description (integrations: also their reference names)",
        "required": false,
        "type": "string"
      },
      {
        "name": "type",
        "flag": "type",
        "description": "Asset types: workflow, workflow_activity, data_table, integration, connector, decision_table, email_template, agent, report, role, mcp_server, retention_policy, log_destination, form, form_theme (default every type you may view) (comma-separated)",
        "required": false,
        "type": "string"
      },
      {
        "name": "tag",
        "flag": "tag",
        "description": "Tag (workflows, custom steps, integrations, agents) or report category",
        "required": false,
        "type": "string"
      },
      {
        "name": "owner",
        "flag": "owner",
        "description": "Created by: user id or \"me\"",
        "required": false,
        "type": "string"
      },
      {
        "name": "updated_since",
        "flag": "updated-since",
        "description": "Updated on or after: YYYY-MM-DD, a timestamp, or relative (24h, 7d, 4w)",
        "required": false,
        "type": "string"
      },
      {
        "name": "sort",
        "flag": "sort",
        "description": "name (A–Z, default) or updated (newest first)",
        "required": false,
        "type": "string",
        "enum": [
          "name",
          "updated"
        ]
      },
      {
        "name": "after",
        "flag": "after",
        "description": "Cursor: the previous page's next_cursor",
        "required": false,
        "type": "string"
      },
      {
        "name": "package",
        "flag": "package",
        "description": "Package id or slug: mark each asset as in that package (in_package)",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "assets",
    "paginated": false,
    "cursor": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getPackage",
    "method": "GET",
    "path": "/packages/{id}",
    "resource": "packages",
    "verb": "get",
    "summary": "Get a package and its recent versions",
    "permission": "packages.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updatePackage",
    "method": "PATCH",
    "path": "/packages/{id}",
    "resource": "packages",
    "verb": "update",
    "summary": "Update a package (metadata, items, data modes)",
    "permission": "packages.manage",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "slug",
          "type": "string",
          "required": false
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "author",
          "required": false
        },
        {
          "name": "icon",
          "required": false
        },
        {
          "name": "readme",
          "required": false
        },
        {
          "name": "roots",
          "type": "array",
          "required": false
        },
        {
          "name": "items",
          "type": "array",
          "required": false
        },
        {
          "name": "excluded",
          "type": "array",
          "required": false
        },
        {
          "name": "add",
          "type": "array",
          "required": false,
          "description": "Add artifacts (and their dependencies)"
        },
        {
          "name": "remove",
          "type": "array",
          "required": false,
          "description": "Leave artifacts out"
        },
        {
          "name": "data_modes",
          "type": "object",
          "required": false,
          "description": "Merged over the stored modes"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deletePackage",
    "method": "DELETE",
    "path": "/packages/{id}",
    "resource": "packages",
    "verb": "delete",
    "summary": "Delete a package and its built versions (installs elsewhere are unaffected)",
    "permission": "packages.manage",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "getPackageContents",
    "method": "GET",
    "path": "/packages/{id}/contents",
    "resource": "packages",
    "verb": "contents",
    "summary": "What the package contains now: artifacts (and why), data modes, requirements",
    "permission": "packages.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listPackageVersions",
    "method": "GET",
    "path": "/packages/{id}/versions",
    "resource": "packages",
    "verb": "versions",
    "summary": "List built versions of a package",
    "permission": "packages.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "versions",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getPackageVersion",
    "method": "GET",
    "path": "/packages/{id}/versions/{versionId}",
    "resource": "packages",
    "verb": "version",
    "summary": "Get a built version (its manifest: requirements, files, checksum, signature)",
    "permission": "packages.view",
    "positional": [
      "id",
      "versionId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listPackageInstalls",
    "method": "GET",
    "path": "/package-installs",
    "resource": "package-installs",
    "verb": "list",
    "summary": "The package library: installed packages with version, source and status",
    "permission": "packages.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "installs",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getPackageInstall",
    "method": "GET",
    "path": "/package-installs/{id}",
    "resource": "package-installs",
    "verb": "get",
    "summary": "An installed package: requirement checklist and installed assets",
    "permission": "packages.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listPackageEvents",
    "method": "GET",
    "path": "/package-events",
    "resource": "package-events",
    "verb": "list",
    "summary": "Package history: every install, upgrade, reconfigure (complete setup) and uninstall, failed attempts included (newest first)",
    "permission": "packages.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "package",
        "flag": "package",
        "description": "Install id, package id (uid) or package slug",
        "required": false,
        "type": "string"
      },
      {
        "name": "action",
        "flag": "action",
        "description": "install, upgrade, reinstall, downgrade, reconfigure, uninstall (comma-separated)",
        "required": false,
        "type": "string"
      },
      {
        "name": "status",
        "flag": "status",
        "description": "succeeded, partial, failed (comma-separated)",
        "required": false,
        "type": "string"
      },
      {
        "name": "channel",
        "flag": "channel",
        "description": "ui, cli, api, mcp (comma-separated)",
        "required": false,
        "type": "string"
      },
      {
        "name": "actor",
        "flag": "actor",
        "description": "User id or email",
        "required": false,
        "type": "string"
      },
      {
        "name": "since",
        "flag": "since",
        "description": "From this date (YYYY-MM-DD) or timestamp",
        "required": false,
        "type": "string"
      },
      {
        "name": "until",
        "flag": "until",
        "description": "Up to and including this date (YYYY-MM-DD) or timestamp",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "events",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getPackageEvent",
    "method": "GET",
    "path": "/package-events/{id}",
    "resource": "package-events",
    "verb": "get",
    "summary": "One package history event with the full plan / diff that was applied (secrets masked)",
    "permission": "packages.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listJobs",
    "method": "GET",
    "path": "/jobs",
    "resource": "jobs",
    "verb": "list",
    "summary": "List background jobs",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "status",
        "flag": "status",
        "description": "Only these statuses: queued, running, succeeded, failed, cancelled (comma-separated)",
        "required": false,
        "type": "string"
      },
      {
        "name": "active",
        "flag": "active",
        "description": "true: only queued or running jobs",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "scope",
        "flag": "scope",
        "description": "mine (default) or tenant (admins)",
        "required": false,
        "type": "string",
        "enum": [
          "mine",
          "tenant"
        ]
      }
    ],
    "body": null,
    "listKey": "jobs",
    "paginated": false,
    "cursor": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getJob",
    "method": "GET",
    "path": "/jobs/{id}",
    "resource": "jobs",
    "verb": "get",
    "summary": "Get a background job (status, progress, result summary)",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "cancelJob",
    "method": "POST",
    "path": "/jobs/{id}/cancel",
    "resource": "jobs",
    "verb": "cancel",
    "summary": "Cancel a queued or running job",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "retryJob",
    "method": "POST",
    "path": "/jobs/{id}/retry",
    "resource": "jobs",
    "verb": "retry",
    "summary": "Start a failed or cancelled job again",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getJobResult",
    "method": "GET",
    "path": "/jobs/{id}/result",
    "resource": "jobs",
    "verb": "result",
    "summary": "The JSON result of a finished job",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listEvents",
    "method": "GET",
    "path": "/events",
    "resource": "events",
    "verb": "list",
    "summary": "List events from the unified event stream (oldest first, cursor paged)",
    "permission": "observability.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "category",
        "flag": "category",
        "description": "Categories (comma-separated): workflow, integration, agent, audit, security, task, system. audit and security also need settings.view",
        "required": false,
        "type": "string"
      },
      {
        "name": "type",
        "flag": "type",
        "description": "Event types or globs (comma-separated), e.g. workflow.* or *.failed",
        "required": false,
        "type": "string"
      },
      {
        "name": "severity",
        "flag": "severity",
        "description": "Minimum severity",
        "required": false,
        "type": "string",
        "enum": [
          "debug",
          "info",
          "warn",
          "error"
        ]
      },
      {
        "name": "workflow_id",
        "flag": "workflow-id",
        "description": "Only events of this workflow",
        "required": false,
        "type": "string"
      },
      {
        "name": "run_id",
        "flag": "run-id",
        "description": "Only events of this workflow run",
        "required": false,
        "type": "string"
      },
      {
        "name": "task_id",
        "flag": "task-id",
        "description": "Only events of this task",
        "required": false,
        "type": "string"
      },
      {
        "name": "trace_id",
        "flag": "trace-id",
        "description": "Only events with this trace id",
        "required": false,
        "type": "string"
      },
      {
        "name": "since",
        "flag": "since",
        "description": "ISO timestamp or a duration back from now (30s, 15m, 1h, 2d, 1w)",
        "required": false,
        "type": "string"
      },
      {
        "name": "after",
        "flag": "after",
        "description": "Cursor: only events after this id (the previous next_cursor)",
        "required": false,
        "type": "string"
      },
      {
        "name": "until",
        "flag": "until",
        "description": "ISO timestamp or duration: only events at or before",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "events",
    "paginated": false,
    "cursor": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listLogDestinations",
    "method": "GET",
    "path": "/log-destinations",
    "resource": "log-destinations",
    "verb": "list",
    "summary": "List log export destinations (credentials masked)",
    "permission": "observability.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "log_destinations",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createLogDestination",
    "method": "POST",
    "path": "/log-destinations",
    "resource": "log-destinations",
    "verb": "create",
    "summary": "Create a log export destination (Splunk HEC, Datadog, OTLP/HTTP, webhook, syslog, Azure Monitor, Event Hubs, Cloud Logging, Pub/Sub, CloudWatch Logs)",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": true,
          "description": "Unique name within the workspace"
        },
        {
          "name": "type",
          "type": "string",
          "required": true,
          "description": "Destination type: splunk_hec, datadog, otlp_http, webhook, syslog, azure_monitor, azure_event_hubs, gcp_logging, gcp_pubsub, aws_cloudwatch_logs"
        },
        {
          "name": "config",
          "type": "object",
          "required": true,
          "description": "Type-specific settings: splunk_hec { url, index?, sourcetype?, source?, host?, verify_tls? }; datadog { site?, service?, tags? }; otlp_http { endpoint, resource_attributes? }; webhook { url }; syslog { host, port?, transport? (tls|tcp|udp), framing?, facility?, app_name?, hostname?, tls_servername? }; azure_monitor { endpoint, dcr_immutable_id, stream_name, auth?, tenant_id?, client_id?, cloud? }; azure_event_hubs { namespace, event_hub, auth? (sas|client_secret|managed_identity), sas_key_name?, tenant_id?, client_id?, cloud? }; gcp_logging { project_id, log_id?, resource_type?, labels?, auth? }; gcp_pubsub { project_id, topic, attributes?, ordering_key?, auth? }; aws_cloudwatch_logs { region, log_group_name, log_stream_name?, auto_create?, auth? (access_key|instance_role) }"
        },
        {
          "name": "credentials",
          "type": "object",
          "required": false,
          "description": "Secrets: splunk_hec { token }; datadog { api_key }; otlp_http { headers? }; webhook { signing_secret?, headers? }; syslog { client_cert?, client_key? }; azure_monitor { client_secret? }; azure_event_hubs { sas_key? | client_secret? }; gcp_logging / gcp_pubsub { service_account_json? }; aws_cloudwatch_logs { access_key_id?, secret_access_key? }. Never returned: reads show __SECRET__, and __SECRET__ on update keeps the stored value"
        },
        {
          "name": "filters",
          "type": "object",
          "required": false,
          "description": "{ categories?, types? (globs), min_severity?, workflow_ids? }; default every event"
        },
        {
          "name": "enabled",
          "type": "boolean",
          "required": false,
          "description": "Default true"
        },
        {
          "name": "start_from",
          "type": "string",
          "required": false,
          "description": "now (default): only events from now on; retention_start: everything still retained"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getLogDestination",
    "method": "GET",
    "path": "/log-destinations/{id}",
    "resource": "log-destinations",
    "verb": "get",
    "summary": "Get a log export destination (credentials masked)",
    "permission": "observability.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateLogDestination",
    "method": "PATCH",
    "path": "/log-destinations/{id}",
    "resource": "log-destinations",
    "verb": "update",
    "summary": "Update a log export destination",
    "permission": "settings.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "name",
          "type": "string",
          "required": false
        },
        {
          "name": "type",
          "type": "string",
          "required": false,
          "description": "Cannot change; accepted so a fetched destination can be sent back"
        },
        {
          "name": "config",
          "type": "object",
          "required": false,
          "description": "Merged over the stored config (null removes a key)"
        },
        {
          "name": "credentials",
          "type": "object",
          "required": false,
          "description": "Merged over the stored credentials; __SECRET__ keeps a value, null removes it"
        },
        {
          "name": "filters",
          "type": "object",
          "required": false,
          "description": "Replaces the filters"
        },
        {
          "name": "enabled",
          "type": "boolean",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteLogDestination",
    "method": "DELETE",
    "path": "/log-destinations/{id}",
    "resource": "log-destinations",
    "verb": "delete",
    "summary": "Delete a log export destination",
    "permission": "settings.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "resetLogDestinationCursor",
    "method": "POST",
    "path": "/log-destinations/{id}/reset-cursor",
    "resource": "log-destinations",
    "verb": "reset-cursor",
    "summary": "Move a destination's cursor to now or to the start of retention",
    "permission": "settings.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "from",
          "type": "string",
          "required": true,
          "description": "now: skip everything not yet shipped; retention_start: re-send everything still retained"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getLogDestinationStatus",
    "method": "GET",
    "path": "/log-destinations/{id}/status",
    "resource": "log-destinations",
    "verb": "status",
    "summary": "Delivery status of a destination: lag, last success and last error",
    "permission": "observability.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "testLogDestination",
    "method": "POST",
    "path": "/log-destinations/{id}/test",
    "resource": "log-destinations",
    "verb": "test",
    "summary": "Send one synthetic system.test event through the destination's formatter and connection",
    "permission": "settings.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  }
]
