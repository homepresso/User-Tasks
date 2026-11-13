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
    "operationId": "getHomeMetrics",
    "method": "GET",
    "path": "/home/metrics",
    "resource": "home",
    "verb": "metrics",
    "summary": "The Home cards: my tasks, my submissions in progress, runs I follow",
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
    "operationId": "getHomeStats",
    "method": "GET",
    "path": "/home/stats",
    "resource": "home",
    "verb": "stats",
    "summary": "My activity over 7, 30 or 90 days: tasks completed, decisions, durations, on time, submissions",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "period",
        "flag": "period",
        "description": "7d, 30d (default) or 90d",
        "required": false,
        "type": "string",
        "enum": [
          "7d",
          "30d",
          "90d"
        ]
      },
      {
        "name": "timezone",
        "flag": "timezone",
        "description": "IANA time zone for day / week buckets, e.g. Pacific/Auckland",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listMyHomeTasks",
    "method": "GET",
    "path": "/home/tasks",
    "resource": "home",
    "verb": "tasks",
    "summary": "My open tasks with their process and stage",
    "permission": "tasks.view_own",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Title contains",
        "required": false,
        "type": "string"
      },
      {
        "name": "sort",
        "flag": "sort",
        "description": "due (default, soonest first), priority, newest",
        "required": false,
        "type": "string",
        "enum": [
          "due",
          "priority",
          "newest"
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
    "operationId": "listHomeQueue",
    "method": "GET",
    "path": "/home/queue",
    "resource": "home",
    "verb": "queue",
    "summary": "Tasks I can take: waiting for my acceptance, or unassigned in my teams",
    "permission": "tasks.view_own",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Title contains",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "tasks",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listMySubmissions",
    "method": "GET",
    "path": "/home/submissions",
    "resource": "home",
    "verb": "submissions",
    "summary": "Forms I submitted, with the process each one started and where it is now",
    "permission": "forms.submit",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Form or process name contains",
        "required": false,
        "type": "string"
      },
      {
        "name": "status",
        "flag": "status",
        "description": "all (default), active (running, waiting or starting), completed, failed (failed or cancelled)",
        "required": false,
        "type": "string",
        "enum": [
          "all",
          "active",
          "completed",
          "failed"
        ]
      }
    ],
    "body": null,
    "listKey": "submissions",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getRunProgress",
    "method": "GET",
    "path": "/home/runs/{id}/progress",
    "resource": "home",
    "verb": "progress",
    "summary": "A run's progress (the submitter-safe flow view)",
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
    "operationId": "listFollowedRuns",
    "method": "GET",
    "path": "/home/following",
    "resource": "home",
    "verb": "following",
    "summary": "Workflow runs I follow, with where they are and who has them",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Process name or run title contains",
        "required": false,
        "type": "string"
      },
      {
        "name": "status",
        "flag": "status",
        "description": "all (default), active (running, waiting or starting), completed, failed (failed or cancelled)",
        "required": false,
        "type": "string",
        "enum": [
          "all",
          "active",
          "completed",
          "failed"
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
    "operationId": "followRun",
    "method": "PUT",
    "path": "/home/following/{id}",
    "resource": "home",
    "verb": "follow",
    "summary": "Follow a workflow run",
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
    "operationId": "unfollowRun",
    "method": "DELETE",
    "path": "/home/following/{id}",
    "resource": "home",
    "verb": "unfollow",
    "summary": "Stop following a workflow run",
    "permission": null,
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
    "operationId": "listFavoriteForms",
    "method": "GET",
    "path": "/home/favorite-forms",
    "resource": "home",
    "verb": "favorites",
    "summary": "My favourite forms (that I can still open), alphabetical",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "forms",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "favoriteForm",
    "method": "PUT",
    "path": "/home/favorite-forms/{id}",
    "resource": "home",
    "verb": "favorite",
    "summary": "Star a form",
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
    "operationId": "unfavoriteForm",
    "method": "DELETE",
    "path": "/home/favorite-forms/{id}",
    "resource": "home",
    "verb": "unfavorite",
    "summary": "Unstar a form",
    "permission": null,
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
    "operationId": "getHomePreferences",
    "method": "GET",
    "path": "/home/preferences",
    "resource": "home",
    "verb": "preferences",
    "summary": "My Home preferences (auto-follow)",
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
    "operationId": "updateHomePreferences",
    "method": "PATCH",
    "path": "/home/preferences",
    "resource": "home",
    "verb": "set-preferences",
    "summary": "Change my Home preferences",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "auto_follow_runs",
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
    "operationId": "getHomeLayout",
    "method": "GET",
    "path": "/home/layout",
    "resource": "home",
    "verb": "layout",
    "summary": "My Home layout in this workspace: widget order, sizes and hidden widgets",
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
    "operationId": "updateHomeLayout",
    "method": "PUT",
    "path": "/home/layout",
    "resource": "home",
    "verb": "set-layout",
    "summary": "Save my Home layout in this workspace",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "items",
          "type": "array",
          "required": true,
          "description": "Visible widgets in reading order"
        },
        {
          "name": "hidden",
          "type": "array",
          "required": false,
          "description": "Widgets to hide"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "resetHomeLayout",
    "method": "DELETE",
    "path": "/home/layout",
    "resource": "home",
    "verb": "reset-layout",
    "summary": "Reset my Home layout in this workspace to the default",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "claimTask",
    "method": "POST",
    "path": "/tasks/{id}/claim",
    "resource": "tasks",
    "verb": "claim",
    "summary": "Claim an unassigned team task (a member of its team becomes its assignee)",
    "permission": "tasks.complete",
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
    "permission": "workflows.view_queue",
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
    "summary": "Get a workflow run with its logs and User Tasks",
    "permission": "workflows.view_queue",
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
    "permission": "workflows.view_queue",
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
    "permission": "workflows.view_queue",
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
        },
        {
          "name": "resolve",
          "type": "array",
          "required": false,
          "description": "Resolve these stored values to their items (display labels) instead of searching — same source, filters and permissions as a search"
        },
        {
          "name": "variables",
          "type": "object",
          "required": false,
          "description": "The form's variables by name ({{var.<name>}}): declared names only, typed and size-bounded; initial values fill the rest"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "queryTaskDataTable",
    "method": "POST",
    "path": "/tasks/{id}/data-table",
    "resource": "tasks",
    "verb": "data-table",
    "summary": "Rows of a Data table field of an open task (search, filters, sort, page)",
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
          "description": "Key of a Data table field of the form"
        },
        {
          "name": "query",
          "type": "object",
          "required": false
        },
        {
          "name": "values",
          "type": "object",
          "required": false,
          "description": "The form's current values, for {{form.<key>}} in the base filter / API inputs"
        },
        {
          "name": "params",
          "type": "object",
          "required": false,
          "description": "Reusable forms: the form's parameters by name ({{param.<name>}} in the base filter / API inputs), re-validated against the declarations; a task form uses the parameters its workflow step passed and ignores these"
        },
        {
          "name": "variables",
          "type": "object",
          "required": false,
          "description": "The form's variables by name ({{var.<name>}}): declared names only, typed and size-bounded; initial values fill the rest"
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
    "operationId": "listTaskAttachments",
    "method": "GET",
    "path": "/tasks/{id}/attachments",
    "resource": "tasks",
    "verb": "attachments",
    "summary": "List a task's attachments",
    "permission": "tasks.view_own",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "attachments",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "addTaskAttachment",
    "method": "POST",
    "path": "/tasks/{id}/attachments",
    "resource": "tasks",
    "verb": "attachment-add",
    "summary": "Attach a file to a task (or start a direct upload)",
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
          "name": "file_name",
          "type": "string",
          "required": true,
          "description": "File name (its extension must be an allowed type)"
        },
        {
          "name": "name",
          "type": "string",
          "required": false,
          "description": "Display name (default: the file name without its extension)"
        },
        {
          "name": "type",
          "type": "string",
          "required": false,
          "description": "Type, free text (default Other). Suggested: Contract, Invoice, Receipt, Evidence, Image, Other"
        },
        {
          "name": "description",
          "type": "string",
          "required": false,
          "description": "Description"
        },
        {
          "name": "size",
          "type": "integer",
          "required": false,
          "description": "Size in bytes: without content_base64, starts a direct upload to storage"
        },
        {
          "name": "content_base64",
          "type": "string",
          "required": false,
          "description": "The file itself, base64 (small files; the request body limit applies). Omit to get a signed upload URL"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "completeTaskAttachment",
    "method": "POST",
    "path": "/tasks/{id}/attachments/{attachmentId}/complete",
    "resource": "tasks",
    "verb": "attachment-complete",
    "summary": "Finish a direct upload of a task attachment",
    "permission": "tasks.complete",
    "positional": [
      "id",
      "attachmentId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteTaskAttachment",
    "method": "DELETE",
    "path": "/tasks/{id}/attachments/{attachmentId}",
    "resource": "tasks",
    "verb": "attachment-delete",
    "summary": "Delete a task attachment",
    "permission": "tasks.view_own",
    "positional": [
      "id",
      "attachmentId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "getTaskAttachmentDownloadUrl",
    "method": "GET",
    "path": "/tasks/{id}/attachments/{attachmentId}/download",
    "resource": "tasks",
    "verb": "attachment-download",
    "summary": "A short-lived download link for a task attachment",
    "permission": "tasks.view_own",
    "positional": [
      "id",
      "attachmentId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listFollowedTasks",
    "method": "GET",
    "path": "/tasks/following",
    "resource": "tasks",
    "verb": "following",
    "summary": "Tasks I follow (the Task tracker's Following tab)",
    "permission": "tasks.view_own",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Task name, ID, workflow, people, team, status or priority contains",
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
        "name": "hide_completed",
        "flag": "hide-completed",
        "description": "true: leave out completed and cancelled tasks",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "shared_only",
        "flag": "shared-only",
        "description": "true: only tasks shared with you by an invite (read only)",
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
    "operationId": "followTask",
    "method": "PUT",
    "path": "/tasks/{id}/follow",
    "resource": "tasks",
    "verb": "follow",
    "summary": "Follow a task",
    "permission": "tasks.view_own",
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
    "operationId": "unfollowTask",
    "method": "DELETE",
    "path": "/tasks/{id}/follow",
    "resource": "tasks",
    "verb": "unfollow",
    "summary": "Stop following a task",
    "permission": "tasks.view_own",
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
    "operationId": "listTaskViewers",
    "method": "GET",
    "path": "/tasks/{id}/viewers",
    "resource": "tasks",
    "verb": "viewers",
    "summary": "Who a task is shared with (read only invites)",
    "permission": "tasks.view_own",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "viewers",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "addTaskViewers",
    "method": "POST",
    "path": "/tasks/{id}/viewers",
    "resource": "tasks",
    "verb": "viewers-add",
    "summary": "Invite people, teams or roles to view a task (read only)",
    "permission": "tasks.view_own",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "viewers",
          "type": "array",
          "required": true,
          "description": "People, teams and roles to invite (at most 50)"
        },
        {
          "name": "note",
          "type": "string",
          "required": false,
          "description": "A note for them (shown in the notification)"
        },
        {
          "name": "include_subtasks",
          "type": "boolean",
          "required": false,
          "description": "Also its subtasks (default true)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "removeTaskViewer",
    "method": "DELETE",
    "path": "/tasks/{id}/viewers/{viewerId}",
    "resource": "tasks",
    "verb": "viewers-remove",
    "summary": "Stop sharing a task with a person, team or role",
    "permission": "tasks.view_own",
    "positional": [
      "id",
      "viewerId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "listSubtasks",
    "method": "GET",
    "path": "/tasks/{id}/subtasks",
    "resource": "tasks",
    "verb": "subtasks",
    "summary": "List a task's subtasks",
    "permission": "tasks.view_own",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "subtasks",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "addSubtask",
    "method": "POST",
    "path": "/tasks/{id}/subtasks",
    "resource": "tasks",
    "verb": "add-subtask",
    "summary": "Add a subtask",
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
          "required": true
        },
        {
          "name": "subtitle",
          "required": false,
          "description": "A short summary shown under the title"
        },
        {
          "name": "description",
          "required": false,
          "description": "Plain text or HTML. HTML is sanitised to an allowlist (formatting, lists, headings, links, tables, https images)."
        },
        {
          "name": "estimated_effort_minutes",
          "required": false,
          "description": "Estimate in whole minutes (the unit of actual_effort); stored as the creator's estimate. 0 or null = none"
        },
        {
          "name": "due_date",
          "required": false,
          "description": "ISO 8601 date or date-time (years 2000–2100)"
        },
        {
          "name": "priority",
          "type": "string",
          "required": false,
          "description": "Default: the parent's priority"
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
    "operationId": "updateSubtask",
    "method": "PATCH",
    "path": "/tasks/{id}/subtasks/{subtaskId}",
    "resource": "tasks",
    "verb": "update-subtask",
    "summary": "Edit a subtask",
    "permission": "tasks.complete",
    "positional": [
      "id",
      "subtaskId"
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
          "name": "subtitle",
          "required": false,
          "description": "A short summary shown under the title"
        },
        {
          "name": "description",
          "required": false,
          "description": "Plain text or HTML. HTML is sanitised to an allowlist (formatting, lists, headings, links, tables, https images)."
        },
        {
          "name": "estimated_effort_minutes",
          "required": false,
          "description": "Estimate in whole minutes (the unit of actual_effort); stored as the creator's estimate. 0 or null = none"
        },
        {
          "name": "due_date",
          "required": false,
          "description": "ISO 8601 date or date-time (years 2000–2100)"
        },
        {
          "name": "priority",
          "type": "string",
          "required": false,
          "description": "Default: the parent's priority"
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
    "operationId": "getRunTimeline",
    "method": "GET",
    "path": "/workflows/runs/{id}/timeline",
    "resource": "runs",
    "verb": "timeline",
    "summary": "A run's timeline: who did what and when, in plain words",
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
    "operationId": "getTaskTimeline",
    "method": "GET",
    "path": "/tasks/{id}/timeline",
    "resource": "tasks",
    "verb": "timeline",
    "summary": "A task's timeline: its run's story, or the task's own history",
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
          "required": false,
          "description": "Tool objects: {type:\"builtin\",name} | {type:\"reference\",referenceId} | {type:\"mcp\",mcpServerId,mcpToolName}; add requiresApproval:true to need a person's approval per call"
        },
        {
          "name": "output_config",
          "type": "object",
          "required": false,
          "description": "variables (typed outputs: name, type, required, enum, description), strict_outputs, document_access, data_access {grants: [{table_id, read, insert, update, delete}]} (default: no tables), task_access/task_scope, workflow_access/workflow_scope, knowledge {table_ids, files}, limits {max_run_tokens, max_tool_calls, daily_token_budget, monthly_token_budget, daily_cost_budget, monthly_cost_budget, budget_currency}, approval {tools, assignee_user_id, assignee_team_id}, egress {allowed_hosts}"
        },
        {
          "name": "integration_id",
          "required": false
        },
        {
          "name": "temperature",
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
          "required": false,
          "description": "Tool objects: {type:\"builtin\",name} | {type:\"reference\",referenceId} | {type:\"mcp\",mcpServerId,mcpToolName}; add requiresApproval:true to need a person's approval per call"
        },
        {
          "name": "output_config",
          "type": "object",
          "required": false,
          "description": "variables (typed outputs: name, type, required, enum, description), strict_outputs, document_access, data_access {grants: [{table_id, read, insert, update, delete}]} (default: no tables), task_access/task_scope, workflow_access/workflow_scope, knowledge {table_ids, files}, limits {max_run_tokens, max_tool_calls, daily_token_budget, monthly_token_budget, daily_cost_budget, monthly_cost_budget, budget_currency}, approval {tools, assignee_user_id, assignee_team_id}, egress {allowed_hosts}"
        },
        {
          "name": "integration_id",
          "required": false
        },
        {
          "name": "temperature",
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
    "summary": "Delete an agent (queued; deactivates workflows that reference it)",
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
          "required": false,
          "description": "{ messages, facts } from earlier agents (only user / assistant text is used)"
        },
        {
          "name": "history",
          "type": "array",
          "required": false,
          "description": "Earlier turns of this conversation"
        },
        {
          "name": "async",
          "type": "boolean",
          "required": false,
          "description": "Queue the run and return a job id (202)"
        },
        {
          "name": "stream",
          "type": "boolean",
          "required": false,
          "description": "Stream Server-Sent Events: the reply token by token, then done / error / awaiting_approval"
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
    "operationId": "getAgentQueueJob",
    "method": "GET",
    "path": "/agents/queue/{id}",
    "resource": "agents",
    "verb": "job",
    "summary": "Get a queued agent job (status, result, run id)",
    "permission": "agents.view",
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
    "operationId": "listAgentRuns",
    "method": "GET",
    "path": "/agents/runs",
    "resource": "agents",
    "verb": "runs",
    "summary": "List agent runs (newest first)",
    "permission": "agents.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "agent_id",
        "flag": "agent-id",
        "required": false,
        "type": "string"
      },
      {
        "name": "status",
        "flag": "status",
        "description": "completed | failed | awaiting_approval | running",
        "required": false,
        "type": "string"
      },
      {
        "name": "caller_type",
        "flag": "caller-type",
        "description": "manual | api | queued | workflow_node | eval",
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
    "operationId": "getAgentRun",
    "method": "GET",
    "path": "/agents/runs/{id}",
    "resource": "agents",
    "verb": "run",
    "summary": "Get an agent run with its step trace (LLM calls, tool calls, tokens, latency)",
    "permission": "agents.view",
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
    "operationId": "getAgentUsage",
    "method": "GET",
    "path": "/agents/{id}/usage",
    "resource": "agents",
    "verb": "usage",
    "summary": "Tokens and cost per day, last 24 hours, this month, and the agent's limits and budgets",
    "permission": "agents.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "days",
        "flag": "days",
        "required": false,
        "type": "integer"
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWorkspaceAgentUsage",
    "method": "GET",
    "path": "/agents/usage",
    "resource": "agents",
    "verb": "workspace-usage",
    "summary": "Workspace agent usage: tokens and cost per day and per agent, workspace budgets, and the price table in effect",
    "permission": "agents.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "days",
        "flag": "days",
        "required": false,
        "type": "integer"
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateAgentCostSettings",
    "method": "PUT",
    "path": "/agents/cost-settings",
    "resource": "agents",
    "verb": "cost-settings",
    "summary": "Set the workspace's model price overrides and agent budgets",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "model_prices",
          "type": "array",
          "required": false,
          "description": "[{provider, model, input_per_1m, output_per_1m, cached_input_per_1m, currency, effective_date}] — win over the instance's and the shipped list prices"
        },
        {
          "name": "budgets",
          "type": "object",
          "required": false,
          "description": "{daily_token_budget, monthly_token_budget, daily_cost_budget, monthly_cost_budget, budget_currency} — 0 = none"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listAgentVersions",
    "method": "GET",
    "path": "/agents/{id}/versions",
    "resource": "agents",
    "verb": "versions",
    "summary": "List an agent's saved versions (newest first)",
    "permission": "agents.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "versions",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "restoreAgentVersion",
    "method": "POST",
    "path": "/agents/{id}/versions/{version}/restore",
    "resource": "agents",
    "verb": "restore",
    "summary": "Restore an earlier version (saved as a new version)",
    "permission": "agents.edit",
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
    "operationId": "listAgentEvalCases",
    "method": "GET",
    "path": "/agents/{id}/evals/cases",
    "resource": "agents",
    "verb": "cases",
    "summary": "List an agent's evaluation test cases",
    "permission": "agents.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "cases",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createAgentEvalCase",
    "method": "POST",
    "path": "/agents/{id}/evals/cases",
    "resource": "agents",
    "verb": "case-create",
    "summary": "Add an evaluation test case",
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
          "required": true
        },
        {
          "name": "input_message",
          "type": "string",
          "required": true
        },
        {
          "name": "expected",
          "type": "object",
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
    "operationId": "updateAgentEvalCase",
    "method": "PUT",
    "path": "/agents/{id}/evals/cases/{caseId}",
    "resource": "agents",
    "verb": "case-update",
    "summary": "Update an evaluation test case",
    "permission": "agents.edit",
    "positional": [
      "id",
      "caseId"
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
          "name": "input_message",
          "type": "string",
          "required": true
        },
        {
          "name": "expected",
          "type": "object",
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
    "operationId": "deleteAgentEvalCase",
    "method": "DELETE",
    "path": "/agents/{id}/evals/cases/{caseId}",
    "resource": "agents",
    "verb": "case-delete",
    "summary": "Delete an evaluation test case",
    "permission": "agents.edit",
    "positional": [
      "id",
      "caseId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "listAgentEvalRuns",
    "method": "GET",
    "path": "/agents/{id}/evals/runs",
    "resource": "agents",
    "verb": "eval-runs",
    "summary": "List evaluation runs (newest first)",
    "permission": "agents.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "runs",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "runAgentEvals",
    "method": "POST",
    "path": "/agents/{id}/evals/runs",
    "resource": "agents",
    "verb": "eval",
    "summary": "Run the evaluation suite (side-effecting tools simulated); poll the run",
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
          "name": "case_ids",
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
    "operationId": "getAgentEvalRun",
    "method": "GET",
    "path": "/agents/{id}/evals/runs/{runId}",
    "resource": "agents",
    "verb": "eval-run",
    "summary": "Get an evaluation run with per-case checks",
    "permission": "agents.view",
    "positional": [
      "id",
      "runId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
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
    "operationId": "importDataRows",
    "method": "POST",
    "path": "/data-tables/{id}/rows/import",
    "resource": "rows",
    "verb": "import",
    "summary": "Import rows from a CSV, TSV or .xlsx file (insert, upsert or replace)",
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
          "name": "file_base64",
          "type": "string",
          "required": true,
          "description": "The file, base64: .csv, .tsv or .xlsx, at most 10 MB and 50,000 data rows (hosted instances accept request bodies up to about 4.5 MB). With multipart/form-data: the `file` field."
        },
        {
          "name": "file_name",
          "type": "string",
          "required": true,
          "description": "File name; its extension (.csv, .tsv, .xlsx) picks the reader"
        },
        {
          "name": "sheet",
          "type": "string",
          "required": false,
          "description": ".xlsx: the sheet to read (default the first)"
        },
        {
          "name": "delimiter",
          "type": "string",
          "required": false,
          "description": "CSV delimiter (default auto: comma, semicolon or tab, detected)"
        },
        {
          "name": "encoding",
          "type": "string",
          "required": false,
          "description": "Text encoding (default auto: UTF-8 with or without BOM, UTF-16 with BOM, else Windows-1252)"
        },
        {
          "name": "mapping",
          "required": false,
          "description": "File header → column key or name; null skips the header. Headers left out are matched to columns by name (case-insensitive; spaces, underscores and hyphens ignored)"
        },
        {
          "name": "new_columns",
          "required": false,
          "description": "Columns to add to the table before importing (needs data.edit_schema)"
        },
        {
          "name": "mode",
          "type": "string",
          "required": false,
          "description": "insert (default): add every row; upsert: update rows whose key_column value matches, insert the rest; replace: delete every existing row first (confirm_replace)"
        },
        {
          "name": "key_column",
          "type": "string",
          "required": false,
          "description": "upsert: the column (key or name) whose value identifies a row"
        },
        {
          "name": "confirm_replace",
          "type": "string",
          "required": false,
          "description": "replace: the table name, typed, to confirm deleting every existing row"
        },
        {
          "name": "date_order",
          "type": "string",
          "required": false,
          "description": "Day / month order of numeric dates such as 03/04/2026 (default auto: detected from the values; month/day when undecidable)"
        },
        {
          "name": "trim",
          "required": false,
          "description": "Trim leading / trailing whitespace (default true)"
        },
        {
          "name": "empty_cells",
          "type": "string",
          "required": false,
          "description": "empty (default): an empty cell clears the column; ignore: it leaves the column out (an upsert keeps the stored value)"
        },
        {
          "name": "skip_invalid",
          "required": false,
          "description": "Import the valid rows and skip rows with errors (default false: any error stops the import, nothing is written)"
        },
        {
          "name": "fire_triggers",
          "required": false,
          "description": "Fire data_table_event workflows for created / updated rows (default true, like POST /data-tables/{id}/rows)"
        },
        {
          "name": "dry_run",
          "required": false,
          "description": "Validate only: the report (mapping, counts, row errors, preview), nothing written"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "async": true,
    "destructive": false
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
          "description": "Full request config; overrides the shorthand fields. Custom reference: { origin: 'custom', custom: { kind: 'list'|'read'|'create'|'update'|'upsert'|'delete'|'execute', source: { type: 'operation', reference_id | from: 'template'|'openapi', key | from: 'endpoint', method, path_template; params: [{ name, value }] } | { type: 'table', schema?, table, columns }, inputs: [{ name, type, mode: 'ask'|'fixed', required?, default_value?, fixed_value? | fixed_setting? }], rows_path?, columns: [{ path, alias?, type? }], filter?: { op: 'and'|'or', conditions: [{ field, operator, value?, api_param? } | group] }, sort?, distinct?, page_size?, max_rows?, paging_inputs?, include_total?, api?, read?, write?: { method?, body?: { mode: 'source'|'none'|'inputs'|'mapped', fields?: [{ path, value?, type? }] }, idempotency?: { input, header? }, success_statuses?, set?: [{ column, value }], key?: [{ column, value }], returning?, procedure?: { schema?, name, params: [{ name, value? }] }, max_affected? (default 1, ≤ 1000), not_found?: 'error'|'noop', id_field? } } } — the server builds the request, public inputs (Fixed ones hidden), outputs and response model. Write kinds: Update/Delete need a key or conditions (never unbounded); database writes run in a transaction rolled back past max_affected; output { status, affected_rows, id, record }."
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
          "required": false,
          "description": "Replaces the request config. Custom reference: { origin: 'custom', custom: { kind: 'list'|'read'|'create'|'update'|'upsert'|'delete'|'execute', source: { type: 'operation', reference_id | from: 'template'|'openapi', key | from: 'endpoint', method, path_template; params: [{ name, value }] } | { type: 'table', schema?, table, columns }, inputs: [{ name, type, mode: 'ask'|'fixed', required?, default_value?, fixed_value? | fixed_setting? }], rows_path?, columns: [{ path, alias?, type? }], filter?: { op: 'and'|'or', conditions: [{ field, operator, value?, api_param? } | group] }, sort?, distinct?, page_size?, max_rows?, paging_inputs?, include_total?, api?, read?, write?: { method?, body?: { mode: 'source'|'none'|'inputs'|'mapped', fields?: [{ path, value?, type? }] }, idempotency?: { input, header? }, success_statuses?, set?: [{ column, value }], key?: [{ column, value }], returning?, procedure?: { schema?, name, params: [{ name, value? }] }, max_affected? (default 1, ≤ 1000), not_found?: 'error'|'noop', id_field? } } } — the server builds the request, public inputs (Fixed ones hidden), outputs and response model. Write kinds: Update/Delete need a key or conditions (never unbounded); database writes run in a transaction rolled back past max_affected; output { status, affected_rows, id, record }."
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
        },
        {
          "name": "reference_mode",
          "type": "string",
          "required": false,
          "description": "Which catalogue operations become references: 'all' (default), 'none' (start empty and build custom references) or 'selected' (reference_template_keys)"
        },
        {
          "name": "reference_template_keys",
          "type": "array",
          "required": false,
          "description": "Operation keys to generate when reference_mode is 'selected' (see the catalog's reference_templates)"
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
        },
        {
          "name": "available_in_menu",
          "required": false,
          "description": "Available forms: list the form in the sidebar Forms menu of people given explicit access to it (a grant for them, a team they belong to or a role they hold) who can submit forms. A setting: no new version (default false)."
        },
        {
          "name": "system_name",
          "required": false,
          "description": "Friendly link name: /form/<system_name> on the workspace address (https://<subdomain>.<base domain>/form/<system_name>). Lowercase a-z, 0-9 and hyphens, 3-60 characters, no leading, trailing or double hyphen; unique in the workspace (409 when taken). A setting: no new version. Renaming keeps the old name as a redirect. Omitted = suggested from the name (\"Employee onboarding\" → employee-onboarding, then -2, -3, …)."
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
    "query": [
      {
        "name": "version",
        "flag": "content-version",
        "description": "published (default) or draft (forms.edit): the working draft's content",
        "required": false,
        "type": "string",
        "enum": [
          "published",
          "draft"
        ]
      }
    ],
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
        },
        {
          "name": "available_in_menu",
          "required": false,
          "description": "Available forms: list the form in the sidebar Forms menu of people given explicit access to it (a grant for them, a team they belong to or a role they hold) who can submit forms. A setting: no new version (default false)."
        },
        {
          "name": "system_name",
          "type": "string",
          "required": false,
          "description": "Friendly link name: /form/<system_name> on the workspace address (https://<subdomain>.<base domain>/form/<system_name>). Lowercase a-z, 0-9 and hyphens, 3-60 characters, no leading, trailing or double hyphen; unique in the workspace (409 when taken). A setting: no new version. Renaming keeps the old name as a redirect."
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
    "summary": "Delete a form with its versions, submissions, stored files and grants (409 with the usages while a workflow uses it, or while it is on legal hold)",
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
    "operationId": "getFormGovernance",
    "method": "GET",
    "path": "/forms/{id}/governance",
    "resource": "forms",
    "verb": "governance",
    "summary": "A form's retention policy, legal hold and submission count",
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
    "operationId": "setFormLegalHold",
    "method": "POST",
    "path": "/forms/{id}/legal-hold",
    "resource": "forms",
    "verb": "legal-hold",
    "summary": "Place or release a legal hold on a form (nothing of it is purged or deleted while held)",
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
          "name": "hold",
          "type": "boolean",
          "required": true,
          "description": "true places the form on legal hold, false releases it"
        },
        {
          "name": "reason",
          "required": false,
          "description": "Why the form is held (case or matter reference)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getFormDraft",
    "method": "GET",
    "path": "/forms/{id}/draft",
    "resource": "forms",
    "verb": "draft",
    "summary": "Get a form's working draft (content, who saved it, publish problems)",
    "permission": "forms.edit",
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
    "operationId": "saveFormDraft",
    "method": "PUT",
    "path": "/forms/{id}/draft",
    "resource": "forms",
    "verb": "draft-save",
    "summary": "Save the form's working draft (not visible to others until published)",
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
          "name": "fields",
          "type": "array",
          "required": false,
          "description": "Field definitions (omitted: kept from the draft, or the published form for a new draft)"
        },
        {
          "name": "layout",
          "required": false,
          "description": "Grid layout"
        },
        {
          "name": "theme",
          "required": false,
          "description": "Theme reference"
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
          "name": "expected_updated_at",
          "required": false,
          "description": "The draft's updated_at you last read (null: you saw no draft): 409 when someone saved or started it since. Omitted: last save wins."
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "discardFormDraft",
    "method": "DELETE",
    "path": "/forms/{id}/draft",
    "resource": "forms",
    "verb": "draft-discard",
    "summary": "Discard the form's draft (the published version is untouched; reviewers lose access)",
    "permission": "forms.edit",
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
    "operationId": "compareFormDraft",
    "method": "GET",
    "path": "/forms/{id}/draft/compare",
    "resource": "forms",
    "verb": "draft-compare",
    "summary": "Compare the draft with the published version",
    "permission": "forms.edit",
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
    "operationId": "publishFormDraft",
    "method": "POST",
    "path": "/forms/{id}/publish",
    "resource": "forms",
    "verb": "publish",
    "summary": "Publish the form's draft as a new version",
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
          "name": "note",
          "required": false,
          "description": "What changed (stored on the new version, shown in the version history)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listFormDraftReviewers",
    "method": "GET",
    "path": "/forms/{id}/draft/reviewers",
    "resource": "forms",
    "verb": "draft-reviewers",
    "summary": "Who the form's draft is shared with",
    "permission": "forms.edit",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "reviewers",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "addFormDraftReviewers",
    "method": "POST",
    "path": "/forms/{id}/draft/reviewers",
    "resource": "forms",
    "verb": "draft-share",
    "summary": "Share the form's draft with people and teams (read-only preview)",
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
          "name": "reviewers",
          "type": "array",
          "required": true,
          "description": "People and teams who may preview the draft (at most 50)"
        },
        {
          "name": "note",
          "required": false,
          "description": "A note for them (shown in the notification)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "removeFormDraftReviewer",
    "method": "DELETE",
    "path": "/forms/{id}/draft/reviewers/{reviewerId}",
    "resource": "forms",
    "verb": "draft-unshare",
    "summary": "Stop sharing the form's draft with a person or team",
    "permission": "forms.edit",
    "positional": [
      "id",
      "reviewerId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "restoreFormVersionAsDraft",
    "method": "POST",
    "path": "/forms/{id}/versions/{version}/restore",
    "resource": "forms",
    "verb": "version-restore",
    "summary": "Restore a version as the form's draft",
    "permission": "forms.edit",
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
          "description": "Mini-theme overrides: colors { light, dark: { accent, background, text, page, page_to, input, border, button } }, radius, font, heading_font, button_shape (square | rounded | pill), shadow (none | subtle | medium | strong), field_style (outlined | filled | underline), appearance (workspace | system | light | dark), density, label_position, button_placement, form_width (narrow | normal | wide | full | custom), form_width_pct (40-100, custom only), header"
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
          "description": "Field values keyed by field key (validated like a task form: types, required, rules, people, lookup values against their source; a list field takes an array of row objects keyed by its column keys)"
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
        },
        {
          "name": "params",
          "type": "object",
          "required": false,
          "description": "The form's parameters by name ({{param.<name>}}), as a link would pass them (/f/<id>?customer=ALFKI). Unknown names are ignored; values are coerced to the declared type and validated; defaults fill the rest. Untrusted: they only fill placeholders in the saved form, so they can narrow a base filter but never widen it"
        },
        {
          "name": "variables",
          "type": "object",
          "required": false,
          "description": "The form's variables by name ({{var.<name>}}): declared names only, typed and size-bounded; initial values fill the rest"
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
        "description": "Where it was submitted (anonymous: a public form link)",
        "required": false,
        "type": "string",
        "enum": [
          "standalone",
          "task",
          "api",
          "anonymous"
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
        },
        {
          "name": "resolve",
          "type": "array",
          "required": false,
          "description": "Resolve these stored values to their items (display labels) instead of searching"
        },
        {
          "name": "params",
          "type": "object",
          "required": false,
          "description": "The form's parameters by name ({{param.<name>}}), as a link would pass them (/f/<id>?customer=ALFKI). Unknown names are ignored; values are coerced to the declared type and validated; defaults fill the rest. Untrusted: they only fill placeholders in the saved form, so they can narrow a base filter but never widen it"
        },
        {
          "name": "variables",
          "type": "object",
          "required": false,
          "description": "The form's variables by name ({{var.<name>}}): declared names only, typed and size-bounded; initial values fill the rest"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "queryFormDataTable",
    "method": "POST",
    "path": "/forms/{id}/data-table",
    "resource": "forms",
    "verb": "data-table",
    "summary": "Rows of a Data table field of a reusable form (search, filters, sort, page)",
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
          "required": true,
          "description": "Key of a Data table field of the form"
        },
        {
          "name": "query",
          "type": "object",
          "required": false
        },
        {
          "name": "values",
          "type": "object",
          "required": false,
          "description": "The form's current values, for {{form.<key>}} in the base filter / API inputs"
        },
        {
          "name": "params",
          "type": "object",
          "required": false,
          "description": "Reusable forms: the form's parameters by name ({{param.<name>}} in the base filter / API inputs), re-validated against the declarations; a task form uses the parameters its workflow step passed and ignores these"
        },
        {
          "name": "variables",
          "type": "object",
          "required": false,
          "description": "The form's variables by name ({{var.<name>}}): declared names only, typed and size-bounded; initial values fill the rest"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "checkFormAccessibility",
    "method": "POST",
    "path": "/forms/{id}/accessibility",
    "resource": "forms",
    "verb": "check-accessibility",
    "summary": "Check a form against WCAG 2.2 AA (score, findings, fixes)",
    "permission": "forms.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "definition",
          "required": false,
          "description": "An unsaved definition to check instead of the latest version: { fields, layout?, theme?, buttons?, header? }"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "checkFormSystemName",
    "method": "GET",
    "path": "/forms/system-name-check",
    "resource": "forms",
    "verb": "check-system-name",
    "summary": "Check a form system name (format and availability)",
    "permission": "forms.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "system_name",
        "flag": "system-name",
        "description": "The name to check",
        "required": true,
        "type": "string"
      },
      {
        "name": "form_id",
        "flag": "form-id",
        "description": "The form being renamed (omit for a new form)",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getFormLinks",
    "method": "GET",
    "path": "/forms/{id}/links",
    "resource": "forms",
    "verb": "links",
    "summary": "The links of a form: friendly link, form page and public link",
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
    "operationId": "importInfoPathForm",
    "method": "POST",
    "path": "/forms/import/infopath",
    "resource": "forms",
    "verb": "import-infopath",
    "summary": "Import an InfoPath form (.xsn): analyse it (dry_run) or create one UserTasks form per view, with its rules and validation",
    "permission": "forms.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "file_base64",
          "type": "string",
          "required": true,
          "description": "The InfoPath form template (.xsn), or a .zip of its extracted source files, base64. With multipart/form-data: the `file` field."
        },
        {
          "name": "file_name",
          "type": "string",
          "required": false,
          "description": "The file name (default form.xsn); re-imports are matched by it"
        },
        {
          "name": "dry_run",
          "required": false,
          "description": "true = analyse only: the report and the forms that would be made; nothing is stored"
        },
        {
          "name": "mode",
          "type": "string",
          "required": false,
          "description": "per_view (default): one form per InfoPath view, \"<Form> — <View>\"; combined: one form with each view as a step"
        },
        {
          "name": "pages",
          "type": "string",
          "required": false,
          "description": "With mode combined: the views as steps (default) or as tabs"
        },
        {
          "name": "views",
          "required": false,
          "description": "Views to import (names; default all)"
        },
        {
          "name": "name",
          "type": "string",
          "required": false,
          "description": "Base form name (default the InfoPath form's title)"
        },
        {
          "name": "tag",
          "type": "string",
          "required": false,
          "description": "An extra tag (the form name and \"infopath\" are always added)"
        },
        {
          "name": "existing",
          "type": "string",
          "required": false,
          "description": "Forms an earlier import of this file made (matched by file name + view): update them (a new version each) or create new forms (default)"
        },
        {
          "name": "create_table",
          "required": false,
          "description": "Also create a data table for the submissions (a child table per repeating table) and a draft \"save submissions\" workflow (data.create and workflows.create / edit)"
        },
        {
          "name": "available_in_menu",
          "required": false,
          "description": "Available forms: list the form in the sidebar Forms menu of people given explicit access to it (a grant for them, a team they belong to or a role they hold) who can submit forms. A setting: no new version (default false)."
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listWizardForms",
    "method": "GET",
    "path": "/forms/wizard",
    "resource": "forms",
    "verb": "wizard-list",
    "summary": "List the caller's wizard forms and drafts (newest first)",
    "permission": "forms.wizard",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "projects",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createWizardForm",
    "method": "POST",
    "path": "/forms/wizard",
    "resource": "forms",
    "verb": "wizard-create",
    "summary": "Create a form with the wizard: the form, a responses data table, an optional review / approval workflow and a results page",
    "permission": "forms.wizard",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "spec",
          "type": "object",
          "required": true,
          "description": "The wizard spec: { name, description?, template? (request | survey | quiz | registration | feedback | incident | blank), questions: [{ id, kind (short_text, long_text, number, money, date, choice, choices, rating (stars), nps, yes_no, email, phone, file, heading, page_break, likert (agreement scale), matrix (grid of statements), slider, csat (smiley faces), ranking, image_choice (picture choice), yes_no_maybe), label, help?, required?, options? (choice / choices / likert scale points lowest first / matrix columns / ranking / image_choice), rows? (matrix: the statements), settings? { max (rating 2–10; slider highest), min, step, unit (slider), icon star|heart|thumb, half (rating), faces 3|5 (csat), bands (nps), low_label, high_label, multiple (image_choice), icons { <option>: <icon name> } (image_choice) }, currency? (money, ISO code), show_if? { question: <id of an earlier question>, op: is | is_not | contains | answered | not_answered | gt | lt, value? }, score? { correct: [answers], points? } (quizzes), key? (kept from an earlier create: the field and column key) }], look? { theme { kind: workspace } | { kind: saved, theme_id } | { kind: accent, color: #rrggbb }, header { show, logo, title?, subtitle? }, layout: single | steps | one_at_a_time, success { heading?, message? } }, audience? { internal, who: everyone | selected, role_ids, team_ids, show_in_menu, public_link (needs the workspace's anonymous forms switch), multiple_responses (false = one per signed-in person), opens_at?, closes_at? }, approval? { mode: none | single | manager | team | multi, stages: [{ id, name, assignee { kind: person, user_id } | { kind: manager, fallback_user_id } | { kind: team, team_id } | { kind: group, group_id, group_name? }, outcomes: [approve, decline?, changes?] }] (single / manager / team: 1 stage; multi: 2-5), notify_requester, due_days }, results? { charts, role_ids, team_ids } (who besides the owner opens the results page) }."
        },
        {
          "name": "dry_run",
          "type": "boolean",
          "required": false,
          "description": "Validate and describe what would be created (the plan) without creating anything"
        },
        {
          "name": "project_id",
          "type": "string",
          "required": false,
          "description": "A wizard draft of the caller to turn into the created form"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWizardForm",
    "method": "GET",
    "path": "/forms/wizard/{id}",
    "resource": "forms",
    "verb": "wizard-get",
    "summary": "Get a wizard form: its spec, the manifest of created objects and links (owner, or forms.edit)",
    "permission": "forms.wizard",
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
    "operationId": "updateWizardForm",
    "method": "PATCH",
    "path": "/forms/wizard/{id}",
    "resource": "forms",
    "verb": "wizard-update",
    "summary": "Update a wizard form and the objects it made (new columns are added, nothing is dropped; the workflow is published again)",
    "permission": "forms.wizard",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "spec",
          "type": "object",
          "required": true,
          "description": "The wizard spec: { name, description?, template? (request | survey | quiz | registration | feedback | incident | blank), questions: [{ id, kind (short_text, long_text, number, money, date, choice, choices, rating (stars), nps, yes_no, email, phone, file, heading, page_break, likert (agreement scale), matrix (grid of statements), slider, csat (smiley faces), ranking, image_choice (picture choice), yes_no_maybe), label, help?, required?, options? (choice / choices / likert scale points lowest first / matrix columns / ranking / image_choice), rows? (matrix: the statements), settings? { max (rating 2–10; slider highest), min, step, unit (slider), icon star|heart|thumb, half (rating), faces 3|5 (csat), bands (nps), low_label, high_label, multiple (image_choice), icons { <option>: <icon name> } (image_choice) }, currency? (money, ISO code), show_if? { question: <id of an earlier question>, op: is | is_not | contains | answered | not_answered | gt | lt, value? }, score? { correct: [answers], points? } (quizzes), key? (kept from an earlier create: the field and column key) }], look? { theme { kind: workspace } | { kind: saved, theme_id } | { kind: accent, color: #rrggbb }, header { show, logo, title?, subtitle? }, layout: single | steps | one_at_a_time, success { heading?, message? } }, audience? { internal, who: everyone | selected, role_ids, team_ids, show_in_menu, public_link (needs the workspace's anonymous forms switch), multiple_responses (false = one per signed-in person), opens_at?, closes_at? }, approval? { mode: none | single | manager | team | multi, stages: [{ id, name, assignee { kind: person, user_id } | { kind: manager, fallback_user_id } | { kind: team, team_id } | { kind: group, group_id, group_name? }, outcomes: [approve, decline?, changes?] }] (single / manager / team: 1 stage; multi: 2-5), notify_requester, due_days }, results? { charts, role_ids, team_ids } (who besides the owner opens the results page) }. Send the questions with their ids (and keys) from the earlier create: kept questions keep their columns; new ones add columns; a removed question's column and data stay."
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWizardResults",
    "method": "GET",
    "path": "/forms/wizard/{id}/results",
    "resource": "forms",
    "verb": "wizard-results",
    "summary": "A wizard form's results: summary (counts, this week, approval rate), charts per question and a page of responses",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Responses containing this text",
        "required": false,
        "type": "string"
      },
      {
        "name": "status",
        "flag": "status",
        "description": "Only responses with this status (Pending, Approved, Declined, Changes requested)",
        "required": false,
        "type": "string"
      },
      {
        "name": "sort",
        "flag": "sort",
        "required": false,
        "type": "string",
        "enum": [
          "newest",
          "oldest"
        ]
      },
      {
        "name": "page",
        "flag": "page",
        "required": false,
        "type": "integer"
      },
      {
        "name": "page_size",
        "flag": "page-size",
        "required": false,
        "type": "integer"
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getFormAnonymous",
    "method": "GET",
    "path": "/forms/{id}/anonymous",
    "resource": "forms",
    "verb": "anonymous",
    "summary": "A form's public (anonymous) link, options and what anonymous visitors would not get",
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
    "operationId": "updateFormAnonymous",
    "method": "PATCH",
    "path": "/forms/{id}/anonymous",
    "resource": "forms",
    "verb": "anonymous-set",
    "summary": "Turn a form's anonymous responses on / off and set its visitor limits",
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
          "name": "enabled",
          "type": "boolean",
          "required": false,
          "description": "Allow anonymous responses (turning on needs the workspace switch)"
        },
        {
          "name": "settings",
          "type": "object",
          "required": false,
          "description": "Visitor limits, clamped to the platform limits"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "regenerateFormAnonymousLink",
    "method": "POST",
    "path": "/forms/{id}/anonymous/regenerate",
    "resource": "forms",
    "verb": "anonymous-regenerate",
    "summary": "Make a new public link for a form (every earlier link stops working)",
    "permission": "forms.edit",
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
    "operationId": "getAnonymousFormsSettings",
    "method": "GET",
    "path": "/anonymous-forms",
    "resource": "anonymous-forms",
    "verb": "get",
    "summary": "The workspace's \"Allow anonymous forms\" switch and bot protection (never the secret)",
    "permission": "settings.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateAnonymousFormsSettings",
    "method": "PATCH",
    "path": "/anonymous-forms",
    "resource": "anonymous-forms",
    "verb": "update",
    "summary": "Set the workspace's \"Allow anonymous forms\" switch and bot protection",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "enabled",
          "type": "boolean",
          "required": false,
          "description": "Allow anonymous forms in this workspace (off stops every public link at once)"
        },
        {
          "name": "captcha",
          "required": false,
          "description": "Optional bot protection (null turns it off)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listFormControls",
    "method": "GET",
    "path": "/form-controls",
    "resource": "form-controls",
    "verb": "list",
    "summary": "List custom form controls (with their versions)",
    "permission": "extensibility.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Name, tag or description contains",
        "required": false,
        "type": "string"
      },
      {
        "name": "enabled",
        "flag": "enabled",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "form_controls",
    "paginated": true,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createFormControl",
    "method": "POST",
    "path": "/form-controls",
    "resource": "form-controls",
    "verb": "create",
    "summary": "Upload a form control package (or import one from a URL): a new control, or a new version of the one with the same tag",
    "permission": "extensibility.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "package_base64",
          "type": "string",
          "required": false,
          "description": "A zip package (manifest.json + the module), base64"
        },
        {
          "name": "package_name",
          "type": "string",
          "required": false,
          "description": "File name of the uploaded package (multipart)"
        },
        {
          "name": "module",
          "type": "string",
          "required": false,
          "description": "Or: the ES module source (one file, dependencies bundled)"
        },
        {
          "name": "manifest",
          "required": false,
          "description": "With `module`: manifest.json (object or JSON text)"
        },
        {
          "name": "signature",
          "type": "object",
          "required": false,
          "description": "Optional { alg: \"ed25519\", public_key, signature } over the module SHA-256 (hex)"
        },
        {
          "name": "url",
          "type": "string",
          "required": false,
          "description": "Or: import from an https URL (zip or module); fetched once through the egress guard"
        },
        {
          "name": "manifest_url",
          "type": "string",
          "required": false,
          "description": "With `url` (a module): its manifest.json URL (default: next to the module)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "importFormControl",
    "method": "POST",
    "path": "/form-controls/import",
    "resource": "form-controls",
    "verb": "import",
    "summary": "Import a portable export: creates the control and adds the versions it lacks (checksums verified)",
    "permission": "extensibility.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "form_control",
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
    "operationId": "getFormControl",
    "method": "GET",
    "path": "/form-controls/{id}",
    "resource": "form-controls",
    "verb": "get",
    "summary": "Get a form control: latest manifest, versions (checksums, signatures), approved hosts",
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
    "operationId": "updateFormControl",
    "method": "PATCH",
    "path": "/form-controls/{id}",
    "resource": "form-controls",
    "verb": "update",
    "summary": "Enable / disable a control, rename it, or approve its network hosts",
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
          "name": "enabled",
          "type": "boolean",
          "required": false,
          "description": "false = hidden from the designer and its frames stop loading"
        },
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
          "name": "approved_hosts",
          "type": "array",
          "required": false,
          "description": "Network hosts to allow (only hosts a version's manifest asks for)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteFormControl",
    "method": "DELETE",
    "path": "/form-controls/{id}",
    "resource": "form-controls",
    "verb": "delete",
    "summary": "Delete a control (or one version with ?only_version=) — refused (409, with the usages) while a form, workflow or open task uses it",
    "permission": "extensibility.delete",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "only_version",
        "flag": "only-version",
        "description": "Delete just this version",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "getFormControlVersion",
    "method": "GET",
    "path": "/form-controls/{id}/versions/{version}",
    "resource": "form-controls",
    "verb": "version",
    "summary": "Get one version: manifest, checksum and (with include_module=true) the module source",
    "permission": "extensibility.view",
    "positional": [
      "id",
      "version"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "include_module",
        "flag": "include-module",
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
    "operationId": "getFormControlUsages",
    "method": "GET",
    "path": "/form-controls/{id}/usages",
    "resource": "form-controls",
    "verb": "usages",
    "summary": "Where a control is used: reusable forms (any version), workflow drafts and published versions, open tasks",
    "permission": "extensibility.view",
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
    "operationId": "exportFormControl",
    "method": "GET",
    "path": "/form-controls/{id}/export",
    "resource": "form-controls",
    "verb": "export",
    "summary": "Export a control with every version (modules included) as portable JSON",
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
    "operationId": "uploadFile",
    "method": "POST",
    "path": "/files/uploads",
    "resource": "files",
    "verb": "upload-init",
    "summary": "Upload a file for an Attachments field (or start a direct upload)",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "task_id",
          "type": "string",
          "required": false,
          "description": "Upload into this open task's form (you must be able to act on it)"
        },
        {
          "name": "form_id",
          "type": "string",
          "required": false,
          "description": "Upload for a submission of this reusable form (forms.submit)"
        },
        {
          "name": "workflow_id",
          "type": "string",
          "required": false,
          "description": "Upload for this workflow's start-form attachments input (workflows.activate)"
        },
        {
          "name": "field_key",
          "type": "string",
          "required": true,
          "description": "The Attachments field (or start-form input) key"
        },
        {
          "name": "name",
          "type": "string",
          "required": true,
          "description": "File name (its extension must be an allowed type)"
        },
        {
          "name": "size",
          "type": "integer",
          "required": false,
          "description": "Size in bytes: without content_base64, starts a direct upload to storage"
        },
        {
          "name": "content_base64",
          "type": "string",
          "required": false,
          "description": "The file itself, base64 (small files; the request body limit applies). Omit to get a signed upload URL"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "completeFileUpload",
    "method": "POST",
    "path": "/files/uploads/{id}/complete",
    "resource": "files",
    "verb": "upload-complete",
    "summary": "Finish a direct upload (the server verifies the stored file)",
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
    "operationId": "uploadWorkflowAction",
    "method": "POST",
    "path": "/workflow-activities/upload",
    "resource": "activities",
    "verb": "upload",
    "summary": "Upload a packaged action (manifest v1 + one ES module): a new action, or a new version of the one with the same key",
    "permission": "extensibility.create",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "package_base64",
          "type": "string",
          "required": false,
          "description": "A zip package (manifest.json + dist/action.js, optional signature.json), base64"
        },
        {
          "name": "package_name",
          "type": "string",
          "required": false,
          "description": "File name of the uploaded package (multipart)"
        },
        {
          "name": "module",
          "type": "string",
          "required": false,
          "description": "Or: the ES module source (one file, dependencies bundled, default export defineAction(...))"
        },
        {
          "name": "manifest",
          "required": false,
          "description": "With `module`: manifest.json (v1, object or JSON text)"
        },
        {
          "name": "signature",
          "type": "object",
          "required": false,
          "description": "Optional { alg: \"ed25519\", public_key, signature } over the module SHA-256 (hex)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getWorkflowActivityUsages",
    "method": "GET",
    "path": "/workflow-activities/{id}/usages",
    "resource": "activities",
    "verb": "usages",
    "summary": "Workflow steps that run the action (drafts and active published versions)",
    "permission": "extensibility.view",
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
    "operationId": "getWorkflowActivityVersion",
    "method": "GET",
    "path": "/workflow-activities/{id}/versions/{version}",
    "resource": "activities",
    "verb": "version",
    "summary": "Get one stored version: manifest, SHA-256, signature and (with include_source=true) the module",
    "permission": "extensibility.view",
    "positional": [
      "id",
      "version"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "include_source",
        "flag": "include-source",
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
    "operationId": "setWorkflowActivitySecrets",
    "method": "PUT",
    "path": "/workflow-activities/{id}/secrets",
    "resource": "activities",
    "verb": "secrets",
    "summary": "Set or clear the secrets the action declares (encrypted; never returned)",
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
          "name": "values",
          "type": "object",
          "required": true,
          "description": "Declared secret name → value (null or \"\" clears it). Values are encrypted and never returned."
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "testWorkflowActivity",
    "method": "POST",
    "path": "/workflow-activities/{id}/test",
    "resource": "activities",
    "verb": "test",
    "summary": "Run one operation with the given inputs in the sandbox and return outputs, logs, warnings and stats",
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
          "name": "operation",
          "type": "string",
          "required": false,
          "description": "Operation id (default: the first)"
        },
        {
          "name": "inputs",
          "type": "object",
          "required": false,
          "description": "Input values (default: the operation's sample)"
        },
        {
          "name": "version",
          "type": "string",
          "required": false,
          "description": "Run a stored version instead of the current one"
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
        },
        {
          "name": "enabled",
          "type": "boolean",
          "required": false,
          "description": "Kill switch: false = steps using the action fail fast and the designer hides it"
        },
        {
          "name": "approved_hosts",
          "type": "array",
          "required": false,
          "description": "HTTP hosts to allow (only hosts the manifest declares in capabilities.http.hosts)"
        },
        {
          "name": "data_grants",
          "type": "array",
          "required": false,
          "description": "Data tables the action may use (needs capabilities.data; write needs data.write)"
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
    "summary": "Delete an activity — refused (409, with the usages) while a workflow uses it",
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
          "description": "Report configuration (data_source, columns, filters, ..., charts)"
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
          "required": false,
          "description": "Report configuration (data_source, columns, filters, ..., charts)"
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
    "query": [
      {
        "name": "timezone",
        "flag": "timezone",
        "description": "IANA time zone for summary chart time buckets",
        "required": false,
        "type": "string"
      }
    ],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "data_source",
          "type": "string",
          "required": true,
          "description": "Report source key"
        },
        {
          "name": "charts",
          "type": "array",
          "required": false,
          "description": "Summary charts drawn above the report's table (at most 8); each is aggregated on the server from the report's own rows"
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
    "query": [
      {
        "name": "workflow_id",
        "flag": "workflow-id",
        "description": "Scope Workflow runs / Tasks to this workflow and list its variable columns",
        "required": false,
        "type": "string"
      }
    ],
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
          "description": "Parent team id (loops are refused)"
        },
        {
          "name": "lead_user_id",
          "required": false,
          "description": "Team lead (an active member)"
        },
        {
          "name": "org_unit_id",
          "required": false,
          "description": "Org unit the team belongs to"
        },
        {
          "name": "colour",
          "required": false,
          "description": "Hex colour like #3366FF"
        },
        {
          "name": "kind",
          "required": false,
          "description": "team (default), squad, guild or any custom kind"
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
          "description": "Parent team id (loops are refused)"
        },
        {
          "name": "lead_user_id",
          "required": false,
          "description": "Team lead (an active member)"
        },
        {
          "name": "org_unit_id",
          "required": false,
          "description": "Org unit the team belongs to"
        },
        {
          "name": "colour",
          "required": false,
          "description": "Hex colour like #3366FF"
        },
        {
          "name": "kind",
          "required": false,
          "description": "team (default), squad, guild or any custom kind"
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
        "description": "e.g. workflow, data_table, form, role, api_key, webhook",
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
        "description": "e.g. create, update, delete, grant, revoke, toggle, retention, purge, legal_hold",
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
    "operationId": "listObjectPermissions",
    "method": "GET",
    "path": "/object-permissions",
    "resource": "object-permissions",
    "verb": "list",
    "summary": "List the grants on an object",
    "permission": "team.change_roles",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "object_type",
        "flag": "object-type",
        "required": true,
        "type": "string",
        "enum": [
          "workflow",
          "data_table",
          "agent",
          "integration",
          "api_key",
          "report",
          "form"
        ]
      },
      {
        "name": "object_id",
        "flag": "object-id",
        "required": true,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "permissions",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "setObjectPermission",
    "method": "POST",
    "path": "/object-permissions",
    "resource": "object-permissions",
    "verb": "set",
    "summary": "Add or change one grantee's grant on an object",
    "permission": "team.change_roles",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "object_type",
          "type": "string",
          "required": true,
          "description": "Type of the object"
        },
        {
          "name": "object_id",
          "type": "string",
          "required": true,
          "description": "Object id"
        },
        {
          "name": "role_id",
          "required": false,
          "description": "Grant to a role (give exactly one of role_id, team_id, user_id)"
        },
        {
          "name": "team_id",
          "required": false,
          "description": "Grant to a team"
        },
        {
          "name": "user_id",
          "required": false,
          "description": "Grant to a person"
        },
        {
          "name": "can_view",
          "type": "boolean",
          "required": false,
          "description": "View (default true)"
        },
        {
          "name": "can_edit",
          "type": "boolean",
          "required": false,
          "description": "Edit (not used by forms)"
        },
        {
          "name": "can_delete",
          "type": "boolean",
          "required": false,
          "description": "Delete (not used by forms)"
        },
        {
          "name": "can_execute",
          "type": "boolean",
          "required": false,
          "description": "Execute; Submit for forms"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "removeObjectPermission",
    "method": "DELETE",
    "path": "/object-permissions/{id}",
    "resource": "object-permissions",
    "verb": "remove",
    "summary": "Remove a grant",
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
    "operationId": "getOrgChart",
    "method": "GET",
    "path": "/org/chart",
    "resource": "org",
    "verb": "chart",
    "summary": "The org chart: every active member with manager, attributes and report counts",
    "permission": "org.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "people",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getOrgPerson",
    "method": "GET",
    "path": "/org/people/{id}",
    "resource": "org",
    "verb": "person",
    "summary": "One person in context: attributes, manager chain, direct reports, peers, teams, org units and projects",
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
    "operationId": "updateOrgPerson",
    "method": "PATCH",
    "path": "/org/people/{id}",
    "resource": "org",
    "verb": "update-person",
    "summary": "Edit a member's job title, department, location, employee id, cost centre and/or manager",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "job_title",
          "required": false,
          "description": "Job title"
        },
        {
          "name": "department",
          "required": false,
          "description": "Department"
        },
        {
          "name": "location",
          "required": false,
          "description": "Office / location"
        },
        {
          "name": "employee_id",
          "required": false,
          "description": "Employee id / number"
        },
        {
          "name": "cost_center",
          "required": false,
          "description": "Cost centre"
        },
        {
          "name": "manager_user_id",
          "required": false,
          "description": "Manager (null clears it). Needs org.manage or team.change_roles; loops and non-members are refused"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "detachOrgPerson",
    "method": "POST",
    "path": "/org/people/{id}/detach",
    "resource": "org",
    "verb": "detach-person",
    "summary": "Detach a member's attributes from the directory (editable here; sync stops updating them)",
    "permission": "org.manage",
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
    "operationId": "listOrgSubordinates",
    "method": "GET",
    "path": "/org/people/{id}/subordinates",
    "resource": "org",
    "verb": "reports",
    "summary": "People who report to a member: direct, or every level (depth=all, up to 10 levels)",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "depth",
        "flag": "depth",
        "description": "direct (default) or all levels",
        "required": false,
        "type": "string",
        "enum": [
          "direct",
          "all"
        ]
      },
      {
        "name": "include_self",
        "flag": "include-self",
        "description": "Include the person first (depth 0)",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "people",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getOrgManagerChain",
    "method": "GET",
    "path": "/org/people/{id}/manager-chain",
    "resource": "org",
    "verb": "manager-chain",
    "summary": "A member's managers, nearest first",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "chain",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listOrgPeers",
    "method": "GET",
    "path": "/org/people/{id}/peers",
    "resource": "org",
    "verb": "peers",
    "summary": "Others with the same manager",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "peers",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listOrgPersonTeams",
    "method": "GET",
    "path": "/org/people/{id}/teams",
    "resource": "org",
    "verb": "teams",
    "summary": "Teams a member is in, with the teams above them",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "teams",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listOrgPersonProjects",
    "method": "GET",
    "path": "/org/people/{id}/projects",
    "resource": "org",
    "verb": "projects",
    "summary": "Projects a member is on (member, owner, sponsor or through a team)",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "include_archived",
        "flag": "include-archived",
        "description": "Include archived projects",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "projects",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "resolveOrgScope",
    "method": "GET",
    "path": "/org/scope",
    "resource": "org",
    "verb": "scope",
    "summary": "The people a scope covers: me, my direct / all reports, a team, an org unit or a project",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "scope",
        "flag": "scope",
        "description": "Which people",
        "required": true,
        "type": "string",
        "enum": [
          "me",
          "direct_reports",
          "all_reports",
          "team",
          "org_unit",
          "project"
        ]
      },
      {
        "name": "id",
        "flag": "id",
        "description": "Team, org unit or project id (scope team / org_unit / project)",
        "required": false,
        "type": "string"
      },
      {
        "name": "recursive",
        "flag": "recursive",
        "description": "team / org_unit: include sub-teams / sub-units",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "include_self",
        "flag": "include-self",
        "description": "direct_reports / all_reports: include the caller",
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
        "description": "project: include attached teams' members (default true)",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "people",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listOrgUnits",
    "method": "GET",
    "path": "/org/units",
    "resource": "org-units",
    "verb": "list",
    "summary": "Every org unit with head, depth, children and headcounts",
    "permission": "org.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "units",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createOrgUnit",
    "method": "POST",
    "path": "/org/units",
    "resource": "org-units",
    "verb": "create",
    "summary": "Create an org unit",
    "permission": "org.manage",
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
          "name": "kind",
          "required": false,
          "description": "company, division, department, unit (default) or any custom kind"
        },
        {
          "name": "parent_id",
          "required": false,
          "description": "Parent org unit id (loops are refused)"
        },
        {
          "name": "head_user_id",
          "required": false,
          "description": "Head of the unit (an active member)"
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "sort",
          "required": false,
          "description": "Order among siblings (then name)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getOrgUnit",
    "method": "GET",
    "path": "/org/units/{id}",
    "resource": "org-units",
    "verb": "get",
    "summary": "An org unit with its path, children, members, teams and projects",
    "permission": "org.view",
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
    "operationId": "updateOrgUnit",
    "method": "PATCH",
    "path": "/org/units/{id}",
    "resource": "org-units",
    "verb": "update",
    "summary": "Rename, move (parent_id), set the head of or describe an org unit",
    "permission": "org.manage",
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
          "name": "kind",
          "required": false,
          "description": "company, division, department, unit (default) or any custom kind"
        },
        {
          "name": "parent_id",
          "required": false,
          "description": "Parent org unit id (loops are refused)"
        },
        {
          "name": "head_user_id",
          "required": false,
          "description": "Head of the unit (an active member)"
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "sort",
          "required": false,
          "description": "Order among siblings (then name)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteOrgUnit",
    "method": "DELETE",
    "path": "/org/units/{id}",
    "resource": "org-units",
    "verb": "delete",
    "summary": "Delete an org unit (its sub-units move up to its parent)",
    "permission": "org.manage",
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
    "operationId": "detachOrgUnit",
    "method": "POST",
    "path": "/org/units/{id}/detach",
    "resource": "org-units",
    "verb": "detach",
    "summary": "Detach an imported org unit (editable here; its source stops updating it)",
    "permission": "org.manage",
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
    "operationId": "listOrgUnitMembers",
    "method": "GET",
    "path": "/org/units/{id}/members",
    "resource": "org-units",
    "verb": "members",
    "summary": "Members of an org unit (recursive=true adds everyone in the units below)",
    "permission": "org.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "recursive",
        "flag": "recursive",
        "description": "Include members of every unit below",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "members",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "addOrgUnitMember",
    "method": "PUT",
    "path": "/org/units/{id}/members/{userId}",
    "resource": "org-units",
    "verb": "add-member",
    "summary": "Add a member to an org unit, or update their role / primary flag (idempotent)",
    "permission": "org.manage",
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
          "required": false,
          "description": "Role in the unit, e.g. \"Deputy\""
        },
        {
          "name": "is_primary",
          "type": "boolean",
          "required": false,
          "description": "Make this the person's primary unit (one per person)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "removeOrgUnitMember",
    "method": "DELETE",
    "path": "/org/units/{id}/members/{userId}",
    "resource": "org-units",
    "verb": "remove-member",
    "summary": "Remove a member from an org unit",
    "permission": "org.manage",
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
    "operationId": "getOrgTeamTree",
    "method": "GET",
    "path": "/org/teams",
    "resource": "org",
    "verb": "team-tree",
    "summary": "The team tree: every team with lead, org unit, member counts, a member preview and projects",
    "permission": null,
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
    "operationId": "listOrgTeamMembers",
    "method": "GET",
    "path": "/org/teams/{id}/members",
    "resource": "org",
    "verb": "team-members",
    "summary": "Members of a team (recursive=true adds everyone in its sub-teams)",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "recursive",
        "flag": "recursive",
        "description": "Include members of every sub-team",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "members",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "exportOrg",
    "method": "GET",
    "path": "/org/export",
    "resource": "org",
    "verb": "export",
    "summary": "The org structure as CSV (the import format, one row per active member)",
    "permission": "org.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "format",
        "flag": "format",
        "description": "json (default) or csv (the file)",
        "required": false,
        "type": "string",
        "enum": [
          "json",
          "csv"
        ]
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getOrgImportTemplate",
    "method": "GET",
    "path": "/org/import/template",
    "resource": "org",
    "verb": "import-template",
    "summary": "The CSV import template",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "format",
        "flag": "format",
        "description": "json (default) or csv (the file)",
        "required": false,
        "type": "string",
        "enum": [
          "json",
          "csv"
        ]
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "importOrg",
    "method": "POST",
    "path": "/org/import",
    "resource": "org",
    "verb": "import",
    "summary": "Import people attributes, managers, departments and teams from CSV (dry run by default)",
    "permission": "org.manage",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "csv",
          "type": "string",
          "required": true,
          "description": "The CSV text (UTF-8, header row first; max 5 MB)"
        },
        {
          "name": "mapping",
          "type": "object",
          "required": false,
          "description": "Field → CSV header (null skips the field)"
        },
        {
          "name": "dry_run",
          "type": "boolean",
          "required": false,
          "description": "true (default): return the plan without writing; false: apply it"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listProjects",
    "method": "GET",
    "path": "/projects",
    "resource": "projects",
    "verb": "list",
    "summary": "List projects with owner, team, counts and a member preview (archived hidden by default)",
    "permission": "projects.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "status",
        "flag": "status",
        "description": "active, on_hold, completed, archived (comma-separated)",
        "required": false,
        "type": "string"
      },
      {
        "name": "include_archived",
        "flag": "include-archived",
        "description": "Include archived projects",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      },
      {
        "name": "team_id",
        "flag": "team-id",
        "description": "Projects the team is attached to (or owns)",
        "required": false,
        "type": "string"
      },
      {
        "name": "org_unit_id",
        "flag": "org-unit-id",
        "required": false,
        "type": "string"
      },
      {
        "name": "q",
        "flag": "q",
        "description": "Name or key contains",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "projects",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "createProject",
    "method": "POST",
    "path": "/projects",
    "resource": "projects",
    "verb": "create",
    "summary": "Create a project",
    "permission": "projects.manage",
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
          "name": "key",
          "required": false,
          "description": "Short unique key, e.g. APOLLO (generated from the name when omitted)"
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "status",
          "type": "string",
          "required": false,
          "description": "active (default), on_hold, completed or archived"
        },
        {
          "name": "owner_user_id",
          "required": false,
          "description": "Owner (default: the caller)"
        },
        {
          "name": "sponsor_user_id",
          "required": false
        },
        {
          "name": "team_id",
          "required": false,
          "description": "Owning team (its members count as project people)"
        },
        {
          "name": "org_unit_id",
          "required": false
        },
        {
          "name": "start_date",
          "required": false,
          "description": "Start date (YYYY-MM-DD)"
        },
        {
          "name": "end_date",
          "required": false,
          "description": "End date (YYYY-MM-DD, on or after the start)"
        },
        {
          "name": "colour",
          "required": false,
          "description": "Hex colour like #3366FF"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getProject",
    "method": "GET",
    "path": "/projects/{id}",
    "resource": "projects",
    "verb": "get",
    "summary": "A project with its people (direct members and attached teams' members) and teams",
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
    "operationId": "updateProject",
    "method": "PATCH",
    "path": "/projects/{id}",
    "resource": "projects",
    "verb": "update",
    "summary": "Update a project",
    "permission": "projects.manage",
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
          "name": "key",
          "required": false,
          "description": "Short unique key, e.g. APOLLO (generated from the name when omitted)"
        },
        {
          "name": "description",
          "required": false
        },
        {
          "name": "status",
          "type": "string",
          "required": false,
          "description": "active (default), on_hold, completed or archived"
        },
        {
          "name": "owner_user_id",
          "required": false,
          "description": "Owner (default: the caller)"
        },
        {
          "name": "sponsor_user_id",
          "required": false
        },
        {
          "name": "team_id",
          "required": false,
          "description": "Owning team (its members count as project people)"
        },
        {
          "name": "org_unit_id",
          "required": false
        },
        {
          "name": "start_date",
          "required": false,
          "description": "Start date (YYYY-MM-DD)"
        },
        {
          "name": "end_date",
          "required": false,
          "description": "End date (YYYY-MM-DD, on or after the start)"
        },
        {
          "name": "colour",
          "required": false,
          "description": "Hex colour like #3366FF"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteProject",
    "method": "DELETE",
    "path": "/projects/{id}",
    "resource": "projects",
    "verb": "delete",
    "summary": "Delete a project with its memberships (archive it to keep the history)",
    "permission": "projects.manage",
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
    "operationId": "archiveProject",
    "method": "POST",
    "path": "/projects/{id}/archive",
    "resource": "projects",
    "verb": "archive",
    "summary": "Archive (or restore with archived=false) a project",
    "permission": "projects.manage",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "archived",
          "type": "boolean",
          "required": false,
          "description": "true (default) archives, false restores (status active)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listProjectMembers",
    "method": "GET",
    "path": "/projects/{id}/members",
    "resource": "projects",
    "verb": "members",
    "summary": "A project's people: direct members and (include_teams, default true) attached teams' members",
    "permission": null,
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [
      {
        "name": "include_teams",
        "flag": "include-teams",
        "description": "Include attached teams' members (default true)",
        "required": false,
        "type": "string",
        "enum": [
          "true",
          "false"
        ]
      }
    ],
    "body": null,
    "listKey": "members",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "addProjectMember",
    "method": "PUT",
    "path": "/projects/{id}/members/{userId}",
    "resource": "projects",
    "verb": "add-member",
    "summary": "Add a member to a project, or update their role / allocation (idempotent)",
    "permission": "projects.manage",
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
          "required": false,
          "description": "Role on the project, e.g. Lead, Member (default Member)"
        },
        {
          "name": "allocation_percent",
          "required": false,
          "description": "Share of their time (0–100)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "removeProjectMember",
    "method": "DELETE",
    "path": "/projects/{id}/members/{userId}",
    "resource": "projects",
    "verb": "remove-member",
    "summary": "Remove a member from a project",
    "permission": "projects.manage",
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
    "operationId": "attachProjectTeam",
    "method": "PUT",
    "path": "/projects/{id}/teams/{teamId}",
    "resource": "projects",
    "verb": "attach-team",
    "summary": "Attach a whole team to a project (its members and sub-teams' members join; idempotent)",
    "permission": "projects.manage",
    "positional": [
      "id",
      "teamId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "detachProjectTeam",
    "method": "DELETE",
    "path": "/projects/{id}/teams/{teamId}",
    "resource": "projects",
    "verb": "detach-team",
    "summary": "Detach a team from a project",
    "permission": "projects.manage",
    "positional": [
      "id",
      "teamId"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
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
          "required": true,
          "description": "Colours per mode. Text below its contrast target is raised when drawn; button / navigation text below 3:1 is refused."
        },
        {
          "name": "typography",
          "type": "object",
          "required": true,
          "description": "Fonts, weights and sizes."
        },
        {
          "name": "shape",
          "type": "object",
          "required": true
        },
        {
          "name": "shadows",
          "type": "object",
          "required": true,
          "description": "Elevation. `none` or box shadows built from lengths and one colour per layer (no url(), var() or other CSS). Suggested values: see shadow_presets."
        },
        {
          "name": "layout",
          "type": "object",
          "required": true
        },
        {
          "name": "chrome",
          "type": "object",
          "required": true,
          "description": "Sidebar, top bar and canvas backgrounds: solid, gradient or a dot texture."
        },
        {
          "name": "branding",
          "type": "object",
          "required": true,
          "description": "Logos (uploads in this workspace's logos storage) and the wordmark."
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
    "operationId": "getWorkspaceAddress",
    "method": "GET",
    "path": "/workspace/address",
    "resource": "workspace-address",
    "verb": "get",
    "summary": "Get the workspace address (any member)",
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
    "operationId": "updateWorkspaceAddress",
    "method": "PATCH",
    "path": "/workspace/address",
    "resource": "workspace-address",
    "verb": "set",
    "summary": "Change the workspace address",
    "permission": "settings.edit",
    "positional": [],
    "bodyPositional": [
      "subdomain"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "subdomain",
          "required": true,
          "description": "The new subdomain, or null to remove it"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "checkWorkspaceAddress",
    "method": "GET",
    "path": "/workspace/address/check",
    "resource": "workspace-address",
    "verb": "check",
    "summary": "Check whether a workspace subdomain is valid and available",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "subdomain",
        "flag": "subdomain",
        "description": "The subdomain to check",
        "required": true,
        "type": "string"
      }
    ],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getTaskCompletionSettings",
    "method": "GET",
    "path": "/workspace/task-completion",
    "resource": "task-completion",
    "verb": "get",
    "summary": "Get the Task completed screen settings (any member)",
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
    "operationId": "updateTaskCompletionSettings",
    "method": "PATCH",
    "path": "/workspace/task-completion",
    "resource": "task-completion",
    "verb": "update",
    "summary": "Change the Task completed screen settings",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "enabled",
          "type": "boolean",
          "required": false,
          "description": "Show the Task completed screen after a task is actioned (default true)"
        },
        {
          "name": "heading",
          "type": "string",
          "required": false,
          "description": "Heading template (default \"{{outcome}}: {{task.title}}\")"
        },
        {
          "name": "subheading",
          "type": "string",
          "required": false,
          "description": "Subheading template (default \"Thanks, {{user.name}}. Your response is recorded.\")"
        },
        {
          "name": "next_assigned",
          "type": "string",
          "required": false,
          "description": "What happens next when the process moved on to someone (default \"Now with {{next.assignee}}\")"
        },
        {
          "name": "next_complete",
          "type": "string",
          "required": false,
          "description": "What happens next when the process finished (default \"Process complete\")"
        },
        {
          "name": "next_waiting",
          "type": "string",
          "required": false,
          "description": "What happens next on a timer, an event or an unassigned step (default \"Waiting on {{next.step}}\")"
        },
        {
          "name": "show_next_task",
          "type": "boolean",
          "required": false,
          "description": "Show the Next task button (hidden anyway when there is no next task)"
        },
        {
          "name": "next_task_label",
          "type": "string",
          "required": false,
          "description": "Next task button label"
        },
        {
          "name": "show_back",
          "type": "boolean",
          "required": false,
          "description": "Show the Back button"
        },
        {
          "name": "back_label",
          "type": "string",
          "required": false,
          "description": "Back button label; blank: \"Back to my tasks\" or \"Back to Home\" by back_target"
        },
        {
          "name": "back_target",
          "type": "string",
          "required": false,
          "description": "Where Back (and Esc) goes"
        },
        {
          "name": "show_view_flow",
          "type": "boolean",
          "required": false,
          "description": "Show Process view (workflow tasks only; opens the run view the person may see)"
        },
        {
          "name": "view_flow_label",
          "type": "string",
          "required": false,
          "description": "Process view button label"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getTaskNextStep",
    "method": "GET",
    "path": "/tasks/{id}/next",
    "resource": "tasks",
    "verb": "next",
    "summary": "What happens next after a task was actioned",
    "permission": "tasks.view_own",
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
    "operationId": "getFormSignInPage",
    "method": "GET",
    "path": "/workspace/form-sign-in-page",
    "resource": "form-sign-in-page",
    "verb": "get",
    "summary": "Get the form sign-in page settings (any member)",
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
    "operationId": "updateFormSignInPage",
    "method": "PATCH",
    "path": "/workspace/form-sign-in-page",
    "resource": "form-sign-in-page",
    "verb": "update",
    "summary": "Change the form sign-in page settings",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "design",
          "type": "integer",
          "required": false,
          "description": "The design, 1–10: 1 UserTasks, 2 Split screen, 3 Minimal, 4 Gradient, 5 Brand rail, 6 Glass, 7 Top banner, 8 Dark elegant, 9 Soft shapes, 10 Compact. Embedded in another site the page always uses 10 (Compact)."
        },
        {
          "name": "logo_url",
          "required": false,
          "description": "The logo: an image uploaded to this workspace's logos (variant form-sign-in, Settings → Forms); null shows the workspace name"
        },
        {
          "name": "heading",
          "type": "string",
          "required": false,
          "description": "Heading (default \"Sign in to continue\")"
        },
        {
          "name": "subheading",
          "type": "string",
          "required": false,
          "description": "Welcome message under the heading; may be empty"
        },
        {
          "name": "button_label",
          "type": "string",
          "required": false,
          "description": "The sign-in button label (default \"Sign in\")"
        },
        {
          "name": "footer_text",
          "type": "string",
          "required": false,
          "description": "Small print under the form; empty for none"
        },
        {
          "name": "support_link_label",
          "type": "string",
          "required": false,
          "description": "Support link text (blank: \"Get help\")"
        },
        {
          "name": "support_link_url",
          "required": false,
          "description": "Support link: https:// or mailto:; null for none"
        },
        {
          "name": "accent_color",
          "required": false,
          "description": "#rrggbb for buttons and coloured panels; null is the UserTasks default (ink). Ignored while use_workspace_theme is on"
        },
        {
          "name": "use_workspace_theme",
          "type": "boolean",
          "required": false,
          "description": "Draw the page in the workspace theme (colours, surfaces, text, radius, fonts, light/dark mode, canvas) instead of the UserTasks look and accent_color; the design, logo and wording still apply. Default false"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getDocumentOcr",
    "method": "GET",
    "path": "/document-ocr",
    "resource": "document-ocr",
    "verb": "get",
    "summary": "Get the workspace OCR provider",
    "permission": "settings.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateDocumentOcr",
    "method": "PUT",
    "path": "/document-ocr",
    "resource": "document-ocr",
    "verb": "update",
    "summary": "Set the workspace OCR provider",
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
          "required": true,
          "description": "azure_document_intelligence = your own Azure resource; tesseract = built-in (only where the instance offers it); instance_default = the instance configuration (self-hosted; on the cloud this means not configured); off"
        },
        {
          "name": "endpoint",
          "required": false,
          "description": "Azure: the resource endpoint (https), e.g. https://my-resource.cognitiveservices.azure.com. Omit to keep the stored one"
        },
        {
          "name": "key",
          "required": false,
          "description": "Azure: KEY 1 or KEY 2 (write-only). Omit, empty or \"__SECRET__\" keeps the stored key"
        },
        {
          "name": "api_version",
          "required": false,
          "description": "Azure: API version (default 2024-11-30); empty resets to the default"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "deleteDocumentOcrKey",
    "method": "DELETE",
    "path": "/document-ocr",
    "resource": "document-ocr",
    "verb": "remove-key",
    "summary": "Remove the workspace Azure OCR key",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  },
  {
    "operationId": "testDocumentOcr",
    "method": "POST",
    "path": "/document-ocr/test",
    "resource": "document-ocr",
    "verb": "test",
    "summary": "Test the workspace Azure OCR connection",
    "permission": "settings.edit",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "endpoint",
          "required": false,
          "description": "Test this endpoint instead of the saved one"
        },
        {
          "name": "key",
          "required": false,
          "description": "Test this key instead of the saved one (write-only)"
        },
        {
          "name": "api_version",
          "required": false
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
        },
        {
          "name": "import_org_units",
          "type": "boolean",
          "required": false,
          "description": "Build org units from company / division / department (Google: organizational units) (default true)"
        },
        {
          "name": "import_profiles",
          "type": "boolean",
          "required": false,
          "description": "Import members' job title, department, location, employee id and cost centre (default true)"
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
        },
        {
          "name": "import_org_units",
          "type": "boolean",
          "required": false
        },
        {
          "name": "import_profiles",
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
    "operationId": "getDirectoryCapabilities",
    "method": "GET",
    "path": "/directory-sync/capabilities",
    "resource": "directory-sync",
    "verb": "capabilities",
    "summary": "What the directory connections make available to workflows (AAD group task assignment)",
    "permission": "workflows.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "searchEntraGroups",
    "method": "GET",
    "path": "/directory-sync/entra/groups",
    "resource": "directory-sync",
    "verb": "groups",
    "summary": "Search the workspace's Entra ID groups (for AAD group task assignment)",
    "permission": "workflows.view",
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "search",
        "flag": "search",
        "description": "Matches group display names",
        "required": false,
        "type": "string"
      },
      {
        "name": "cursor",
        "flag": "cursor",
        "description": "next_cursor of the previous page",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "groups",
    "paginated": false,
    "cursor": true,
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
        "description": "Asset types: workflow, workflow_activity, data_table, integration, connector, decision_table, email_template, agent, report, role, mcp_server, retention_policy, log_destination, form, form_theme, form_control (default every type you may view) (comma-separated)",
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
    "operationId": "listPackageItems",
    "method": "GET",
    "path": "/packages/{id}/items",
    "resource": "packages",
    "verb": "items",
    "summary": "The items in a package, grouped by type, with what each uses / is used by and the changes since the last built version",
    "permission": "packages.view",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "items",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "addPackageItems",
    "method": "POST",
    "path": "/packages/{id}/items",
    "resource": "packages",
    "verb": "add-items",
    "summary": "Add workspace items to a package (and, by default, what they use)",
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
          "name": "items",
          "type": "array",
          "required": true,
          "description": "Workspace items to add (find them with GET /packages/assets)"
        },
        {
          "name": "with_dependencies",
          "type": "boolean",
          "required": false,
          "description": "Also add what they use that is not in the package yet (default true); false leaves those out"
        },
        {
          "name": "dry_run",
          "type": "boolean",
          "required": false,
          "description": "Only list the items and the dependencies they would bring in"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "removePackageItems",
    "method": "POST",
    "path": "/packages/{id}/items/remove",
    "resource": "packages",
    "verb": "remove-items",
    "summary": "Remove items from a package (refused while other items use them, unless force)",
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
          "name": "items",
          "type": "array",
          "required": true,
          "description": "Items in the package to remove (nothing in the workspace is deleted)"
        },
        {
          "name": "force",
          "type": "boolean",
          "required": false,
          "description": "Remove even when other items in the package use them"
        },
        {
          "name": "dry_run",
          "type": "boolean",
          "required": false,
          "description": "Only list the items and what in the package still uses them"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "detachInstallItems",
    "method": "POST",
    "path": "/package-installs/{id}/detach",
    "resource": "package-installs",
    "verb": "detach",
    "summary": "Remove items from an installed package: they stay in the workspace and uninstall keeps them",
    "permission": "packages.install",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "items",
          "type": "array",
          "required": true,
          "description": "Items by type and their id in this workspace"
        },
        {
          "name": "dry_run",
          "type": "boolean",
          "required": false
        },
        {
          "name": "update_package",
          "type": "boolean",
          "required": false,
          "description": "Packages authored here (self-installed): also change the package itself, so its next build keeps the change (default true; needs packages.manage)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "adoptInstallItems",
    "method": "POST",
    "path": "/package-installs/{id}/adopt",
    "resource": "package-installs",
    "verb": "adopt",
    "summary": "Add existing workspace items to an installed package, so uninstall removes them (packages authored here only)",
    "permission": "packages.install",
    "positional": [
      "id"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "items",
          "type": "array",
          "required": true,
          "description": "Items by type and their id in this workspace"
        },
        {
          "name": "dry_run",
          "type": "boolean",
          "required": false
        },
        {
          "name": "update_package",
          "type": "boolean",
          "required": false,
          "description": "Packages authored here (self-installed): also change the package itself, so its next build keeps the change (default true; needs packages.manage)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "listExtensions",
    "method": "GET",
    "path": "/extensions",
    "resource": "extensions",
    "verb": "list",
    "summary": "List the extensions in this build and their state in this workspace",
    "permission": "settings.view",
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": null,
    "listKey": "extensions",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getExtension",
    "method": "GET",
    "path": "/extensions/{id}",
    "resource": "extensions",
    "verb": "get",
    "summary": "Get one extension",
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
    "operationId": "enableExtension",
    "method": "POST",
    "path": "/extensions/{id}/enable",
    "resource": "extensions",
    "verb": "enable",
    "summary": "Enable an extension in this workspace",
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
  },
  {
    "operationId": "disableExtension",
    "method": "POST",
    "path": "/extensions/{id}/disable",
    "resource": "extensions",
    "verb": "disable",
    "summary": "Disable an extension in this workspace (settings and data are kept)",
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
  },
  {
    "operationId": "getExtensionSettings",
    "method": "GET",
    "path": "/extensions/{id}/settings/{page}",
    "resource": "extensions",
    "verb": "settings",
    "summary": "Read one settings page of an extension (schema and values; secrets never returned)",
    "permission": null,
    "positional": [
      "id",
      "page"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "updateExtensionSettings",
    "method": "PUT",
    "path": "/extensions/{id}/settings/{page}",
    "resource": "extensions",
    "verb": "configure",
    "summary": "Change one settings page of an extension",
    "permission": null,
    "positional": [
      "id",
      "page"
    ],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "values",
          "type": "object",
          "required": true,
          "description": "Field key → value"
        }
      ]
    },
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
  },
  {
    "operationId": "createAdminWorkspace",
    "method": "POST",
    "path": "/admin/workspaces",
    "resource": "admin-workspaces",
    "verb": "create",
    "summary": "Create a workspace with its owner (instance admin; idempotent on slug)",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "slug",
          "type": "string",
          "required": true,
          "description": "Lowercase a-z, 0-9 and hyphens, 3-40 characters, no leading, trailing or double hyphen, not a reserved name (admin, api, www, …) and not personal-…; the workspace address follows it."
        },
        {
          "name": "name",
          "type": "string",
          "required": true,
          "description": "Workspace name"
        },
        {
          "name": "owner_email",
          "type": "string",
          "required": true,
          "description": "The owner. An existing user is added as owner; otherwise an account is created (email confirmed)"
        },
        {
          "name": "owner_name",
          "type": "string",
          "required": false,
          "description": "Display name of a new owner account (default: the email's local part)"
        },
        {
          "name": "owner_password",
          "type": "string",
          "required": false,
          "description": "Password of a new owner account; omitted: a random one nobody knows (the owner signs in with SSO or resets it). Ignored for an existing user"
        },
        {
          "name": "create_api_key",
          "type": "boolean",
          "required": false,
          "description": "Also mint a workspace API key (returned once, as `key`). Also on an existing workspace, where it mints another one"
        },
        {
          "name": "api_key_name",
          "type": "string",
          "required": false,
          "description": "Name of the minted key (default \"Provisioning\")"
        },
        {
          "name": "api_key_permissions",
          "type": "array",
          "required": false,
          "description": "Permission keys of the minted key (default: every permission, like an owner)"
        },
        {
          "name": "api_key_expires_in_days",
          "type": "integer",
          "required": false,
          "description": "Days until the minted key expires (default: never)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getAdminWorkspace",
    "method": "GET",
    "path": "/admin/workspaces/{slug}",
    "resource": "admin-workspaces",
    "verb": "get",
    "summary": "Get a workspace by slug (instance admin)",
    "permission": null,
    "positional": [
      "slug"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "getLicence",
    "method": "GET",
    "path": "/licence",
    "resource": "licence",
    "verb": "status",
    "summary": "Licence status: installed licences, licensed extensions, limits and usage, expiry warnings (instance admin)",
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
    "operationId": "installLicence",
    "method": "PUT",
    "path": "/licence",
    "resource": "licence",
    "verb": "install",
    "summary": "Install or replace a licence (instance admin)",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "licence",
          "type": "string",
          "required": true,
          "description": "The licence file contents (JSON, or base64 of it)"
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "removeLicence",
    "method": "DELETE",
    "path": "/licence",
    "resource": "licence",
    "verb": "remove",
    "summary": "Remove an installed licence (instance admin)",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "licence_id",
        "flag": "licence-id",
        "description": "The licence to remove",
        "required": false,
        "type": "string"
      },
      {
        "name": "all",
        "flag": "remove-all",
        "description": "true: remove every licence installed here",
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
    "destructive": true
  },
  {
    "operationId": "getLicenceRequest",
    "method": "GET",
    "path": "/licence/request",
    "resource": "licence",
    "verb": "request",
    "summary": "Offline activation request: instance id, hostnames, version (instance admin)",
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
    "operationId": "listEntitlements",
    "method": "GET",
    "path": "/licence/entitlements",
    "resource": "entitlements",
    "verb": "list",
    "summary": "List workspace entitlements to paid extensions (instance admin)",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [
      {
        "name": "tenant_id",
        "flag": "tenant-id",
        "description": "Only this workspace",
        "required": false,
        "type": "string"
      },
      {
        "name": "extension_id",
        "flag": "extension-id",
        "description": "Only this extension",
        "required": false,
        "type": "string"
      }
    ],
    "body": null,
    "listKey": "entitlements",
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "grantEntitlement",
    "method": "PUT",
    "path": "/licence/entitlements",
    "resource": "entitlements",
    "verb": "grant",
    "summary": "Grant or update a workspace entitlement to a paid extension (instance admin)",
    "permission": null,
    "positional": [],
    "pathFlags": [],
    "query": [],
    "body": {
      "required": true,
      "fields": [
        {
          "name": "tenant_id",
          "type": "string",
          "required": true,
          "description": "Workspace id"
        },
        {
          "name": "extension_id",
          "type": "string",
          "required": true,
          "description": "Extension id, e.g. sharepoint"
        },
        {
          "name": "edition",
          "required": false
        },
        {
          "name": "features",
          "type": "array",
          "required": false,
          "description": "Features granted (omitted / empty / [\"*\"]: all)"
        },
        {
          "name": "limits",
          "type": "object",
          "required": false,
          "description": "Numeric limits, e.g. {\"sharepoint.farms\": 2}"
        },
        {
          "name": "status",
          "type": "string",
          "required": false,
          "description": "Default active"
        },
        {
          "name": "source",
          "type": "string",
          "required": false,
          "description": "Default admin"
        },
        {
          "name": "starts_at",
          "required": false
        },
        {
          "name": "ends_at",
          "required": false,
          "description": "Expiry; the extension stops 24 hours after it. Omitted: no end"
        },
        {
          "name": "notes",
          "required": false
        }
      ]
    },
    "paginated": false,
    "envelope": true,
    "destructive": false
  },
  {
    "operationId": "revokeEntitlement",
    "method": "DELETE",
    "path": "/licence/entitlements/{tenant_id}/{extension_id}",
    "resource": "entitlements",
    "verb": "revoke",
    "summary": "Remove a workspace entitlement (instance admin)",
    "permission": null,
    "positional": [
      "tenant_id",
      "extension_id"
    ],
    "pathFlags": [],
    "query": [],
    "body": null,
    "paginated": false,
    "envelope": true,
    "destructive": true
  }
]
