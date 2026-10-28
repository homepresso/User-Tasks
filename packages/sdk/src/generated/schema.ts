// Generated from openapi.json by scripts/generate.ts. Do not edit.
export interface paths {
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Describe the calling credential: tenant, user, auth kind and permissions */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** OpenAPI 3.1 document for this API */
        get: operations["getOpenApiSpec"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List workflows */
        get: operations["listWorkflows"];
        put?: never;
        /**
         * Create a workflow from nodes and edges
         * @description workflows.create is also accepted. A definition fetched from GET /workflows/{id}/definition creates a copy. The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        post: operations["createWorkflow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a workflow with its recent runs
         * @description With include_definition=true, `definition` is the author payload (as GET /workflows/{id}/definition); the whole response is accepted by PATCH /workflows/{id}.
         */
        get: operations["getWorkflow"];
        put?: never;
        post?: never;
        /** Delete a workflow (queued: its versions, runs and spawned tasks go with it) */
        delete: operations["deleteWorkflow"];
        options?: never;
        head?: never;
        /**
         * Save draft changes to a workflow (publish separately, or with publish: true)
         * @description Omitted fields are kept and fields equal to the stored value are not changes (changed: false). Runs keep using the published version until the draft is published. The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateWorkflowDefinition"];
        trace?: never;
    };
    "/workflows/{id}/definition": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the draft definition in author-payload shape (edit it and send it back to PATCH /workflows/{id}) */
        get: operations["getWorkflowDefinition"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Publish the draft as a new version (runs use it) and activate the workflow */
        post: operations["publishWorkflow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start a workflow run (sync, or async via the queue)
         * @description Runs the published version (the draft if never published). `variables` are checked against the workflow inputs (GET /workflows/{id}/inputs): a missing required input or a value of the wrong type is a 400 with one `details` entry per field; values are coerced (e.g. "42" → 42 for a number input). Keys that are not declared inputs pass through and are listed in `warnings`. Async starts answer 202 with `job_id`.
         */
        post: operations["startWorkflow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/{id}/inputs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the input parameters a workflow run accepts
         * @description Fields come from the published version's workflow variables (the draft's when never published; `source` says which). Each field has key, label, type (text, number, boolean, date, datetime, json, select, email, url), required, default, description and options (select).
         */
        get: operations["getWorkflowInputs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/events/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume a run waiting on an external event */
        post: operations["completeWorkflowEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List workflow runs */
        get: operations["listWorkflowRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a workflow run with its logs */
        get: operations["getWorkflowRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/runs/{id}/action": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pause, resume or cancel a run */
        post: operations["actOnWorkflowRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List queued workflow jobs */
        get: operations["listWorkflowQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/queue/{id}/action": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel or retry a queued job */
        post: operations["actOnWorkflowJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate a workflow (it responds to its trigger) */
        post: operations["activateWorkflow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deactivate a workflow (its trigger is paused) */
        post: operations["deactivateWorkflow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List published versions of a workflow (newest first)
         * @description Each version carries `active_instances`: its live (waiting or paused) runs.
         */
        get: operations["listWorkflowVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/{id}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one published version with its full definition */
        get: operations["getWorkflowVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/{id}/instances": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List live instances (waiting or paused runs) with their current node and version
         * @description Each instance has its current node, version, waiting-since time and open task (with assignee). `versions` counts live instances per version; `on_older_versions` counts those not on the published version.
         */
        get: operations["listWorkflowInstances"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/{id}/instances/migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Migrate live instances to another version (or dry-run the plan)
         * @description Each instance is closed out (status `migrated`, open tasks cancelled, queued resumes dropped) and a new run starts on the target version at the chosen node with the same variables, trace and task (a User Task there creates a fresh task). Target node per instance: node_map[current node] → default_target_node_id → the node with the same id. Results are per instance; an instance that changed since planning is reported as a conflict and left alone.
         */
        post: operations["migrateWorkflowInstances"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tasks
         * @description User-bound credentials only see tasks assigned to (or shared with) their user. `scope=reports` lists the open tasks of the caller's reports instead (the manager view; needs a user and only tasks.view_own), with per-person workload counts in `reports`.
         */
        get: operations["listTasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/assigned": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List open tasks assigned to a user or team */
        get: operations["listAssignedTasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a task
         * @description Task responses include `description` (as stored: sanitised HTML or plain text) and `description_text` (plain text).
         */
        get: operations["getTask"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update task fields and User Task field values
         * @description Same field allowlist as the task UI. User-bound credentials only reach their own tasks (and their reports'). Field values of a workflow task are saved by its assignee, or by their manager with on_behalf=true (403 otherwise). Field values of closed tasks cannot change (409). The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateTask"];
        trace?: never;
    };
    "/tasks/{id}/action": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept, hold, reject, complete, escalate or redirect a task
         * @description Workflow tasks are actioned by their assignee only (a member of the assigned team for a team task). Their manager — anyone in the assignee's manager chain in this workspace — may act on behalf with on_behalf=true and an on_behalf_note; the task records actioned_by (the manager) and actioned_on_behalf_of (the assignee) and the assignee is notified. tasks.complete_any (Owner only by default) is the audited break-glass for anyone else, and is required for credentials with no user. 403 otherwise, 404 for another workspace's task, 409 once the task is closed.
         */
        post: operations["actOnTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Suggestions for an Autocomplete / lookup field of an open task
         * @description Runs the lookup configured on the task's stored form (data table or API reference) — never a config from the request. The caller must be able to act on the task (user-bound credentials: assignee, collaborator, team member or queue manager). Only the configured columns / fields are returned. Rate limited per user (429).
         */
        post: operations["lookupTaskField"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/ingest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a task (with optional subtasks) from an external system */
        post: operations["ingestTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List agents */
        get: operations["listAgents"];
        put?: never;
        /** Create an agent */
        post: operations["createAgent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an agent */
        get: operations["getAgent"];
        /**
         * Update an agent
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        put: operations["updateAgent"];
        post?: never;
        /** Delete an agent (deactivates workflows that reference it) */
        delete: operations["deleteAgent"];
        options?: never;
        head?: never;
        /**
         * Update an agent (same as PUT)
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["patchAgent"];
        trace?: never;
    };
    "/agents/{id}/execute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Run an agent (sync, or async via the agent queue) */
        post: operations["executeAgent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List queued agent jobs */
        get: operations["listAgentQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/decision-tables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List decision tables */
        get: operations["listDecisionTables"];
        put?: never;
        /**
         * Create a decision table
         * @description workflows.create is also accepted.
         */
        post: operations["createDecisionTable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/decision-tables/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a decision table */
        get: operations["getDecisionTable"];
        /**
         * Update a decision table (omitted fields are kept)
         * @description Fields equal to the stored value are not changes (changed: false). The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        put: operations["updateDecisionTable"];
        post?: never;
        /** Delete a decision table (queued) */
        delete: operations["deleteDecisionTable"];
        options?: never;
        head?: never;
        /**
         * Update a decision table (same as PUT)
         * @description Fields equal to the stored value are not changes (changed: false). The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["patchDecisionTable"];
        trace?: never;
    };
    "/decision-tables/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Evaluate a decision table against input values */
        post: operations["testDecisionTable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/decision-tables/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export a decision table as portable JSON */
        get: operations["exportDecisionTable"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/decision-tables/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a decision table from an export document
         * @description Always creates a new table. Field, rule and condition ids are kept when present and generated otherwise.
         */
        post: operations["importDecisionTable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/data-tables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List data tables */
        get: operations["listDataTables"];
        put?: never;
        /** Create a data table */
        post: operations["createDataTable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/data-tables/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a data table with its columns */
        get: operations["getDataTable"];
        put?: never;
        post?: never;
        /** Delete a data table and all its rows (queued) */
        delete: operations["deleteDataTable"];
        options?: never;
        head?: never;
        /**
         * Rename a data table or replace its custom columns
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateDataTable"];
        trace?: never;
    };
    "/data-tables/{id}/rows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List or search rows
         * @description Without search/filters/cell sort, pages come straight from the database with an exact total. Otherwise the newest 500 rows are scanned and `truncated` is true when the table holds more.
         */
        get: operations["listDataRows"];
        put?: never;
        /**
         * Insert rows, or replace existing ones by row_id (single or bulk)
         * @description Cells must match declared columns and are stored under canonical column keys; inserts auto-number the ID column and stamp Date Created. Created and updated rows fire data_table_event workflows.
         */
        post: operations["upsertDataRows"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/data-tables/{id}/rows/{rowId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a row */
        get: operations["getDataRow"];
        put?: never;
        post?: never;
        /** Delete a row (queued; fires data_table_event "deleted" workflows) */
        delete: operations["deleteDataRow"];
        options?: never;
        head?: never;
        /**
         * Change cells of a row (others are kept)
         * @description Created and updated rows fire data_table_event workflows. The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateDataRow"];
        trace?: never;
    };
    "/data-tables/{id}/rows/bulk-delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Delete up to 500 rows of a table (queued); unknown ids are ignored */
        post: operations["bulkDeleteDataRows"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List integrations */
        get: operations["listIntegrations"];
        put?: never;
        /** Create an integration (credentials are encrypted at rest) */
        post: operations["createIntegration"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations/import-openapi": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create an integration with one reference per operation from an OpenAPI 2/3 or Postman document
         * @description Body is either `{ spec, name?, base_url?, auth_type?, auth_config?, selected_reference_indexes?, tags? }` or the raw document (overrides via query).
         */
        post: operations["importOpenApiIntegration"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an integration (masked config) with its references
         * @description Secrets are returned masked as "__SECRET__"; send the sentinel back to keep a stored value.
         */
        get: operations["getIntegration"];
        put?: never;
        post?: never;
        /** Delete an integration and its references */
        delete: operations["deleteIntegration"];
        options?: never;
        head?: never;
        /**
         * Update an integration
         * @description Secrets are returned masked as "__SECRET__"; send the sentinel back to keep a stored value. The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateIntegration"];
        trace?: never;
    };
    "/integrations/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test the connection (GET base URL with the configured auth) */
        post: operations["testIntegration"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations/{id}/references": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List an integration's references */
        get: operations["listIntegrationReferences"];
        put?: never;
        /** Create a reference on an integration */
        post: operations["createReference"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/references/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a reference (request config, inputs, outputs, response model) */
        get: operations["getReference"];
        put?: never;
        post?: never;
        /** Delete a reference */
        delete: operations["deleteReference"];
        options?: never;
        head?: never;
        /**
         * Update a reference
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateReference"];
        trace?: never;
    };
    "/references/bulk-delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Delete several references (ids outside the workspace are ignored) */
        post: operations["bulkDeleteReferences"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/references/{id}/execute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Call a reference with input values */
        post: operations["executeReference"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/objects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List composite objects with their sources */
        get: operations["listObjects"];
        put?: never;
        /** Create a composite object (also generates its callable reference) */
        post: operations["createObject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/objects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a composite object with its sources and generated references */
        get: operations["getObject"];
        put?: never;
        post?: never;
        /** Delete a composite object, its sources and generated references */
        delete: operations["deleteObject"];
        options?: never;
        head?: never;
        /**
         * Update a composite object (name, description, or a full replacement source list)
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateObject"];
        trace?: never;
    };
    "/connectors/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the built-in connector templates */
        get: operations["getConnectorCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List enabled connectors (credentials masked) */
        get: operations["listConnectors"];
        put?: never;
        /** Enable a connector: creates its integration and templated references */
        post: operations["createConnector"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a connector with its template, integration and references
         * @description Secrets are returned masked as "__SECRET__"; send the sentinel back to keep a stored value.
         */
        get: operations["getConnector"];
        put?: never;
        post?: never;
        /** Delete a connector, its integration and generated references */
        delete: operations["deleteConnector"];
        options?: never;
        head?: never;
        /**
         * Update connector config/credentials (merged) and keep its integration in step
         * @description Secrets are returned masked as "__SECRET__"; send the sentinel back to keep a stored value. The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateConnector"];
        trace?: never;
    };
    "/connectors/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Run the connector preflight and probe with its stored credentials */
        post: operations["testConnector"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/{id}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-enable a connector and its integration */
        post: operations["enableConnector"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/{id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable a connector and deactivate its integration */
        post: operations["disableConnector"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/{id}/regenerate-references": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Replace the generated references with the current template set */
        post: operations["regenerateConnectorReferences"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/email-templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List email templates (without bodies) */
        get: operations["listEmailTemplates"];
        put?: never;
        /**
         * Create an email template
         * @description HTML is sanitised (scripts, iframes, objects, embeds, forms, on* handlers and javascript: URLs are removed); a blank text_body is generated from the HTML. At most one template per workspace is the default: setting is_default clears it on the others. The default cannot be deleted.
         */
        post: operations["createEmailTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/email-templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an email template with its subject and bodies */
        get: operations["getEmailTemplate"];
        put?: never;
        post?: never;
        /** Delete an email template (409 for the default template) */
        delete: operations["deleteEmailTemplate"];
        options?: never;
        head?: never;
        /**
         * Update an email template
         * @description HTML is sanitised (scripts, iframes, objects, embeds, forms, on* handlers and javascript: URLs are removed); a blank text_body is generated from the HTML. At most one template per workspace is the default: setting is_default clears it on the others. The default cannot be deleted. The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateEmailTemplate"];
        trace?: never;
    };
    "/email-templates/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Render the subject and bodies with sample variables (nothing is sent)
         * @description Uses the same expression resolver as the send_email workflow node; unknown {{variables}} render as empty.
         */
        post: operations["previewEmailTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List reusable task forms (with field and usage counts) */
        get: operations["listForms"];
        put?: never;
        /**
         * Create a reusable task form (version 1)
         * @description fields is the User Task field list (key, label, type, required, options, bounds, ...); layout is the optional grid ({ rows: [{ columns, cells: [{ field_key, span }] }] }); theme is { source: "workspace" } (default), { source: "custom", overrides } or { source: "saved", theme_id }.
         */
        post: operations["createForm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forms/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a form with its fields, layout, theme and usages
         * @description Usages are the workflow steps (and start forms) linking the form: draft links follow the latest version, active published versions are pinned.
         */
        get: operations["getForm"];
        put?: never;
        post?: never;
        /** Delete a form (409 with the usages while a workflow uses it) */
        delete: operations["deleteForm"];
        options?: never;
        head?: never;
        /**
         * Update a form
         * @description A change to fields, layout or theme bumps version and stores an immutable snapshot (published workflow versions pin the version they were published with; drafts follow the latest). Name, description and tag edits do not. fields is the User Task field list (key, label, type, required, options, bounds, ...); layout is the optional grid ({ rows: [{ columns, cells: [{ field_key, span }] }] }); theme is { source: "workspace" } (default), { source: "custom", overrides } or { source: "saved", theme_id }. The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateForm"];
        trace?: never;
    };
    "/forms/{id}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Copy a form into a new form (version 1) */
        post: operations["duplicateForm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forms/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a form's versions (newest first, without content)
         * @description A change to fields, layout or theme bumps version and stores an immutable snapshot (published workflow versions pin the version they were published with; drafts follow the latest). Name, description and tag edits do not.
         */
        get: operations["listFormVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forms/{id}/versions/{version}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one form version snapshot (fields, layout, theme) */
        get: operations["getFormVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forms/{id}/usages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Where a form is used (workflow drafts and active published versions)
         * @description Usages are the workflow steps (and start forms) linking the form: draft links follow the latest version, active published versions are pinned.
         */
        get: operations["listFormUsages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/form-themes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List saved form themes */
        get: operations["listFormThemes"];
        put?: never;
        /**
         * Create a saved form theme
         * @description Overrides are validated; a theme whose own text/background contrast is below 3:1 is refused.
         */
        post: operations["createFormTheme"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/form-themes/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a saved form theme */
        get: operations["getFormTheme"];
        put?: never;
        post?: never;
        /** Delete a saved form theme (409 while a form or step uses it) */
        delete: operations["deleteFormTheme"];
        options?: never;
        head?: never;
        /**
         * Update a saved form theme (forms using it pick the change up)
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateFormTheme"];
        trace?: never;
    };
    "/forms/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit a reusable form
         * @description Validates the values on the server, records a submission, runs the button's start-workflow actions (queued, attributed to the caller) and fires "Form submitted" triggers. Returns the submission, the effects the button shows (messages, success screen, redirect) and the started runs.
         */
        post: operations["submitForm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forms/{id}/submissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a form's submissions (newest first)
         * @description Everyone sees their own submissions; forms.edit sees all of the workspace's.
         */
        get: operations["listFormSubmissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/form-submissions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one form submission (values, button, runs started)
         * @description Everyone sees their own submissions; forms.edit sees all of the workspace's.
         */
        get: operations["getFormSubmission"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forms/{id}/lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Suggestions for an Autocomplete / lookup field of a reusable form
         * @description Runs the lookup stored on the form (latest version) — never a config from the request — with the configured columns / fields only. Rate limited per user (429).
         */
        post: operations["lookupFormField"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflow-activities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List custom workflow activities (without source code) */
        get: operations["listWorkflowActivities"];
        put?: never;
        /**
         * Create a custom workflow activity
         * @description Saving never runs the code. Execution in workflows requires the server to set ENABLE_CUSTOM_ACTIVITY_CODE=true (see code_execution_enabled in responses).
         */
        post: operations["createWorkflowActivity"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflow-activities/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create an activity from a portable export
         * @description Body: the JSON from GET /workflow-activities/{id}/export. Saving never runs the code. Execution in workflows requires the server to set ENABLE_CUSTOM_ACTIVITY_CODE=true (see code_execution_enabled in responses).
         */
        post: operations["importWorkflowActivity"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflow-activities/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an activity with source code, manifest and readiness findings */
        get: operations["getWorkflowActivity"];
        put?: never;
        post?: never;
        /** Delete an activity */
        delete: operations["deleteWorkflowActivity"];
        options?: never;
        head?: never;
        /**
         * Update an activity (omitted fields are kept)
         * @description Saving never runs the code. Execution in workflows requires the server to set ENABLE_CUSTOM_ACTIVITY_CODE=true (see code_execution_enabled in responses). The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateWorkflowActivity"];
        trace?: never;
    };
    "/workflow-activities/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export an activity as portable JSON (accepted by POST /workflow-activities/import) */
        get: operations["exportWorkflowActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List saved reports */
        get: operations["listReports"];
        put?: never;
        /** Create a saved report */
        post: operations["createReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a saved report */
        get: operations["getReport"];
        /**
         * Update a saved report
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        put: operations["updateReport"];
        post?: never;
        /** Delete a saved report */
        delete: operations["deleteReport"];
        options?: never;
        head?: never;
        /**
         * Update a saved report (same as PUT)
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["patchReport"];
        trace?: never;
    };
    "/reports/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run a report configuration without saving it
         * @description Also accepts a signed-in browser session. Returns a bare JSON body (no envelope).
         */
        post: operations["previewReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List report data sources
         * @description Also accepts a signed-in browser session. Returns a bare JSON body (no envelope).
         */
        get: operations["listReportSources"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export a saved report as portable JSON */
        get: operations["exportReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a saved report from an export document */
        post: operations["importReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/retention-policies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List retention policies */
        get: operations["listRetentionPolicies"];
        put?: never;
        /** Create a retention policy */
        post: operations["createRetentionPolicy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/retention-policies/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a retention policy */
        get: operations["getRetentionPolicy"];
        /**
         * Update a retention policy
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        put: operations["updateRetentionPolicy"];
        post?: never;
        /** Delete a retention policy */
        delete: operations["deleteRetentionPolicy"];
        options?: never;
        head?: never;
        /**
         * Update a retention policy (same as PUT)
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["patchRetentionPolicy"];
        trace?: never;
    };
    "/retention-policies/{id}/assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List assets governed by a retention policy */
        get: operations["getRetentionPolicyAssets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/retention-policies/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Assign (or clear) the retention policy on an asset */
        post: operations["assignRetentionPolicy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List system and custom roles with their permissions */
        get: operations["listRoles"];
        put?: never;
        /**
         * Create a custom role
         * @description System roles keep their name and cannot be deleted; their description and permissions can be edited. Unknown permission keys are dropped.
         */
        post: operations["createRole"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/roles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a role */
        get: operations["getRole"];
        put?: never;
        post?: never;
        /** Delete a custom role (its assignments are removed; 409 for system roles) */
        delete: operations["deleteRole"];
        options?: never;
        head?: never;
        /**
         * Update a role
         * @description System roles keep their name and cannot be deleted; their description and permissions can be edited. Unknown permission keys are dropped. The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateRole"];
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List workspace users */
        get: operations["listUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/roles/{roleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Give a user a role (idempotent) */
        put: operations["assignUserRole"];
        post?: never;
        /** Remove a role from a user */
        delete: operations["removeUserRole"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/manager": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A member's manager, manager chain and direct reports */
        get: operations["getUserManager"];
        /**
         * Set or clear a member's manager in this workspace
         * @description Reporting lines drive the manager view (GET /tasks?scope=reports) and who may act on a workflow task on behalf of its assignee. Directory sync overwrites lines for users it manages when the provider has a manager attribute.
         */
        put: operations["setUserManager"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A member's reports (direct, or all levels with indirect=true) */
        get: operations["listUserReports"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/teams": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List teams with member counts */
        get: operations["listTeams"];
        put?: never;
        /** Create a team */
        post: operations["createTeam"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/teams/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a team with its members */
        get: operations["getTeam"];
        put?: never;
        post?: never;
        /** Delete a team and its memberships */
        delete: operations["deleteTeam"];
        options?: never;
        head?: never;
        /**
         * Update a team
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateTeam"];
        trace?: never;
    };
    "/teams/{id}/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Add a user to a team (idempotent) */
        put: operations["addTeamMember"];
        post?: never;
        /** Remove a user from a team */
        delete: operations["removeTeamMember"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List invitations (pending by default) */
        get: operations["listInvitations"];
        put?: never;
        /**
         * Invite someone to the workspace by email
         * @description The acceptance link is emailed to the invitee and expires after 7 days; the token itself is never returned.
         */
        post: operations["sendInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invitations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke an invitation (its link stops working) */
        delete: operations["revokeInvitation"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invitations/{id}/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Email a pending invitation again with a fresh link and expiry
         * @description The acceptance link is emailed to the invitee and expires after 7 days; the token itself is never returned.
         */
        post: operations["resendInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit-log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Query the object audit log (newest first)
         * @description Every create, update, delete, publish, grant and revoke recorded across the workspace, with the actor and a short diff.
         */
        get: operations["listAuditLog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspace-theme": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the workspace theme (any member) */
        get: operations["getWorkspaceTheme"];
        /**
         * Replace the workspace theme
         * @description Send the whole theme. Applies to every member of the workspace immediately. Colours must be hex/rgb()/hsl(); fonts are curated Google Fonts, system stacks or woff2 uploads (POST /workspace-theme/fonts); logos must be uploads in this workspace. Themes whose button or navigation text is below 3:1 contrast are refused. The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        put: operations["updateWorkspaceTheme"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspace-theme/apply-preset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Replace the workspace theme with a built-in template
         * @description Applies to every member immediately (logos and uploaded fonts are not kept).
         */
        post: operations["applyWorkspaceThemePreset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspace-theme/presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the built-in theme templates */
        get: operations["listWorkspaceThemePresets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspace-theme/fonts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload a woff2 font for the workspace theme
         * @description Send multipart/form-data (`file`, optional `family`) or this JSON body. woff2 only, at most 1 MB. Returns the font reference to use in typography.sans / display / mono; the theme itself is not changed.
         */
        post: operations["uploadWorkspaceThemeFont"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List API keys (never the key itself) */
        get: operations["listApiKeys"];
        put?: never;
        /**
         * Create an API key (the key is shown once)
         * @description A new key can never exceed the caller: permissions must be a subset of the caller's (omit to inherit them), workflow/table scopes must be within the caller's own scopes when the caller is scoped, user-context callers can only create user keys for themselves, and OAuth callers need the keys:write scope and must set expires_in_days (at most 90). Rate-limited. The plaintext key is returned once, in this response only.
         */
        post: operations["createApiKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api-keys/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke an API key (kept for history, stops authenticating) */
        post: operations["revokeApiKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api-keys/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete an API key */
        delete: operations["deleteApiKey"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workflows/{id}/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the inbound webhooks of a workflow (secrets are never returned) */
        get: operations["listWorkflowWebhooks"];
        put?: never;
        /**
         * Create an inbound webhook that triggers the workflow
         * @description Callers POST to the returned url with `Authorization: Bearer <secret>`. The secret is shown only in this response.
         */
        post: operations["createWorkflowWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a webhook (the secret is never returned) */
        get: operations["getWebhook"];
        put?: never;
        post?: never;
        /** Delete a webhook */
        delete: operations["deleteWebhook"];
        options?: never;
        head?: never;
        /**
         * Update a webhook slug, payload mapping or active flag
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateWebhook"];
        trace?: never;
    };
    "/webhooks/{id}/rotate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Replace a webhook secret (the old one stops working)
         * @description Callers POST to the returned url with `Authorization: Bearer <secret>`. The secret is shown only in this response.
         */
        post: operations["rotateWebhookSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/github-sync/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Connection status, pending changes and latest run/deployment */
        get: operations["getGitHubSyncStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/github-sync/commit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Commit pending changes to the repository */
        post: operations["commitGitHubSync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/github-sync/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List sync runs */
        get: operations["listGitHubSyncRuns"];
        put?: never;
        /** Enqueue a full, pending-change or scoped sync */
        post: operations["startGitHubSyncRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/github-sync/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a sync run */
        get: operations["getGitHubSyncRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/github-sync/deploy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deploy the repository manifest into this workspace */
        post: operations["deployGitHubSync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/github-sync/deployments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List deployments */
        get: operations["listGitHubSyncDeployments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/github-sync/deployments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a deployment */
        get: operations["getGitHubSyncDeployment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/github-sync/schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the scheduled sync configuration */
        get: operations["getGitHubSyncSchedule"];
        /** Set the scheduled sync configuration */
        put: operations["setGitHubSyncSchedule"];
        post?: never;
        /** Disable scheduled sync */
        delete: operations["deleteGitHubSyncSchedule"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/directory-sync/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List directory connections (Entra ID, Okta, LDAP, Google Workspace, SCIM) with sync state */
        get: operations["listDirectoryConnections"];
        put?: never;
        /**
         * Connect a directory (the connection is verified before it is saved)
         * @description Settings: ldap { url, start_tls?, ca_cert?, tls_reject_unauthorized?, tls_server_name?, bind_dn, base_dn, user_base_dn?, group_base_dn?, flavor? (active_directory|openldap|generic), user_filter?, group_filter?, attributes? { id, username, email, display_name, first_name, last_name, group_name, group_description, member }, nested_groups?, page_size?, timeout_ms?, deprovision_missing?, bind_login?, login_attributes? }; google { admin_email, customer?, domain?, user_query?, deprovision_missing? }; scim { rate_limit_per_minute? }; every pull provider: sync_interval_minutes? (default 60, minimum 10). Credentials: entra { tenant_id, client_id, client_secret }; okta { org_url, api_token }; ldap { bind_password }; google { service_account_json }; scim: none (use SCIM tokens). Write-only: reads show __SECRET__; values may be secret://tenants/<workspace id>/<name>.
         */
        post: operations["createDirectoryConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/directory-sync/connections/{provider}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a directory connection (credentials masked) */
        get: operations["getDirectoryConnection"];
        put?: never;
        post?: never;
        /** Disconnect a directory: syncing stops and credentials are removed (SCIM: every token is revoked). Links and accounts are kept. */
        delete: operations["deleteDirectoryConnection"];
        options?: never;
        head?: never;
        /**
         * Update a directory connection (re-verified when settings or credentials change)
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateDirectoryConnection"];
        trace?: never;
    };
    "/directory-sync/connections/{provider}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Test a directory connection (optionally with unsaved settings/credentials)
         * @description LDAP: connects (TLS as configured), binds, reads the base DN and counts users and groups with the filters, returning a mapped sample and warnings.
         */
        post: operations["testDirectoryConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/directory-sync/connections/{provider}/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start a sync run now (runs in the background) */
        post: operations["startDirectorySync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/directory-sync/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List directory sync runs, newest first */
        get: operations["listDirectorySyncRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/directory-sync/scim-tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List SCIM tokens (never the tokens themselves) */
        get: operations["listScimTokens"];
        put?: never;
        /** Create a SCIM token for the identity provider (shown once); enables SCIM provisioning */
        post: operations["createScimToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/directory-sync/scim-tokens/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke and delete a SCIM token */
        delete: operations["deleteScimToken"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/directory-sync/scim-tokens/{id}/rotate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Replace a SCIM token with a new one (same name and scopes); the old one stops working now or after grace_minutes */
        post: operations["rotateScimToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/config/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export workspace configuration as config-as-code files
         * @description Same layout as a GitHub-sync repository. Each section needs its own view permission; sections the caller cannot view are listed in `skipped`. Secrets are always replaced with "__SECRET__".
         */
        get: operations["exportConfig"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/config/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Apply config-as-code files (create or update; never deletes)
         * @description Returns a per-asset plan (create / update / unchanged / error) with field diffs. Identity: same id in this workspace → id mapping from an earlier apply or deploy → (adopt_by_name) unique name → create. "__SECRET__" keeps the stored secret. Needs view permission on every section present plus create/edit for the sections that change; limits 5 MB and 2000 assets.
         */
        post: operations["applyConfig"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/packages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List packages authored in this workspace */
        get: operations["listPackages"];
        put?: never;
        /** Create a package from root artifacts (dependencies are included automatically) */
        post: operations["createPackage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/packages/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview what a package of these roots would contain (dependencies and requirements) */
        post: operations["previewPackage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/packages/inspect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify and describe a .utpkg file (nothing is installed) */
        post: operations["inspectPackage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/packages/assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search the assets a package can contain (every type, paged, with counts)
         * @description Server-side search across workflows, custom steps, data tables, integrations (and their references), connectors, decision tables, email templates, agents, reports, roles, MCP servers, retention policies and log destinations. Only types you may view are searched (`hidden_types` lists the others). Cursor-paged: pass next_cursor as `after` with the same filters. `total` and `counts` (per type) cover every match, not just the page.
         */
        get: operations["searchPackageAssets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/packages/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a package and its recent versions */
        get: operations["getPackage"];
        put?: never;
        post?: never;
        /** Delete a package and its built versions (installs elsewhere are unaffected) */
        delete: operations["deletePackage"];
        options?: never;
        head?: never;
        /**
         * Update a package (metadata, items, data modes)
         * @description The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updatePackage"];
        trace?: never;
    };
    "/packages/{id}/contents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** What the package contains now: artifacts (and why), data modes, requirements */
        get: operations["getPackageContents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/packages/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List built versions of a package */
        get: operations["listPackageVersions"];
        put?: never;
        /**
         * Build, sign and publish a new version (.utpkg)
         * @description Exports every artifact with secrets removed (each credential becomes a requirement), adds data rows for tables in "rows" mode, signs with the instance key and stores the version. `usertasks packages build -o file.utpkg` builds and downloads in one step.
         */
        post: operations["buildPackageVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/packages/{id}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a built version (its manifest: requirements, files, checksum, signature) */
        get: operations["getPackageVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/packages/{id}/versions/{versionId}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download a built version as a .utpkg file (base64 in JSON) */
        get: operations["downloadPackageVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/package-installs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The package library: installed packages with version, source and status */
        get: operations["listPackageInstalls"];
        put?: never;
        /**
         * Install or upgrade a package (upgrade in place when it is installed already)
         * @description Verifies checksum and signature (tampered packages are refused), applies the assets (each section also needs its own create / edit permission) and records the install. Missing required values fail the install unless keep_incomplete: affected assets are then disabled and dependent workflows cannot be activated until POST /package-installs/{id}/complete. Upgrades keep local requirement values.
         */
        post: operations["installPackage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/package-installs/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dry run: verify a package and show what installing or upgrading it would do
         * @description Per asset create / update / unchanged with field diffs (upgrade in place: assets map onto their earlier install), locally modified assets, assets removed in this version (never deleted), requirement status, data rows and dependencies. `blockers` lists why a real install would be refused.
         */
        post: operations["planPackageInstall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/package-installs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** An installed package: requirement checklist and installed assets */
        get: operations["getPackageInstall"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/package-installs/{id}/upgrade": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upgrade an installed package to the version in the file (dry_run for the diff) */
        post: operations["upgradePackageInstall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/package-installs/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Complete setup: fill missing requirement values and enable what they unblock */
        post: operations["completePackageInstall"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/package-installs/{id}/uninstall": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Uninstall: remove package-owned assets (dry_run lists them; locally changed assets and tables with rows are kept unless force / delete_data)
         * @description The dry run lists every asset and what happens to it (delete / skip with the reason / gone), rows of data tables, unfinished runs of the package's workflows (`active_runs`) and `blockers`: missing delete permissions of a section, or runs in progress unless cancel_runs. Recorded in the package history.
         */
        post: operations["uninstallPackage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/package-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Package history: every install, upgrade, reconfigure (complete setup) and uninstall, failed attempts included (newest first)
         * @description Who, when, channel (UI / CLI / API / MCP), version from → to, signature status, counts, requirement changes and errors. Uninstalled packages keep their history. GET /package-events/{id} adds the full plan / diff that was applied.
         */
        get: operations["listPackageEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/package-events/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One package history event with the full plan / diff that was applied (secrets masked) */
        get: operations["getPackageEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List background jobs
         * @description Jobs started by this credential's user (tenant keys: by this key), newest first. scope=tenant lists every job of the workspace (needs settings.edit).
         */
        get: operations["listJobs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a background job (status, progress, result summary) */
        get: operations["getJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel a queued or running job
         * @description Queued jobs stop at once; running jobs stop at their next progress report (work already done is kept).
         */
        post: operations["cancelJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start a failed or cancelled job again
         * @description Creates a new job with the same input, checked against the caller's current permissions.
         */
        post: operations["retryJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{id}/result": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The JSON result of a finished job
         * @description For async API requests: exactly the `data` the synchronous request would have returned. 409 while the job is not finished, 410 once expired.
         */
        get: operations["getJobResult"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download the result file of a finished job
         * @description The file itself (Content-Disposition: attachment). Owner only; 409 while the job is not finished, 410 once expired. CLI: `usertasks jobs download <id>`.
         */
        get: operations["downloadJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List events from the unified event stream (oldest first, cursor paged)
         * @description Workflow, integration, agent, task, system, audit and security events, retained for 72 hours by default. Pass next_cursor as `after` to read the next page.
         */
        get: operations["listEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stream events live (Server-Sent Events)
         * @description Server-Sent Events (`text/event-stream`). Each event is `id: <event id>`, `event: <type>`, `data: <Event JSON>`. New events are polled every second; a `: heartbeat` comment is sent every 15 s. The server ends the stream shortly before its time limit with `event: reconnect` (data `{ "after": "<cursor>" }`): reconnect with `Last-Event-ID` (or `after`) set to the last id to continue without gaps. Delivery is at-least-once; dedupe on `id`.
         */
        get: operations["streamEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/log-destinations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List log export destinations (credentials masked) */
        get: operations["listLogDestinations"];
        put?: never;
        /**
         * Create a log export destination (Splunk HEC, Datadog, OTLP/HTTP, webhook, syslog, Azure Monitor, Event Hubs, Cloud Logging, Pub/Sub, CloudWatch Logs)
         * @description Needs settings.edit and observability.view (and settings.view when audit/security events can be exported). URLs are checked against the egress policy. Credentials are write-only (masked as __SECRET__). For webhook destinations without a signing_secret one is generated and returned once as `signing_secret`.
         */
        post: operations["createLogDestination"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/log-destinations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a log export destination (credentials masked) */
        get: operations["getLogDestination"];
        put?: never;
        post?: never;
        /** Delete a log export destination */
        delete: operations["deleteLogDestination"];
        options?: never;
        head?: never;
        /**
         * Update a log export destination
         * @description Credentials are write-only (masked as __SECRET__). For webhook destinations without a signing_secret one is generated and returned once as `signing_secret`. The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.
         */
        patch: operations["updateLogDestination"];
        trace?: never;
    };
    "/log-destinations/{id}/reset-cursor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move a destination's cursor to now or to the start of retention */
        post: operations["resetLogDestinationCursor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/log-destinations/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Delivery status of a destination: lag, last success and last error */
        get: operations["getLogDestinationStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/log-destinations/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send one synthetic system.test event through the destination's formatter and connection
         * @description Uses the same formatting, egress checks and 10 s timeout as the shipper. The cursor, status and delivery stats are not changed.
         */
        post: operations["testLogDestination"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Error: {
            /** @constant */
            success: false;
            error: string;
            /** @description Machine-readable error code (newer endpoints) */
            code?: string;
            /** @description Structured detail, e.g. validation issues */
            details?: unknown;
        };
        Event: {
            /** @description Global, monotonic event id: the cursor (`after`, SSE `id:`) and a stable dedupe key */
            id: number;
            /** @description ISO timestamp */
            occurred_at: string;
            /** @description Dotted event type, e.g. workflow.run.completed, integration.call, audit.workflow.update, task.completed */
            type: string;
            /** @enum {string} */
            category: "workflow" | "integration" | "agent" | "audit" | "security" | "task" | "system";
            /** @enum {string} */
            severity: "debug" | "info" | "warn" | "error";
            message: string;
            /** @description Table the event was normalized from */
            source_table: string;
            source_id: string | null;
            trace_id: string | null;
            run_id: string | null;
            workflow_id: string | null;
            task_id: string | null;
            actor_id: string | null;
            /** @description Allow-listed, source-specific fields (never bodies, headers, prompts or credentials) */
            attributes: {
                [key: string]: unknown;
            };
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            tenant: {
                                id: string;
                                name: string | null;
                                slug: string | null;
                            };
                            /** @description Bound user (null for tenant-wide credentials) */
                            user: {
                                id: string;
                                email: string | null;
                            } | null;
                            auth: {
                                /** @enum {string} */
                                kind: "api_key" | "oauth";
                                /** @enum {string} */
                                key_type: "tenant" | "user";
                                /** @description Granted OAuth scopes (null for API keys) */
                                oauth_scopes: string[] | null;
                                /** @description Credential expiry, if any */
                                expires_at: string | null;
                            };
                            permissions: string[];
                            /** @description Per-key resource allowlists (empty = unrestricted) */
                            resource_scopes: {
                                workflow_ids: string[];
                                table_ids: string[];
                            };
                        };
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getOpenApiSpec: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        openapi: string;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    listWorkflows: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Only active workflows (default true; pass false for all) */
                active?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflows: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createWorkflow: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @default webhook_received */
                    trigger_type?: string;
                    nodes: ({
                        id: string;
                        type: string;
                        label: string;
                        position: {
                            x: number;
                            y: number;
                        };
                        /** @default {} */
                        config?: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        onError?: "stop" | "continue";
                        /** @enum {string} */
                        executionMode?: "sync" | "async";
                        collapsed?: boolean;
                        sectionId?: string;
                    } & {
                        [key: string]: unknown;
                    })[];
                    /** @default [] */
                    edges?: ({
                        id: string;
                        source: string;
                        target: string;
                        label?: string;
                        /** @enum {string} */
                        sourcePort?: "bottom" | "left" | "right";
                    } & {
                        [key: string]: unknown;
                    })[];
                    /** @default [] */
                    user_variables?: ({
                        id: string;
                        name: string;
                        /**
                         * @description string, number, boolean or object
                         * @default string
                         */
                        type?: string;
                        /** @default  */
                        defaultValue?: string;
                        /** @default  */
                        description?: string;
                        /** @description Input label in the Run dialog (default: from the name) */
                        label?: string;
                        /** @description Starts must supply a value unless there is a default */
                        required?: boolean;
                        /** @description Refines a string input: text, date, datetime, email, url or select */
                        format?: string;
                        /** @description Choices of a select input (comma-separated string or array) */
                        options?: string | unknown[];
                    } & {
                        [key: string]: unknown;
                    })[];
                    description?: string | null;
                    trigger_config?: {
                        [key: string]: unknown;
                    } | null;
                    swimlanes?: unknown[] | null;
                    sections?: unknown[] | null;
                    tags?: string[] | null;
                    /** @default false */
                    is_active?: boolean;
                    /**
                     * @description Also publish version 1 (needs workflows.activate)
                     * @default false
                     */
                    publish?: boolean;
                    publish_notes?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflow_id: string;
                            name: string;
                            published: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getWorkflow: {
        parameters: {
            query?: {
                /** @description Include detail for this run */
                run_id?: string;
                /** @description Include node logs for the selected run */
                include_logs?: "true" | "false";
                /** @description Include the draft definition (author payload) */
                include_definition?: "true" | "false";
            };
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflow: {
                                [key: string]: unknown;
                            };
                            current_run: unknown;
                            recent_runs: {
                                [key: string]: unknown;
                            }[];
                            definition?: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteWorkflow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateWorkflowDefinition: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    trigger_type?: string;
                    /** @description Replaces all nodes */
                    nodes?: ({
                        id: string;
                        type: string;
                        label: string;
                        position: {
                            x: number;
                            y: number;
                        };
                        /** @default {} */
                        config?: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        onError?: "stop" | "continue";
                        /** @enum {string} */
                        executionMode?: "sync" | "async";
                        collapsed?: boolean;
                        sectionId?: string;
                    } & {
                        [key: string]: unknown;
                    })[];
                    /** @description Replaces all edges */
                    edges?: ({
                        id: string;
                        source: string;
                        target: string;
                        label?: string;
                        /** @enum {string} */
                        sourcePort?: "bottom" | "left" | "right";
                    } & {
                        [key: string]: unknown;
                    })[];
                    user_variables?: ({
                        id: string;
                        name: string;
                        /**
                         * @description string, number, boolean or object
                         * @default string
                         */
                        type?: string;
                        /** @default  */
                        defaultValue?: string;
                        /** @default  */
                        description?: string;
                        /** @description Input label in the Run dialog (default: from the name) */
                        label?: string;
                        /** @description Starts must supply a value unless there is a default */
                        required?: boolean;
                        /** @description Refines a string input: text, date, datetime, email, url or select */
                        format?: string;
                        /** @description Choices of a select input (comma-separated string or array) */
                        options?: string | unknown[];
                    } & {
                        [key: string]: unknown;
                    })[] | null;
                    description?: string | null;
                    trigger_config?: {
                        [key: string]: unknown;
                    } | null;
                    swimlanes?: unknown[] | null;
                    sections?: unknown[] | null;
                    tags?: string[] | null;
                    /** @description Changing it needs workflows.activate */
                    is_active?: boolean;
                    /**
                     * @description Publish the saved draft as a new version (needs workflows.activate)
                     * @default false
                     */
                    publish?: boolean;
                    publish_notes?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflow_id: string;
                            changed: boolean;
                            updated_fields: string[];
                            published: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getWorkflowDefinition: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            name: string;
                            description: string | null;
                            trigger_type: string;
                            trigger_config: {
                                [key: string]: unknown;
                            };
                            nodes: {
                                [key: string]: unknown;
                            }[];
                            edges: {
                                [key: string]: unknown;
                            }[];
                            user_variables: {
                                [key: string]: unknown;
                            }[];
                            swimlanes: unknown[];
                            sections: unknown[];
                            tags: string[];
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    publishWorkflow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Publish notes describing what changed */
                    notes?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflow_id: string;
                            /** @constant */
                            published: true;
                            version_number: number;
                            version_id: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    startWorkflow: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    workflow_id: string;
                    /** @description Input values keyed by input name (GET /workflows/{id}/inputs lists them). Declared inputs are validated and coerced to their type; other keys pass through unchanged. */
                    variables?: {
                        [key: string]: unknown;
                    };
                    /** @default false */
                    async?: boolean;
                    /** Format: uuid */
                    task_id?: string;
                    /** @default 50 */
                    priority?: number;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @enum {string} */
                            mode: "sync" | "async";
                            run_id?: string | null;
                            job_id?: string;
                            status?: string;
                            warnings?: string[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getWorkflowInputs: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflow_id: string;
                            workflow_name: string;
                            is_active: boolean;
                            published: boolean;
                            /** @enum {string} */
                            source: "published" | "draft";
                            version_id: string | null;
                            version_number: number | null;
                            fields: ({
                                key: string;
                                label: string;
                                /** @enum {string} */
                                type: "text" | "number" | "boolean" | "date" | "datetime" | "json" | "select" | "email" | "url";
                                required: boolean;
                                /** @description Typed default, or null */
                                default: unknown;
                                description: string | null;
                                options: ({
                                    value: string;
                                    label: string;
                                } & {
                                    [key: string]: unknown;
                                })[] | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                            /** @description The start form designed in the form designer: grid rows (1-4 columns, cells reference field keys) and the resolved mini theme. Null for the plain one-column form. */
                            start_form?: ({
                                layout: ({
                                    rows: ({
                                        columns: number;
                                        cells: ({
                                            field_key: string;
                                            span: number;
                                        } & {
                                            [key: string]: unknown;
                                        })[];
                                    } & {
                                        [key: string]: unknown;
                                    })[];
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                theme: {
                                    [key: string]: unknown;
                                } | null;
                            } & {
                                [key: string]: unknown;
                            }) | null;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    completeWorkflowEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    return_variables?: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            run_id: string;
                            status: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listWorkflowRuns: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                workflow_id?: string;
                /** @description Only runs of this workflow version */
                version_id?: string;
                /** @description Run statuses (running, waiting_for_event, paused, completed, failed, migrated) (comma-separated) */
                status?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            runs: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getWorkflowRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            run: {
                                [key: string]: unknown;
                            };
                            logs: {
                                [key: string]: unknown;
                            }[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    actOnWorkflowRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    action: "pause" | "resume" | "cancel";
                    return_variables?: {
                        [key: string]: unknown;
                    };
                    goto_node_id?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            action: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listWorkflowQueue: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                workflow_id?: string;
                /** @description Job statuses (comma-separated) */
                status?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            jobs: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    actOnWorkflowJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    action: "cancel" | "retry";
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            action: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    activateWorkflow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            id: string;
                            is_active: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deactivateWorkflow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            id: string;
                            is_active: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listWorkflowVersions: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
            };
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            versions: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getWorkflowVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Workflow id */
                id: string;
                /** @description Version id */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            version: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listWorkflowInstances: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description active (default) = waiting_for_event and paused */
                status?: "active" | "waiting_for_event" | "paused";
                /** @description Only instances on this version */
                version_id?: string;
            };
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            instances: ({
                                run_id: string;
                                status: string;
                                version_id: string | null;
                                version_number: number | null;
                                current_node_id: string | null;
                                current_node_label: string | null;
                                current_node_type: string | null;
                                waiting_since: string | null;
                                open_task: {
                                    [key: string]: unknown;
                                } | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                            published_version_id: string | null;
                            versions: ({
                                version_id: string | null;
                                version_number: number | null;
                                is_published: boolean;
                                instances: number;
                            } & {
                                [key: string]: unknown;
                            })[];
                            on_older_versions: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    migrateWorkflowInstances: {
        parameters: {
            query?: {
                /** @description true: run as a background job and return 202 with it (same as Prefer: respond-async) */
                async?: "true" | "false";
            };
            header?: {
                /** @description respond-async: run as a background job (202) */
                Prefer?: string;
            };
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Version the instances continue on (any version of this workflow) */
                    to_version_id: string;
                    /** @description Instances to migrate (at most 500) */
                    run_ids?: string[];
                    /** @description Migrate every live instance on this version */
                    from_version_id?: string;
                    /** @description Migrate every live instance not already on to_version_id (500 per request; `truncated` says more remain) */
                    all_active?: boolean;
                    /** @description Current node id → node id in the target version where the instance continues */
                    node_map?: {
                        [key: string]: string;
                    };
                    /** @description Target node for instances whose node is not in node_map (default: the node with the same id) */
                    default_target_node_id?: string;
                    /**
                     * @description Only plan: list each instance → target node, what is closed and created, warnings
                     * @default false
                     */
                    dry_run?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            dry_run: boolean;
                            plan: {
                                to_version: {
                                    [key: string]: unknown;
                                };
                                items: ({
                                    run_id: string;
                                    ok: boolean;
                                    blocked_reason: string | null;
                                    warnings: string[];
                                    source_node_id: string | null;
                                    target_node_id: string | null;
                                    target_via: string | null;
                                    close: {
                                        [key: string]: unknown;
                                    };
                                    create: {
                                        [key: string]: unknown;
                                    };
                                } & {
                                    [key: string]: unknown;
                                })[];
                                summary: {
                                    [key: string]: unknown;
                                };
                                truncated: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                            results: ({
                                run_id: string;
                                ok: boolean;
                                conflict?: boolean;
                                error?: string;
                                new_run_id?: string;
                                new_status?: string;
                            } & {
                                [key: string]: unknown;
                            })[];
                            summary: {
                                migrated: number;
                                skipped: number;
                                failed: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Accepted (async=true or Prefer: respond-async): a background job. Poll GET /jobs/{id}; the result is GET /jobs/{id}/result. */
            202: {
                headers: {
                    /** @description The job: /api/v1/jobs/{id} */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listTasks: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description reports: open tasks of your direct reports (add indirect=true for all levels) */
                scope?: "all" | "reports";
                /** @description scope=reports: include indirect reports (reports of reports, up to 10 levels) */
                indirect?: "true" | "false";
                /** @description scope=reports: only overdue tasks */
                overdue?: "true" | "false";
                /** @description scope=reports: only tasks whose run SLA is breached or whose escalation fired */
                sla_breached?: "true" | "false";
                /** @description scope=reports: tasks of one workflow */
                workflow_id?: string;
                /** @description Task statuses (comma-separated) */
                status?: string;
                /** @description Priorities (comma-separated) */
                priority?: string;
                assignee_id?: string;
                /** @description Filter workflow-generated tasks */
                is_workflow_task?: "true" | "false";
                parent_task_id?: string;
                /** @description Return `description` as plain text (HTML stripped). `description_text` is always included. */
                strip_html?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            tasks: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listAssignedTasks: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                assignee_id?: string;
                team_id?: string;
                /** @description Task statuses (default todo,in_progress) (comma-separated) */
                status?: string;
                /** @description Acceptance statuses (comma-separated) */
                acceptance_status?: string;
                /** @description Return `description` as plain text (HTML stripped). `description_text` is always included. */
                strip_html?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            tasks: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getTask: {
        parameters: {
            query?: {
                /** @description Return `description` as plain text (HTML stripped). `description_text` is always included. */
                strip_html?: "true" | "false";
            };
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            task: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title?: string;
                    /** @description Plain text or HTML. HTML is sanitised to an allowlist (formatting, lists, headings, links, tables, https images); scripts, styles, event handlers and unsafe URLs are removed. */
                    description?: string | null;
                    /**
                     * @description Complete through POST /tasks/{id}/action instead
                     * @enum {string}
                     */
                    status?: "draft" | "todo" | "in_progress" | "blocked" | "cancelled";
                    /** @enum {string} */
                    priority?: "critical" | "high" | "medium" | "low" | "none";
                    /** @description ISO 8601 */
                    due_date?: string | null;
                    progress_pct?: number | null;
                    /** @description ISO 8601 */
                    estimated_completion?: string | null;
                    tags?: string[] | null;
                    /** @description User Task field values (validated against the task's fields; saved as a draft, required fields are checked on completion) */
                    values?: {
                        [key: string]: unknown;
                    };
                    /** @description Save a workflow task's values for its assignee (their manager, or tasks.complete_any) */
                    on_behalf?: boolean;
                    on_behalf_note?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            task: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    actOnTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    action: "accept" | "hold" | "reject" | "complete" | "escalate" | "redirect";
                    outcome?: string;
                    outcome_notes?: string;
                    /** Format: uuid */
                    target_user_id?: string;
                    target_user_ids?: string[];
                    /** Format: email */
                    target_email?: string;
                    target_emails?: string[];
                    invite_if_needed?: boolean;
                    /** @enum {string} */
                    invite_role?: "owner" | "admin" | "manager" | "member" | "viewer";
                    comment?: string;
                    values?: {
                        [key: string]: unknown;
                    };
                    /** @description Act for the assignee of a workflow task: their manager (anyone in their manager chain), or a holder of tasks.complete_any. Requires on_behalf_note */
                    on_behalf?: boolean;
                    /** @description Why you are acting on behalf (required with on_behalf; shown to the assignee and recorded in the task history) */
                    on_behalf_note?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            action: string;
                            /** @description complete on a workflow task: whether the paused run was queued to resume */
                            workflow_resumed?: boolean;
                            /** @description 'queued' — the rest of the workflow runs on the queue; poll the run by run_id */
                            workflow_status?: string;
                            /** @description The resumed workflow run */
                            run_id?: string;
                            /** @constant */
                            resumed?: "queued";
                            workflow_error?: string;
                            /**
                             * @description How the caller was allowed to act
                             * @enum {string}
                             */
                            acted_as?: "assignee" | "on_behalf" | "break_glass" | "credential";
                            /** @description The assignee acted for (on_behalf / break_glass) */
                            on_behalf_of?: string | null;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    lookupTaskField: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Key of an Autocomplete / lookup field of the task's form */
                    field_key: string;
                    /** @description The typed text (matched against the configured search columns / passed to the reference as {{search}}) */
                    query?: string;
                    /** @description The form's current values, for {{task_data.<key>}} placeholders in the lookup's filters or reference inputs */
                    values?: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            items: {
                                /** @description Stored as task_data.<key> when selected */
                                value: string;
                                label: string;
                                /** @description Secondary display text */
                                description?: string;
                                /** @description The configured display / value / fill fields of the item (task_data.<key>_item once saved) */
                                fields: {
                                    [key: string]: unknown;
                                };
                            }[];
                            /** @description More matches than max results */
                            truncated?: boolean;
                            /** @description Reference response served from the cache */
                            cached?: boolean;
                            /** @description Fewer characters than the field's minimum: nothing was queried */
                            too_short?: boolean;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ingestTask: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    /** @description Plain text or HTML. HTML is sanitised to an allowlist (formatting, lists, headings, links, tables, https images); scripts, styles, event handlers and unsafe URLs are removed. */
                    description?: string;
                    /**
                     * @default medium
                     * @enum {string}
                     */
                    priority?: "critical" | "high" | "medium" | "low" | "none";
                    due_date?: string;
                    /** Format: email */
                    assignee_email?: string;
                    estimated_effort?: number;
                    /** @default [] */
                    subtasks?: {
                        title: string;
                        /** @description Plain text or HTML. HTML is sanitised to an allowlist (formatting, lists, headings, links, tables, https images); scripts, styles, event handlers and unsafe URLs are removed. */
                        description?: string;
                        /** Format: email */
                        assignee_email?: string;
                        estimated_effort?: number;
                        sequence?: number;
                    }[];
                    workflow?: {
                        engine_type?: string;
                        instance_id?: string;
                        /** Format: uri */
                        callback_url?: string;
                        step_id?: string;
                        position?: string;
                    };
                    idempotency_key?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        task_id: string;
                        tenant_id?: string;
                        subtask_count?: number;
                        deduplicated?: boolean;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listAgents: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Filter by active flag */
                active?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            agents: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createAgent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    model?: string;
                    system_prompt?: string;
                    role?: string;
                    task?: string;
                    boundaries?: string;
                    tools?: unknown[];
                    output_config?: {
                        [key: string]: unknown;
                    };
                    integration_id?: string | null;
                    temperature?: number;
                    max_tokens?: number;
                    max_iterations?: number;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            agent: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getAgent: {
        parameters: {
            query?: {
                /** @description Include the 20 most recent runs */
                include_runs?: "true" | "false";
            };
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            agent: {
                                [key: string]: unknown;
                            };
                            runs?: {
                                [key: string]: unknown;
                            }[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateAgent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    model?: string;
                    system_prompt?: string;
                    role?: string;
                    task?: string;
                    boundaries?: string;
                    tools?: unknown[];
                    output_config?: {
                        [key: string]: unknown;
                    };
                    integration_id?: string | null;
                    temperature?: number;
                    max_tokens?: number;
                    max_iterations?: number;
                    is_active?: boolean;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            agent: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteAgent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                            deactivated_workflows: unknown;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchAgent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    model?: string;
                    system_prompt?: string;
                    role?: string;
                    task?: string;
                    boundaries?: string;
                    tools?: unknown[];
                    output_config?: {
                        [key: string]: unknown;
                    };
                    integration_id?: string | null;
                    temperature?: number;
                    max_tokens?: number;
                    max_iterations?: number;
                    is_active?: boolean;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            agent: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    executeAgent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    message: string;
                    shared_context?: unknown;
                    /** @description Queue the run and return a job id (202) */
                    async?: boolean;
                    max_iterations?: number;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            response?: unknown;
                            outputs?: unknown;
                            job_id?: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listAgentQueue: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                status?: string;
                agent_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            jobs: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listDecisionTables: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Name or description contains */
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            decision_tables: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createDecisionTable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    /** @default [] */
                    inputs?: ({
                        id?: string;
                        key: string;
                        label?: string | null;
                        /** @description Default text */
                        type?: ("text" | "number" | "boolean" | "date") | null;
                    } & {
                        [key: string]: unknown;
                    })[];
                    /** @default [] */
                    outputs?: ({
                        id?: string;
                        key: string;
                        label?: string | null;
                        /** @description Default text */
                        type?: ("text" | "number" | "boolean" | "date") | null;
                    } & {
                        [key: string]: unknown;
                    })[];
                    /**
                     * @description Ordered; the first enabled matching rule wins
                     * @default []
                     */
                    rules?: ({
                        id?: string;
                        label?: string | null;
                        /** @description Default true */
                        enabled?: boolean | null;
                        /**
                         * @description All must match
                         * @default []
                         */
                        conditions?: ({
                            id?: string;
                            inputKey: string;
                            /** @description equals, not_equals, contains, not_contains, starts_with, ends_with, greater_than, greater_than_or_equal, less_than, less_than_or_equal, is_empty, is_not_empty */
                            operator: string;
                            /** @description Comparison value (stored as a string) */
                            value?: unknown;
                        } & {
                            [key: string]: unknown;
                        })[];
                        /** @default {} */
                        outputs?: {
                            [key: string]: unknown;
                        };
                    } & {
                        [key: string]: unknown;
                    })[];
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            decision_table: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getDecisionTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            decision_table: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateDecisionTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    /** @description Replaces all inputs */
                    inputs?: ({
                        id?: string;
                        key: string;
                        label?: string | null;
                        /** @description Default text */
                        type?: ("text" | "number" | "boolean" | "date") | null;
                    } & {
                        [key: string]: unknown;
                    })[];
                    /** @description Replaces all outputs */
                    outputs?: ({
                        id?: string;
                        key: string;
                        label?: string | null;
                        /** @description Default text */
                        type?: ("text" | "number" | "boolean" | "date") | null;
                    } & {
                        [key: string]: unknown;
                    })[];
                    /** @description Replaces all rules */
                    rules?: ({
                        id?: string;
                        label?: string | null;
                        /** @description Default true */
                        enabled?: boolean | null;
                        /**
                         * @description All must match
                         * @default []
                         */
                        conditions?: ({
                            id?: string;
                            inputKey: string;
                            /** @description equals, not_equals, contains, not_contains, starts_with, ends_with, greater_than, greater_than_or_equal, less_than, less_than_or_equal, is_empty, is_not_empty */
                            operator: string;
                            /** @description Comparison value (stored as a string) */
                            value?: unknown;
                        } & {
                            [key: string]: unknown;
                        })[];
                        /** @default {} */
                        outputs?: {
                            [key: string]: unknown;
                        };
                    } & {
                        [key: string]: unknown;
                    })[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            decision_table: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteDecisionTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchDecisionTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    /** @description Replaces all inputs */
                    inputs?: ({
                        id?: string;
                        key: string;
                        label?: string | null;
                        /** @description Default text */
                        type?: ("text" | "number" | "boolean" | "date") | null;
                    } & {
                        [key: string]: unknown;
                    })[];
                    /** @description Replaces all outputs */
                    outputs?: ({
                        id?: string;
                        key: string;
                        label?: string | null;
                        /** @description Default text */
                        type?: ("text" | "number" | "boolean" | "date") | null;
                    } & {
                        [key: string]: unknown;
                    })[];
                    /** @description Replaces all rules */
                    rules?: ({
                        id?: string;
                        label?: string | null;
                        /** @description Default true */
                        enabled?: boolean | null;
                        /**
                         * @description All must match
                         * @default []
                         */
                        conditions?: ({
                            id?: string;
                            inputKey: string;
                            /** @description equals, not_equals, contains, not_contains, starts_with, ends_with, greater_than, greater_than_or_equal, less_than, less_than_or_equal, is_empty, is_not_empty */
                            operator: string;
                            /** @description Comparison value (stored as a string) */
                            value?: unknown;
                        } & {
                            [key: string]: unknown;
                        })[];
                        /** @default {} */
                        outputs?: {
                            [key: string]: unknown;
                        };
                    } & {
                        [key: string]: unknown;
                    })[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            decision_table: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    testDecisionTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default {} */
                    values?: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            matched: boolean;
                            rule: unknown;
                            outputs: unknown;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    exportDecisionTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            version: number;
                            /** @constant */
                            asset_type: "decision_table";
                            decision_table: {
                                name: string;
                                description: string | null;
                                inputs: unknown[];
                                outputs: unknown[];
                                rules: unknown[];
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    importDecisionTable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description An export document from GET /decision-tables/{id}/export (or send the table fields at the top level) */
                    decision_table?: {
                        [key: string]: unknown;
                    };
                    /** @description Table name, when the table is sent at the top level */
                    name?: string;
                    /** @description Replacement name */
                    name_override?: string;
                    /** @description Replacement description */
                    description_override?: string;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            decision_table: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listDataTables: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Name contains */
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            data_tables: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createDataTable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    /**
                     * @description Custom columns; the system ID and Date Created columns are added automatically
                     * @default []
                     */
                    columns?: ({
                        /** @description Stable column id (kept when given; matched by key otherwise) */
                        id?: string;
                        /** @description Canonical row-data key (default: slug of the name; never changes once set) */
                        key?: string;
                        /** @description Column label */
                        name: string;
                        /** @enum {string} */
                        type: "text" | "number" | "date" | "boolean" | "select" | "file" | "longtext" | "lookup";
                        required?: boolean;
                        /** @description Allowed values for select columns */
                        options?: string[];
                        /** @description Lookup config: sourceTableId, sourceColumn, filters, distinct, sortBy, sortDir */
                        lookup?: {
                            [key: string]: unknown;
                        };
                    } & {
                        [key: string]: unknown;
                    })[];
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            data_table: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getDataTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            data_table: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteDataTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateDataTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    /** @description Full replacement list of custom columns (system columns are kept) */
                    columns?: ({
                        /** @description Stable column id (kept when given; matched by key otherwise) */
                        id?: string;
                        /** @description Canonical row-data key (default: slug of the name; never changes once set) */
                        key?: string;
                        /** @description Column label */
                        name: string;
                        /** @enum {string} */
                        type: "text" | "number" | "date" | "boolean" | "select" | "file" | "longtext" | "lookup";
                        required?: boolean;
                        /** @description Allowed values for select columns */
                        options?: string[];
                        /** @description Lookup config: sourceTableId, sourceColumn, filters, distinct, sortBy, sortDir */
                        lookup?: {
                            [key: string]: unknown;
                        };
                    } & {
                        [key: string]: unknown;
                    })[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            data_table: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listDataRows: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Text matched against the row id and every cell */
                search?: string;
                /** @description JSON array of {field, operator, value}, e.g. [{"field":"status","operator":"equals","value":"open"}] */
                filters?: string;
                /** @description Sort: field, -field (descending) or field.desc / field.asc (default -created_at) */
                order?: string;
            };
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            rows: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                            truncated: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    upsertDataRows: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Single row: existing row to replace (omit to insert) */
                    row_id?: string;
                    /** @description Single row: cells keyed by column key (or name) */
                    data?: {
                        [key: string]: unknown;
                    };
                    /** @description Bulk: up to 500 rows, validated before any is written */
                    rows?: {
                        /** @description Existing row to replace (omit to insert) */
                        row_id?: string;
                        /** @description Cells keyed by column key (or name) */
                        data: {
                            [key: string]: unknown;
                        };
                    }[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            rows: ({
                                row_id: string;
                                /** @enum {string} */
                                action: "created" | "updated";
                                row: {
                                    [key: string]: unknown;
                                };
                            } & {
                                [key: string]: unknown;
                            })[];
                            created: number;
                            updated: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getDataRow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Table id */
                id: string;
                /** @description Row id */
                rowId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            row: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteDataRow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Table id */
                id: string;
                /** @description Row id */
                rowId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateDataRow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Table id */
                id: string;
                /** @description Row id */
                rowId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Cells to change; other cells are kept */
                    data: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            row: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    bulkDeleteDataRows: {
        parameters: {
            query?: {
                /** @description true: run as a background job and return 202 with it (same as Prefer: respond-async) */
                async?: "true" | "false";
            };
            header?: {
                /** @description respond-async: run as a background job (202) */
                Prefer?: string;
            };
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    row_ids: string[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            deleted: number;
                            ids: string[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Accepted (async=true or Prefer: respond-async): a background job. Poll GET /jobs/{id}; the result is GET /jobs/{id}/result. */
            202: {
                headers: {
                    /** @description The job: /api/v1/jobs/{id} */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listIntegrations: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Filter by active flag */
                active?: "true" | "false";
                /** @description Integration type (rest_api, odata, database, webhook or a connector key) */
                type?: string;
                /** @description Name contains */
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            integrations: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createIntegration: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @enum {string} */
                    type: "rest_api" | "odata" | "webhook" | "database";
                    /** @description REST/OData/webhook: { base_url, auth_type: none|api_key|bearer|basic|oauth2, auth_config: { token | key_name+key_value | username+password }, headers }. Database: { db_config: { db_type, host, port, database, username, password, ssl } } */
                    config: {
                        [key: string]: unknown;
                    };
                    tags?: string[];
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            integration: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    importOpenApiIntegration: {
        parameters: {
            query?: {
                /** @description Integration name override (raw-document bodies) */
                name?: string;
                /** @description Base URL override (raw-document bodies) */
                base_url?: string;
                /** @description Auth type override (raw-document bodies) */
                auth_type?: "none" | "api_key" | "bearer" | "basic";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description OpenAPI 2/3 or Postman document (object, or JSON/YAML text). Omit to send the document itself as the body. */
                    spec?: string | {
                        [key: string]: unknown;
                    };
                    name?: string;
                    base_url?: string;
                    auth_type?: string;
                    auth_config?: {
                        [key: string]: unknown;
                    };
                    selected_reference_indexes?: number[];
                    tags?: unknown[];
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            integration: {
                                [key: string]: unknown;
                            };
                            references_created: number;
                            imported_reference_names: string[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getIntegration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            integration: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteIntegration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateIntegration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    /** @description Full config object. Secrets are returned masked as "__SECRET__"; send the sentinel back to keep a stored value. */
                    config?: {
                        [key: string]: unknown;
                    };
                    is_active?: boolean;
                    tags?: string[] | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            integration: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    testIntegration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            status: string;
                            message: string;
                            http_status: number | null;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listIntegrationReferences: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Name/description contains */
                search?: string;
            };
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            references: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createReference: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    /** @description HTTP or database method (default GET) */
                    method?: string;
                    /** @description e.g. /users/{{id}} */
                    path_template?: string;
                    body_template?: string;
                    headers?: {
                        [key: string]: string;
                    };
                    query_params?: {
                        [key: string]: unknown;
                    };
                    /** @description Full request config; overrides the shorthand fields */
                    request_config?: {
                        [key: string]: unknown;
                    };
                    inputs?: {
                        [key: string]: unknown;
                    }[];
                    outputs?: {
                        [key: string]: unknown;
                    }[];
                    /** @description Response model: { source?, root: { type, description?, example?, fields?: [{ name, ...node }], items?: node } } (a bare root node is accepted). null clears it; it is then derived from outputs again. */
                    response_schema?: {
                        [key: string]: unknown;
                    } | null;
                    tags?: string[];
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            reference: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getReference: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            reference: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteReference: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateReference: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    /** @description Sets request_config.method */
                    method?: string;
                    request_config?: {
                        [key: string]: unknown;
                    };
                    inputs?: {
                        [key: string]: unknown;
                    }[];
                    outputs?: {
                        [key: string]: unknown;
                    }[];
                    /** @description Response model: { source?, root: { type, description?, example?, fields?: [{ name, ...node }], items?: node } } (a bare root node is accepted). null clears it; it is then derived from outputs again. */
                    response_schema?: {
                        [key: string]: unknown;
                    } | null;
                    tags?: string[] | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            reference: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    bulkDeleteReferences: {
        parameters: {
            query?: {
                /** @description true: run as a background job and return 202 with it (same as Prefer: respond-async) */
                async?: "true" | "false";
            };
            header?: {
                /** @description respond-async: run as a background job (202) */
                Prefer?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    ids: string[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            deleted: number;
                            ids: string[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Accepted (async=true or Prefer: respond-async): a background job. Poll GET /jobs/{id}; the result is GET /jobs/{id}/result. */
            202: {
                headers: {
                    /** @description The job: /api/v1/jobs/{id} */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    executeReference: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description Input values by input name
                     * @default {}
                     */
                    inputs?: {
                        [key: string]: unknown;
                    };
                    /** @description Fold a successful response into the reference's response model (inferred from the sample, merged with earlier samples) and return it as response_schema */
                    capture_schema?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            status: number;
                            data: unknown;
                            headers?: {
                                [key: string]: string;
                            };
                            response_schema?: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listObjects: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            objects: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createObject: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    sources: ({
                        /** @enum {string} */
                        source_type?: "table" | "reference";
                        /** @enum {string} */
                        sourceType?: "table" | "reference";
                        table_id?: string | null;
                        reference_id?: string | null;
                        alias: string;
                        is_primary?: boolean;
                        join_type?: ("inner" | "left" | "right" | "full" | "cross") | null;
                        join_on_local?: string | null;
                        join_on_foreign?: string | null;
                        join_to_alias?: string | null;
                    } & {
                        [key: string]: unknown;
                    })[];
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            object: {
                                [key: string]: unknown;
                            };
                            sources: {
                                [key: string]: unknown;
                            }[];
                            generated_reference: {
                                [key: string]: unknown;
                            } | null;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getObject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            object: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteObject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                            deleted_reference_count: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateObject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    /** @description Full replacement source list (rebuilds the generated reference outputs) */
                    sources?: ({
                        /** @enum {string} */
                        source_type?: "table" | "reference";
                        /** @enum {string} */
                        sourceType?: "table" | "reference";
                        table_id?: string | null;
                        reference_id?: string | null;
                        alias: string;
                        is_primary?: boolean;
                        join_type?: ("inner" | "left" | "right" | "full" | "cross") | null;
                        join_on_local?: string | null;
                        join_on_foreign?: string | null;
                        join_to_alias?: string | null;
                    } & {
                        [key: string]: unknown;
                    })[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            object: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getConnectorCatalog: {
        parameters: {
            query?: {
                category?: "cloud" | "communication" | "ai" | "payments" | "productivity" | "database";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            connectors: {
                                [key: string]: unknown;
                            }[];
                            count: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listConnectors: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Filter by enabled flag */
                enabled?: "true" | "false";
                /** @description Catalog key */
                connector_key?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            connectors: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createConnector: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Catalog key (see connectors catalog) */
                    connector_key: string;
                    display_name?: string;
                    /** @description Connector configuration fields */
                    config?: {
                        [key: string]: unknown;
                    };
                    /** @description Connector credential fields (write-only) */
                    credentials?: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            connector: {
                                [key: string]: unknown;
                            };
                            integration: {
                                [key: string]: unknown;
                            };
                            references_created: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getConnector: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            connector: {
                                [key: string]: unknown;
                            };
                            connector_template: {
                                [key: string]: unknown;
                            } | null;
                            integration: {
                                [key: string]: unknown;
                            } | null;
                            references: {
                                [key: string]: unknown;
                            }[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteConnector: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                            integration_id: string | null;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateConnector: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    display_name?: string;
                    /** @description Fields to change (merged over the stored config) */
                    config?: {
                        [key: string]: unknown;
                    };
                    /** @description Credential fields to change (merged). Secrets are returned masked as "__SECRET__"; send the sentinel back to keep a stored value. */
                    credentials?: {
                        [key: string]: unknown;
                    };
                    enabled?: boolean;
                    /** @description Rebuild the generated references from the template */
                    regenerate_references?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            connector: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    testConnector: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            status: string;
                            message: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    enableConnector: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            id: string;
                            enabled: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    disableConnector: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            id: string;
                            enabled: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    regenerateConnectorReferences: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            id: string;
                            count: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listEmailTemplates: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Name contains */
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            email_templates: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createEmailTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    /** @description Subject line; supports {{variable}} and {{=FUNC(...)}} expressions */
                    subject: string;
                    /** @description HTML body; supports {{variable}} and {{=FUNC(...)}} expressions */
                    html_body: string;
                    /** @description Plain-text / in-app notification body (default: generated from the HTML) */
                    text_body?: string | null;
                    /** @description Make this the workspace default template */
                    is_default?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            email_template: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getEmailTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            email_template: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteEmailTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateEmailTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    subject?: string;
                    /** @description New HTML body (the text body is regenerated unless text_body is also sent) */
                    html_body?: string;
                    text_body?: string | null;
                    /** @description true makes this the workspace default (clearing the previous one) */
                    is_default?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            email_template: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    previewEmailTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description Sample workflow variables, e.g. { "user_task_title": "Approve PO" }; app_url defaults to the server URL
                     * @default {}
                     */
                    variables?: {
                        [key: string]: unknown;
                    };
                    /** @description Sample task record for {{task.*}} references */
                    task?: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            id: string;
                            name: string;
                            subject: string;
                            html_body: string;
                            text_body: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listForms: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Name or description contains */
                search?: string;
                /** @description Only forms with this tag */
                tag?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            forms: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createForm: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    /** @description Tags (lower-cased, de-duplicated) */
                    tags?: string[] | null;
                    /** @description Field definitions (at least one) */
                    fields: {
                        [key: string]: unknown;
                    }[];
                    /** @description Grid layout; omitted or null = one full-width row per field */
                    layout?: {
                        [key: string]: unknown;
                    } | null;
                    /** @description Theme reference (default { source: "workspace" }) */
                    theme?: {
                        [key: string]: unknown;
                    } | null;
                    /** @description The button bar: [{ id, label, kind (submit, cancel, draft, outcome), style (primary, secondary, danger), outcome? (outcome buttons: the task outcome), hidden? (cancel), actions? [{ type: message | success_screen | start_workflow | redirect | close, text?, title?, screen_button?, url?, workflow_id?, inputs? { <workflow input>: "{{field}}" } }] }]; null = Submit and Cancel. A start_workflow action needs workflows.activate to add. */
                    buttons?: {
                        [key: string]: unknown;
                    }[] | null;
                    /** @description Header: { enabled, image (default = the UserTasks mark, workspace_logo, upload, none), image_url? (an uploaded header image), title?, subtitle? ({{field}} placeholders), align? (left, center), banner? (the mini theme banner colour) }. */
                    header?: {
                        [key: string]: unknown;
                    } | null;
                    /** @description Delete submissions older than this many days (null = keep) */
                    submission_retention_days?: number | null;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            form: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getForm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            form: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteForm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateForm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    tags?: string[] | null;
                    /** @description New field list (a content change: new version) */
                    fields?: {
                        [key: string]: unknown;
                    }[];
                    /** @description New grid layout; null = classic one-field-per-row */
                    layout?: {
                        [key: string]: unknown;
                    } | null;
                    /** @description New theme reference */
                    theme?: {
                        [key: string]: unknown;
                    } | null;
                    /** @description New buttons (a content change). The button bar: [{ id, label, kind (submit, cancel, draft, outcome), style (primary, secondary, danger), outcome? (outcome buttons: the task outcome), hidden? (cancel), actions? [{ type: message | success_screen | start_workflow | redirect | close, text?, title?, screen_button?, url?, workflow_id?, inputs? { <workflow input>: "{{field}}" } }] }]; null = Submit and Cancel. A start_workflow action needs workflows.activate to add. */
                    buttons?: {
                        [key: string]: unknown;
                    }[] | null;
                    /** @description New header (a content change); null = none. Header: { enabled, image (default = the UserTasks mark, workspace_logo, upload, none), image_url? (an uploaded header image), title?, subtitle? ({{field}} placeholders), align? (left, center), banner? (the mini theme banner colour) }. */
                    header?: {
                        [key: string]: unknown;
                    } | null;
                    /** @description Delete submissions older than this many days (null = keep) */
                    submission_retention_days?: number | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            form: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    duplicateForm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Name of the copy (default "<name> (copy)") */
                    name?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            form: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listFormVersions: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
            };
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            versions: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getFormVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Form id */
                id: string;
                /** @description Version number */
                version: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            version: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listFormUsages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            usages: {
                                [key: string]: unknown;
                            }[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listFormThemes: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Name contains */
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            form_themes: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createFormTheme: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    /** @description Mini-theme overrides: colors { light, dark: { accent, background, text } }, radius, font, density, label_position, header */
                    overrides: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            form_theme: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getFormTheme: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            form_theme: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteFormTheme: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateFormTheme: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    overrides?: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            form_theme: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    submitForm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Field values keyed by field key (validated like a task form: types, required, rules, people, lookup values against their source) */
                    values?: {
                        [key: string]: unknown;
                    };
                    /** @description The button pressed (default: the first submitting button); its start-workflow actions run */
                    button_id?: string;
                    /** @description Repeating a key returns the first submission instead of submitting again */
                    idempotency_key?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            submission: {
                                [key: string]: unknown;
                            };
                            effects: {
                                [key: string]: unknown;
                            };
                            runs: {
                                [key: string]: unknown;
                            }[];
                            replayed?: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listFormSubmissions: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Only this submitter (user id) */
                submitted_by?: string;
                /** @description Only submissions with this button */
                button_id?: string;
                /** @description Where it was submitted */
                source?: "standalone" | "task" | "api";
                /** @description ISO 8601: submitted at or after */
                since?: string;
                /** @description ISO 8601: submitted at or before */
                until?: string;
            };
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            submissions: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getFormSubmission: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            submission: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    lookupFormField: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    field_key: string;
                    query?: string;
                    values?: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            items: {
                                [key: string]: unknown;
                            }[];
                            truncated?: boolean;
                            cached?: boolean;
                            too_short?: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listWorkflowActivities: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                status?: "draft" | "active" | "archived";
                /** @description Name, description or key contains */
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflow_activities: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createWorkflowActivity: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @description JavaScript exposing run, execute, handler, main, module.exports or module.exports.default */
                    source_code: string;
                    /** @description Typed inputs/outputs (at least one of each) and presentation metadata */
                    manifest: {
                        inputs?: ({
                            id?: string;
                            name: string;
                            label?: string;
                            /** @description string, number, boolean, object, array, … */
                            type?: string;
                            description?: string;
                            required?: boolean;
                            defaultValue?: unknown;
                        } & {
                            [key: string]: unknown;
                        })[];
                        outputs?: ({
                            id?: string;
                            name: string;
                            label?: string;
                            /** @description string, number, boolean, object, array, … */
                            type?: string;
                            description?: string;
                            required?: boolean;
                            defaultValue?: unknown;
                        } & {
                            [key: string]: unknown;
                        })[];
                        /** @description Friendly label in the workflow picker and on node cards */
                        display_name?: string;
                        /** @description One-line purpose for designers */
                        purpose?: string;
                        recommended_for?: string;
                        summary?: string;
                        setup_notes?: string[];
                    } & {
                        [key: string]: unknown;
                    };
                    description?: string | null;
                    /** @description Stable workflow node key (default: slug of the name; unique per workspace) */
                    key?: string;
                    /**
                     * @description Default draft
                     * @enum {string}
                     */
                    status?: "draft" | "active" | "archived";
                    /**
                     * @description Default inline
                     * @enum {string}
                     */
                    source_kind?: "upload" | "inline";
                    /** @description Default 1.0.0 */
                    version?: string;
                    icon_name?: string;
                    color?: string;
                    /** @description Sample inputs for previews and testing */
                    demo_inputs?: {
                        [key: string]: unknown;
                    };
                    tags?: string[];
                    source_filename?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflow_activity: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    importWorkflowActivity: {
        parameters: {
            query?: {
                /** @description true = import as active regardless of the exported status */
                publish?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    workflow_activity?: {
                        [key: string]: unknown;
                    };
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflow_activity: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getWorkflowActivity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflow_activity: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteWorkflowActivity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateWorkflowActivity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    source_code?: string;
                    /** @description Replacement manifest */
                    manifest?: {
                        inputs?: ({
                            id?: string;
                            name: string;
                            label?: string;
                            /** @description string, number, boolean, object, array, … */
                            type?: string;
                            description?: string;
                            required?: boolean;
                            defaultValue?: unknown;
                        } & {
                            [key: string]: unknown;
                        })[];
                        outputs?: ({
                            id?: string;
                            name: string;
                            label?: string;
                            /** @description string, number, boolean, object, array, … */
                            type?: string;
                            description?: string;
                            required?: boolean;
                            defaultValue?: unknown;
                        } & {
                            [key: string]: unknown;
                        })[];
                        /** @description Friendly label in the workflow picker and on node cards */
                        display_name?: string;
                        /** @description One-line purpose for designers */
                        purpose?: string;
                        recommended_for?: string;
                        summary?: string;
                        setup_notes?: string[];
                    } & {
                        [key: string]: unknown;
                    };
                    description?: string | null;
                    /** @description Stable workflow node key (default: slug of the name; unique per workspace) */
                    key?: string;
                    /**
                     * @description Default draft
                     * @enum {string}
                     */
                    status?: "draft" | "active" | "archived";
                    /**
                     * @description Default inline
                     * @enum {string}
                     */
                    source_kind?: "upload" | "inline";
                    /** @description Default 1.0.0 */
                    version?: string;
                    icon_name?: string;
                    color?: string;
                    /** @description Sample inputs for previews and testing */
                    demo_inputs?: {
                        [key: string]: unknown;
                    };
                    tags?: string[];
                    source_filename?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            workflow_activity: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    exportWorkflowActivity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            version: 1;
                            /** @constant */
                            asset_type: "workflow_activity";
                            workflow_activity: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listReports: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Filter by shared flag */
                shared?: "true" | "false";
                category?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            reports: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createReport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string;
                    category?: string;
                    is_shared?: boolean;
                    /** @description Report configuration (data_source, columns, filters, ...) */
                    config?: {
                        [key: string]: unknown;
                    };
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            report: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            report: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    category?: string | null;
                    is_shared?: boolean;
                    config?: {
                        [key: string]: unknown;
                    };
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            report: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                            report_id: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    category?: string | null;
                    is_shared?: boolean;
                    config?: {
                        [key: string]: unknown;
                    };
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            report: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    previewReport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Report source key */
                    data_source: string;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            [key: string]: unknown;
                        }[];
                        total?: number;
                        available_columns: unknown;
                        joins: unknown;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listReportSources: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        sources: {
                            [key: string]: unknown;
                        }[];
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    exportReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            version: number;
                            /** @constant */
                            asset_type: "report";
                            report: {
                                name: string;
                                config: unknown;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    importReport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description An export document from GET /reports/{id}/export (or send the report fields at the top level) */
                    report?: {
                        [key: string]: unknown;
                    };
                    /** @description Report name, when the report is sent at the top level */
                    name?: string;
                    /** @description Replacement name */
                    name_override?: string;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            report: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listRetentionPolicies: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                search?: string;
                applies_to?: string;
                policy_mode?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            retention_policies: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createRetentionPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    /** @description Retention mode (see lib/retention-policy-api.ts RETENTION_POLICY_MODES) */
                    policy_mode: string;
                    duration_value?: number;
                    duration_unit?: string;
                    exact_date?: string;
                    /** @description Asset types the policy can be assigned to */
                    applies_to?: string[];
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            retention_policy: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getRetentionPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            retention_policy: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateRetentionPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    /** @description Retention mode (see lib/retention-policy-api.ts RETENTION_POLICY_MODES) */
                    policy_mode?: string;
                    duration_value?: number;
                    duration_unit?: string;
                    exact_date?: string;
                    /** @description Asset types the policy can be assigned to */
                    applies_to?: string[];
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            retention_policy: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteRetentionPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                            retention_policy_id: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patchRetentionPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    /** @description Retention mode (see lib/retention-policy-api.ts RETENTION_POLICY_MODES) */
                    policy_mode?: string;
                    duration_value?: number;
                    duration_unit?: string;
                    exact_date?: string;
                    /** @description Asset types the policy can be assigned to */
                    applies_to?: string[];
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            retention_policy: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getRetentionPolicyAssets: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            retention_policy: {
                                [key: string]: unknown;
                            };
                            usage: unknown;
                            assets: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    assignRetentionPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    target_type: string;
                    target_id: string;
                    /** @description Omit or null to clear the assignment */
                    retention_policy_id?: string | null;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            assigned: boolean;
                            target_type: string;
                            target_id: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listRoles: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            roles: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createRole: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    /**
                     * @description Permission keys, e.g. ["tasks.view_all", "workflows.view"]
                     * @default []
                     */
                    permissions?: string[];
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            role: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            role: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description New name (custom roles only) */
                    name?: string;
                    description?: string | null;
                    /** @description Replaces the role permission list */
                    permissions?: string[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            role: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listUsers: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Display name or email contains */
                search?: string;
                /** @description Include each user's roles */
                include_roles?: "true" | "false";
                /** @description Include each user's teams */
                include_teams?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            users: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    assignUserRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description User id */
                id: string;
                /** @description Role id */
                roleId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            assigned: true;
                            already_assigned: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    removeUserRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description User id */
                id: string;
                /** @description Role id */
                roleId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            removed: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getUserManager: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description User id, or `me` for the caller */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            user: {
                                id: string;
                                display_name: string | null;
                                email: string | null;
                            } & {
                                [key: string]: unknown;
                            };
                            manager: ({
                                id: string;
                                display_name: string | null;
                                email: string | null;
                            } & {
                                [key: string]: unknown;
                            }) | null;
                            /** @description 'manual' (Settings, API, MCP, CLI) or 'directory' (directory sync) */
                            manager_source: string | null;
                            manager_updated_at: string | null;
                            direct_reports: ({
                                id: string;
                                display_name: string | null;
                                email: string | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                            /** @description Managers above the member, nearest first */
                            chain: ({
                                id: string;
                                display_name: string | null;
                                email: string | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    setUserManager: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description User id, or `me` for the caller */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The member's manager in this workspace (null clears it). Must be an active member; loops are refused */
                    manager_user_id: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            user: {
                                id: string;
                                display_name: string | null;
                                email: string | null;
                            } & {
                                [key: string]: unknown;
                            };
                            manager: ({
                                id: string;
                                display_name: string | null;
                                email: string | null;
                            } & {
                                [key: string]: unknown;
                            }) | null;
                            /** @description 'manual' (Settings, API, MCP, CLI) or 'directory' (directory sync) */
                            manager_source: string | null;
                            manager_updated_at: string | null;
                            direct_reports: ({
                                id: string;
                                display_name: string | null;
                                email: string | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                            /** @description Managers above the member, nearest first */
                            chain: ({
                                id: string;
                                display_name: string | null;
                                email: string | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listUserReports: {
        parameters: {
            query?: {
                /** @description Include reports of reports (up to 10 levels, cycle-safe) */
                indirect?: "true" | "false";
            };
            header?: never;
            path: {
                /** @description User id, or `me` for the caller */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            manager_user_id: string;
                            indirect: boolean;
                            max_depth: number;
                            reports: ({
                                id: string;
                                display_name: string | null;
                                email: string | null;
                                depth: number;
                                manager_user_id: string;
                            } & {
                                [key: string]: unknown;
                            })[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listTeams: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            teams: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createTeam: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    description?: string | null;
                    /** @description Parent team id */
                    parent_id?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            team: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getTeam: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            team: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteTeam: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateTeam: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    /** @description Parent team id */
                    parent_id?: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            team: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    addTeamMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Team id */
                id: string;
                /** @description User id */
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Member role within the team (default member) */
                    role?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            added: true;
                            already_member: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    removeTeamMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Team id */
                id: string;
                /** @description User id */
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            removed: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listInvitations: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description pending (default) or all */
                status?: "pending" | "all";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            invitations: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    sendInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: email */
                    email: string;
                    /**
                     * @description Workspace role granted on acceptance
                     * @default member
                     * @enum {string}
                     */
                    role?: "owner" | "admin" | "manager" | "member" | "viewer";
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            invitation: {
                                [key: string]: unknown;
                            };
                            email_sent: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    revokeInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            revoked: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    resendInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            invitation: {
                                [key: string]: unknown;
                            };
                            email_sent: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listAuditLog: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description e.g. workflow, role, api_key, webhook */
                object_type?: string;
                object_id?: string;
                /** @description User id of the actor */
                actor_id?: string;
                /** @description e.g. create, update, delete, grant, revoke */
                action?: string;
                /** @description ISO timestamp: events at or after */
                from?: string;
                /** @description ISO timestamp: events at or before */
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            events: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getWorkspaceTheme: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @description The theme (meta, colors.light/dark, typography, shape, shadows, layout, chrome, branding) */
                            workspace_theme: {
                                [key: string]: unknown;
                            };
                            /** @description Increments on every save; 0 = the platform default (never saved) */
                            version: number;
                            updated_at: string | null;
                            updated_by: string | null;
                            /** @description WCAG contrast warnings for the theme (pairs below 3:1 for buttons and navigation are refused on save) */
                            contrast: ({
                                /** @enum {string} */
                                mode: "light" | "dark";
                                pair: string;
                                foreground: string;
                                background: string;
                                ratio: number;
                                required: number;
                                /** @enum {string} */
                                level: "warn" | "block";
                            } & {
                                [key: string]: unknown;
                            })[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateWorkspaceTheme: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    meta: {
                        name: string;
                        basePreset?: string;
                        /** @enum {string} */
                        mode: "auto" | "light" | "dark";
                        /** @constant */
                        schemaVersion: 1;
                        /** @enum {string} */
                        decorationPreset?: "dawn" | "nebula";
                    };
                    colors: {
                        light: {
                            primary: string;
                            primaryHover: string;
                            primaryLight: string;
                            onPrimary?: string;
                            accent: string;
                            accentLight: string;
                            sidebar: string;
                            sidebarText: string;
                            sidebarActive: string;
                            sidebarBorder: string;
                            sidebarAccent?: string;
                            topbar: string;
                            topbarText: string;
                            surface: string;
                            surfaceBorder: string;
                            cardBg: string;
                            cardText: string;
                            mutedText: string;
                            success: string;
                            warning: string;
                            danger: string;
                            info: string;
                            status: {
                                todo: string;
                                todoBg: string;
                                progress: string;
                                progressBg: string;
                                blocked: string;
                                blockedBg: string;
                                done: string;
                                doneBg: string;
                                info: string;
                                infoBg: string;
                                warningBg: string;
                                dangerBg: string;
                                successBg: string;
                            };
                            rowHighlight: string;
                            rowHighlightStrong: string;
                            focusRing?: string;
                            inputBg?: string;
                            inputBorder?: string;
                            overlay: string;
                            chart: string[];
                        };
                        dark: {
                            primary: string;
                            primaryHover: string;
                            primaryLight: string;
                            onPrimary?: string;
                            accent: string;
                            accentLight: string;
                            sidebar: string;
                            sidebarText: string;
                            sidebarActive: string;
                            sidebarBorder: string;
                            sidebarAccent?: string;
                            topbar: string;
                            topbarText: string;
                            surface: string;
                            surfaceBorder: string;
                            cardBg: string;
                            cardText: string;
                            mutedText: string;
                            success: string;
                            warning: string;
                            danger: string;
                            info: string;
                            status: {
                                todo: string;
                                todoBg: string;
                                progress: string;
                                progressBg: string;
                                blocked: string;
                                blockedBg: string;
                                done: string;
                                doneBg: string;
                                info: string;
                                infoBg: string;
                                warningBg: string;
                                dangerBg: string;
                                successBg: string;
                            };
                            rowHighlight: string;
                            rowHighlightStrong: string;
                            focusRing?: string;
                            inputBg?: string;
                            inputBorder?: string;
                            overlay: string;
                            chart: string[];
                        };
                    };
                    typography: {
                        sans: {
                            /** @constant */
                            source: "google";
                            family: string;
                        } | {
                            /** @constant */
                            source: "system";
                            /** @enum {string} */
                            family: "System UI" | "Serif" | "Monospace";
                        } | {
                            /** @constant */
                            source: "upload";
                            family: string;
                            url: string;
                        };
                        display: {
                            /** @constant */
                            source: "google";
                            family: string;
                        } | {
                            /** @constant */
                            source: "system";
                            /** @enum {string} */
                            family: "System UI" | "Serif" | "Monospace";
                        } | {
                            /** @constant */
                            source: "upload";
                            family: string;
                            url: string;
                        };
                        mono: {
                            /** @constant */
                            source: "google";
                            family: string;
                        } | {
                            /** @constant */
                            source: "system";
                            /** @enum {string} */
                            family: "System UI" | "Serif" | "Monospace";
                        } | {
                            /** @constant */
                            source: "upload";
                            family: string;
                            url: string;
                        };
                        weights: {
                            normal: number;
                            medium: number;
                            semibold: number;
                            bold: number;
                            heading?: number;
                        };
                        baseSize: number;
                        /** @enum {string} */
                        headingFont: "sans" | "display";
                        headingLetterSpacing: string;
                        uppercaseLabels: boolean;
                    };
                    shape: {
                        cardRadius: number;
                        buttonRadius: number;
                        inputRadius: number;
                        badgeRadius: number;
                        dialogRadius: number;
                    };
                    shadows: {
                        sm: string;
                        md: string;
                        lg: string;
                        xl: string;
                        card: string;
                    };
                    layout: {
                        /** @enum {string} */
                        density: "compact" | "comfortable" | "spacious";
                        sidebarWidth: number;
                        topbarHeight: number;
                    };
                    chrome: {
                        sidebar: {
                            /** @enum {string} */
                            style: "solid" | "gradient" | "texture";
                            gradient?: {
                                angle: number;
                                stops: {
                                    color: string;
                                    at: number;
                                }[];
                            };
                            texture?: {
                                /** @constant */
                                pattern: "dots";
                                color: string;
                                size: number;
                            };
                            glow1: string;
                            glow2: string;
                            hoverBg: string;
                            brandColor: string;
                            /** @enum {string} */
                            decorations: "off" | "on" | "light";
                            decorationColor?: string;
                        };
                        topbar: {
                            /** @enum {string} */
                            style: "solid" | "gradient" | "texture";
                            gradient?: {
                                angle: number;
                                stops: {
                                    color: string;
                                    at: number;
                                }[];
                            };
                            texture?: {
                                /** @constant */
                                pattern: "dots";
                                color: string;
                                size: number;
                            };
                        };
                        canvas: {
                            texture?: {
                                /** @constant */
                                pattern: "dots";
                                color: string;
                                size: number;
                            };
                        };
                    };
                    branding: {
                        logoLight?: string;
                        logoDark?: string;
                        favicon?: string;
                        wordmark?: string;
                    };
                    /** @description Optimistic check: refuse with 409 unless the stored version still equals this (0 = never saved) */
                    expected_version?: number;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @description The theme (meta, colors.light/dark, typography, shape, shadows, layout, chrome, branding) */
                            workspace_theme: {
                                [key: string]: unknown;
                            };
                            /** @description Increments on every save; 0 = the platform default (never saved) */
                            version: number;
                            updated_at: string | null;
                            updated_by: string | null;
                            /** @description WCAG contrast warnings for the theme (pairs below 3:1 for buttons and navigation are refused on save) */
                            contrast: ({
                                /** @enum {string} */
                                mode: "light" | "dark";
                                pair: string;
                                foreground: string;
                                background: string;
                                ratio: number;
                                required: number;
                                /** @enum {string} */
                                level: "warn" | "block";
                            } & {
                                [key: string]: unknown;
                            })[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    applyWorkspaceThemePreset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Template id from GET /workspace-theme/presets */
                    preset_id: string;
                    /** @description Optimistic check: refuse with 409 unless the stored version still equals this (0 = never saved) */
                    expected_version?: number;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @description The theme (meta, colors.light/dark, typography, shape, shadows, layout, chrome, branding) */
                            workspace_theme: {
                                [key: string]: unknown;
                            };
                            /** @description Increments on every save; 0 = the platform default (never saved) */
                            version: number;
                            updated_at: string | null;
                            updated_by: string | null;
                            /** @description WCAG contrast warnings for the theme (pairs below 3:1 for buttons and navigation are refused on save) */
                            contrast: ({
                                /** @enum {string} */
                                mode: "light" | "dark";
                                pair: string;
                                foreground: string;
                                background: string;
                                ratio: number;
                                required: number;
                                /** @enum {string} */
                                level: "warn" | "block";
                            } & {
                                [key: string]: unknown;
                            })[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listWorkspaceThemePresets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            presets: ({
                                id: string;
                                name: string;
                                description: string;
                                category: string;
                                swatches: {
                                    light: {
                                        primary: string;
                                        accent: string;
                                        sidebar: string;
                                        topbar: string;
                                        surface: string;
                                        card: string;
                                    } & {
                                        [key: string]: unknown;
                                    };
                                    dark: {
                                        primary: string;
                                        accent: string;
                                        sidebar: string;
                                        topbar: string;
                                        surface: string;
                                        card: string;
                                    } & {
                                        [key: string]: unknown;
                                    };
                                } & {
                                    [key: string]: unknown;
                                };
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    uploadWorkspaceThemeFont: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Original file name; must end in .woff2 */
                    file_name: string;
                    /** @description The woff2 file, base64-encoded (at most 1 MB decoded) */
                    content_base64: string;
                    /** @description CSS family name to register (letters, digits, spaces, hyphens); derived from the file name when omitted */
                    family?: string;
                };
                "multipart/form-data": {
                    /** @description CSS family name to register (letters, digits, spaces, hyphens); derived from the file name when omitted */
                    family?: string;
                    /** Format: binary */
                    file: string;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            font: {
                                /** @constant */
                                source: "upload";
                                family: string;
                                url: string;
                            } & {
                                [key: string]: unknown;
                            };
                            /** @description File name in the workspace brand-fonts folder (used by config-as-code) */
                            path: string;
                            size: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listApiKeys: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Include revoked keys (default true) */
                include_revoked?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            api_keys: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /**
                     * @description tenant (workspace-wide) or user (acts as user_id); default tenant, or user for user-context callers
                     * @enum {string}
                     */
                    key_type?: "tenant" | "user";
                    /** @description User a user-context key acts as (default: the calling user) */
                    user_id?: string;
                    /** @description Permission keys for the key (subset of the caller's; omit to inherit) */
                    permissions?: string[];
                    /** @description Restrict the key to these workflows */
                    workflow_ids?: string[];
                    /** @description Restrict the key to these data tables */
                    table_ids?: string[];
                    /** @description Days until expiry (required, at most 90, for OAuth callers) */
                    expires_in_days?: number;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            api_key: {
                                [key: string]: unknown;
                            };
                            /** @description Plaintext key; store it now, it cannot be retrieved again */
                            key: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    revokeApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            revoked: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listWorkflowWebhooks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            webhooks: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createWorkflowWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description URL slug (?hook=<slug>); generated when omitted */
                    slug?: string;
                    /** @description [{ incoming_field, variable_name, type }] mappings from the payload to workflow variables */
                    payload_mapping?: {
                        [key: string]: unknown;
                    }[];
                    /** @description Default true */
                    is_active?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            webhook: {
                                [key: string]: unknown;
                            };
                            /** @description Plaintext webhook secret (shown once) */
                            secret: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            webhook: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description New URL slug (callers must switch to the new url) */
                    slug?: string;
                    /** @description Replacement payload mappings */
                    payload_mapping?: {
                        [key: string]: unknown;
                    }[];
                    is_active?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            webhook: {
                                [key: string]: unknown;
                            };
                            changed: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    rotateWebhookSecret: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            webhook: {
                                [key: string]: unknown;
                            };
                            /** @description Plaintext webhook secret (shown once) */
                            secret: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getGitHubSyncStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            connected: boolean;
                            pending_changes: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    commitGitHubSync: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    message?: string;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            committed: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listGitHubSyncRuns: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                status?: string;
                kind?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            runs: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    startGitHubSyncRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description Default full_resync
                     * @enum {string}
                     */
                    kind?: "full_resync" | "commit" | "template";
                    scope?: {
                        /** @description Manifest sections to sync in full */
                        asset_types?: string[];
                        assets?: ({
                            section: string;
                            id: string;
                            name?: string;
                        } & {
                            [key: string]: unknown;
                        })[];
                    } & {
                        [key: string]: unknown;
                    };
                    message?: string;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            run: {
                                [key: string]: unknown;
                            };
                            status_url: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getGitHubSyncRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            run: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deployGitHubSync: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    dry_run?: boolean;
                    commit_sha?: string;
                    /** @description Branch or ref to resolve when commit_sha is omitted */
                    ref?: string;
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            deployment_id: string;
                            status: string;
                            status_url: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listGitHubSyncDeployments: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            deployments: {
                                [key: string]: unknown;
                            }[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getGitHubSyncDeployment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            deployment: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getGitHubSyncSchedule: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            schedule: unknown;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    setGitHubSyncSchedule: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Schedule config (schedule_mode hourly|daily|weekly, time_of_day, day_of_week, minute_of_hour, timezone); may also be sent at the top level */
                    schedule?: {
                        [key: string]: unknown;
                    };
                } & {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            schedule: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteGitHubSyncSchedule: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            schedule: null;
                            /** @constant */
                            disabled: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listDirectoryConnections: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            connections: ({
                                /** @enum {string} */
                                provider: "entra" | "okta" | "ldap" | "google" | "scim";
                                enabled: boolean;
                                org_name: string | null;
                                settings: {
                                    [key: string]: unknown;
                                };
                                /** @description Masked: every secret is __SECRET__ */
                                credentials: {
                                    [key: string]: unknown;
                                };
                                sync_groups: boolean;
                                auto_provision: boolean;
                                last_sync_at: string | null;
                                last_sync_stats: {
                                    [key: string]: number;
                                } | null;
                                linked_users: number;
                                linked_groups: number;
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                            scim_url: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createDirectoryConnection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    provider: "entra" | "okta" | "ldap" | "google" | "scim";
                    /** @description Provider settings: ldap { url, start_tls?, ca_cert?, tls_reject_unauthorized?, tls_server_name?, bind_dn, base_dn, user_base_dn?, group_base_dn?, flavor? (active_directory|openldap|generic), user_filter?, group_filter?, attributes? { id, username, email, display_name, first_name, last_name, group_name, group_description, member }, nested_groups?, page_size?, timeout_ms?, deprovision_missing?, bind_login?, login_attributes? }; google { admin_email, customer?, domain?, user_query?, deprovision_missing? }; scim { rate_limit_per_minute? }; every pull provider: sync_interval_minutes? (default 60, minimum 10) */
                    settings?: {
                        [key: string]: unknown;
                    };
                    /** @description Secrets: entra { tenant_id, client_id, client_secret }; okta { org_url, api_token }; ldap { bind_password }; google { service_account_json }; scim: none (use SCIM tokens). Write-only: reads show __SECRET__; values may be secret://tenants/<workspace id>/<name> */
                    credentials?: {
                        [key: string]: unknown;
                    };
                    /** @description Directory groups become teams (default true) */
                    sync_groups?: boolean;
                    /** @description Create accounts for directory users without one (default true) */
                    auto_provision?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            connection: {
                                /** @enum {string} */
                                provider: "entra" | "okta" | "ldap" | "google" | "scim";
                                enabled: boolean;
                                org_name: string | null;
                                settings: {
                                    [key: string]: unknown;
                                };
                                /** @description Masked: every secret is __SECRET__ */
                                credentials: {
                                    [key: string]: unknown;
                                };
                                sync_groups: boolean;
                                auto_provision: boolean;
                                last_sync_at: string | null;
                                last_sync_stats: {
                                    [key: string]: number;
                                } | null;
                                linked_users: number;
                                linked_groups: number;
                            } & {
                                [key: string]: unknown;
                            };
                            /** @description LDAP: what the connection test found */
                            test?: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getDirectoryConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description entra, okta, ldap, google or scim */
                provider: "entra" | "okta" | "ldap" | "google" | "scim";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            connection: {
                                /** @enum {string} */
                                provider: "entra" | "okta" | "ldap" | "google" | "scim";
                                enabled: boolean;
                                org_name: string | null;
                                settings: {
                                    [key: string]: unknown;
                                };
                                /** @description Masked: every secret is __SECRET__ */
                                credentials: {
                                    [key: string]: unknown;
                                };
                                sync_groups: boolean;
                                auto_provision: boolean;
                                last_sync_at: string | null;
                                last_sync_stats: {
                                    [key: string]: number;
                                } | null;
                                linked_users: number;
                                linked_groups: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteDirectoryConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description entra, okta, ldap, google or scim */
                provider: "entra" | "okta" | "ldap" | "google" | "scim";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateDirectoryConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description entra, okta, ldap, google or scim */
                provider: "entra" | "okta" | "ldap" | "google" | "scim";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description Cannot change; accepted so a fetched connection can be sent back
                     * @enum {string}
                     */
                    provider?: "entra" | "okta" | "ldap" | "google" | "scim";
                    /** @description Merged over the stored settings (null removes a key) */
                    settings?: {
                        [key: string]: unknown;
                    };
                    /** @description Merged over the stored credentials; __SECRET__ keeps a value */
                    credentials?: {
                        [key: string]: unknown;
                    };
                    sync_groups?: boolean;
                    auto_provision?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            connection: {
                                /** @enum {string} */
                                provider: "entra" | "okta" | "ldap" | "google" | "scim";
                                enabled: boolean;
                                org_name: string | null;
                                settings: {
                                    [key: string]: unknown;
                                };
                                /** @description Masked: every secret is __SECRET__ */
                                credentials: {
                                    [key: string]: unknown;
                                };
                                sync_groups: boolean;
                                auto_provision: boolean;
                                last_sync_at: string | null;
                                last_sync_stats: {
                                    [key: string]: number;
                                } | null;
                                linked_users: number;
                                linked_groups: number;
                            } & {
                                [key: string]: unknown;
                            };
                            changed: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    testDirectoryConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description entra, okta, ldap or google */
                provider: "entra" | "okta" | "ldap" | "google";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Try these settings (merged over the stored ones) without saving */
                    settings?: {
                        [key: string]: unknown;
                    };
                    /** @description Try these credentials (merged over the stored ones) without saving */
                    credentials?: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            ok: boolean;
                            org_name: string | null;
                            error: string | null;
                            details: {
                                [key: string]: unknown;
                            } | null;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    startDirectorySync: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description entra, okta, ldap or google */
                provider: "entra" | "okta" | "ldap" | "google";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Force a full sync (LDAP otherwise syncs only changes since the last run) */
                    full?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            run_id: string;
                            already_running: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listDirectorySyncRuns: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                provider?: "entra" | "okta" | "ldap" | "google";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            runs: ({
                                id: string;
                                provider: string;
                                /** @enum {string} */
                                status: "pending" | "running" | "completed" | "failed";
                                mode: string | null;
                                progress: {
                                    [key: string]: unknown;
                                } | null;
                                stats: {
                                    [key: string]: number;
                                } | null;
                                error: string | null;
                                created_at: string;
                                completed_at: string | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listScimTokens: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            scim_tokens: ({
                                id: string;
                                name: string;
                                /** @description First characters of the token */
                                token_prefix: string;
                                scopes: string[];
                                created_at: string;
                                last_used_at: string | null;
                                expires_at: string | null;
                                revoked_at: string | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createScimToken: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Label, e.g. "Entra ID provisioning" */
                    name: string;
                    /** @description Default all four */
                    scopes?: ("users:read" | "users:write" | "groups:read" | "groups:write")[];
                    /** @description Default: never expires */
                    expires_in_days?: number;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            scim_token: {
                                id: string;
                                name: string;
                                /** @description First characters of the token */
                                token_prefix: string;
                                scopes: string[];
                                created_at: string;
                                last_used_at: string | null;
                                expires_at: string | null;
                                revoked_at: string | null;
                            } & {
                                [key: string]: unknown;
                            };
                            /** @description The bearer token (shown once) */
                            token: string;
                            scim_url: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteScimToken: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    rotateScimToken: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Keep the old token working this long (default 0: revoked now) */
                    grace_minutes?: number;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            scim_token: {
                                id: string;
                                name: string;
                                /** @description First characters of the token */
                                token_prefix: string;
                                scopes: string[];
                                created_at: string;
                                last_used_at: string | null;
                                expires_at: string | null;
                                revoked_at: string | null;
                            } & {
                                [key: string]: unknown;
                            };
                            /** @description The new bearer token (shown once) */
                            token: string;
                            previous: {
                                id: string;
                                name: string;
                                /** @description First characters of the token */
                                token_prefix: string;
                                scopes: string[];
                                created_at: string;
                                last_used_at: string | null;
                                expires_at: string | null;
                                revoked_at: string | null;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    exportConfig: {
        parameters: {
            query?: {
                /** @description Sections to export (default all): workflows, decision_tables, workflow_activities, data_tables, integrations (with their references and objects), agents, reports, retention_policies, roles, mcp_servers, email_templates, connectors (non-secret config only), log_destinations (no credentials or shipper state), form_themes, forms (fields, layout and theme; versions stay per workspace), workspace_theme (one workspace-theme.json; uploaded fonts by file name, logos by URL — images from another workspace are dropped on apply) (comma-separated) */
                types?: string;
                /** @description Only these asset ids (an integration brings its references and objects) (comma-separated) */
                ids?: string;
                /** @description files (default): GitHub-sync layout; manifest: one JSON manifest */
                format?: "files" | "manifest";
                /** @description true: also export the rows of every exported data table (table_rows section, data-rows/ folder; needs data.view; at most 10,000 rows per table) */
                include_rows?: "true" | "false";
                /** @description true: expand `ids` with everything they depend on (sub-workflows, activities, decision tables, data tables, integrations/connectors, email templates, agents, custom roles, retention policies, MCP servers) */
                with_dependencies?: "true" | "false";
                /** @description true: run as a background job and return 202 with it (same as Prefer: respond-async) */
                async?: "true" | "false";
            };
            header?: {
                /** @description respond-async: run as a background job (202) */
                Prefer?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            format_version: number;
                            /** @description format=files: one envelope per asset plus manifest.json */
                            files?: {
                                /** @description Path relative to the config folder, e.g. workflows/invoice-approval-3fa8c21b.json */
                                path: string;
                                /** @description File content (JSON asset envelope, or manifest.json) */
                                content: string;
                            }[];
                            /** @description format=manifest */
                            manifest?: {
                                [key: string]: unknown;
                            };
                            /** @description Sections left out because the caller lacks their view permission */
                            skipped: {
                                section: string;
                                permission: string;
                                reason: string;
                            }[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Accepted (async=true or Prefer: respond-async): a background job. Poll GET /jobs/{id}; the result is GET /jobs/{id}/result. */
            202: {
                headers: {
                    /** @description The job: /api/v1/jobs/{id} */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    applyConfig: {
        parameters: {
            query?: {
                /** @description true: run as a background job and return 202 with it (same as Prefer: respond-async) */
                async?: "true" | "false";
            };
            header?: {
                /** @description respond-async: run as a background job (202) */
                Prefer?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Files as produced by GET /config/export (YAML must be converted to JSON first) */
                    files?: {
                        /** @description Path relative to the config folder, e.g. workflows/invoice-approval-3fa8c21b.json */
                        path: string;
                        /** @description File content (JSON asset envelope, or manifest.json) */
                        content: string;
                    }[];
                    /** @description Alternatively, a whole manifest (format=manifest export) */
                    manifest?: {
                        [key: string]: unknown;
                    };
                    /** @description Plan only; nothing is written (needs view permissions only) */
                    dry_run?: boolean;
                    /** @description Match unmapped assets to existing ones with the same unique name */
                    adopt_by_name?: boolean;
                    /** @description Recorded with id mappings as cli:<label> (default "default") */
                    source_label?: string;
                    /**
                     * @description table_rows: merge (default; update rows applied before, insert the rest), replace (delete the table's rows first) or skip. Needs data.manage_rows
                     * @enum {string}
                     */
                    rows_mode?: "merge" | "replace" | "skip";
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            dry_run: boolean;
                            plan: {
                                assets: ({
                                    section: string;
                                    asset_type: string;
                                    source_id: string | null;
                                    local_id: string | null;
                                    name: string;
                                    /** @enum {string} */
                                    action: "create" | "update" | "unchanged" | "error";
                                    /** @enum {string} */
                                    matched_by?: "id" | "mapping" | "name" | "slug" | "package";
                                    diffs?: ({
                                        path: string;
                                        before?: unknown;
                                        after?: unknown;
                                    } & {
                                        [key: string]: unknown;
                                    })[];
                                    error?: string;
                                    file?: string;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                summary: {
                                    create: number;
                                    update: number;
                                    unchanged: number;
                                    error: number;
                                };
                            } & {
                                [key: string]: unknown;
                            };
                            /** @description Dry runs: permissions a real apply would additionally need */
                            missing_permissions?: {
                                section: string;
                                permission: string;
                            }[];
                            warnings: {
                                [key: string]: unknown;
                            }[];
                            /** @description Real applies only */
                            result?: {
                                created: {
                                    [key: string]: number;
                                };
                                updated: {
                                    [key: string]: number;
                                };
                                errors: ({
                                    asset_type: string;
                                    source_id: string;
                                    error: string;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                warnings: {
                                    [key: string]: unknown;
                                }[];
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Accepted (async=true or Prefer: respond-async): a background job. Poll GET /jobs/{id}; the result is GET /jobs/{id}/result. */
            202: {
                headers: {
                    /** @description The job: /api/v1/jobs/{id} */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listPackages: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            packages: ({
                                id: string;
                                /** @description Stable package id (the same in every environment) */
                                package_uid: string;
                                name: string;
                                slug: string;
                                description: string | null;
                                roots: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                items: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                excluded: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                data_modes: {
                                    [key: string]: string;
                                };
                                latest_version: string | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createPackage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @description Default: from the name */
                    slug?: string;
                    description?: string | null;
                    author?: string | null;
                    icon?: string | null;
                    /** @description Markdown shown before install */
                    readme?: string | null;
                    /** @description Root artifacts (e.g. a workflow); everything they use is added automatically */
                    roots: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    /** @description Extra artifacts added by hand */
                    items?: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    /** @description Auto-included artifacts to leave out */
                    excluded?: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    /** @description Per data table id: "schema" (default) or "rows" (schema + rows, at most 10,000) */
                    data_modes?: {
                        [key: string]: "schema" | "rows";
                    };
                    /**
                     * Format: uuid
                     * @description Re-create a package with an existing identity (another workspace)
                     */
                    package_uid?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            package: {
                                id: string;
                                /** @description Stable package id (the same in every environment) */
                                package_uid: string;
                                name: string;
                                slug: string;
                                description: string | null;
                                roots: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                items: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                excluded: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                data_modes: {
                                    [key: string]: string;
                                };
                                latest_version: string | null;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    previewPackage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    roots: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    items?: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    excluded?: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    /** @description Per data table id: "schema" (default) or "rows" (schema + rows, at most 10,000) */
                    data_modes?: {
                        [key: string]: "schema" | "rows";
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            items: {
                                [key: string]: unknown;
                            }[];
                            requirements: ({
                                id: string;
                                /** @enum {string} */
                                kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                label: string;
                                description: string;
                                required: boolean;
                                fields: ({
                                    key: string;
                                    label: string;
                                    type: string;
                                    secret: boolean;
                                    default?: unknown;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                /** @enum {string} */
                                status?: "met" | "missing";
                            } & {
                                [key: string]: unknown;
                            })[];
                            warnings: string[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    inspectPackage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The .utpkg file, base64 (or send multipart/form-data with a `file` field) */
                    file?: string;
                    file_name?: string;
                    /** @description Instead of file: a package built in this workspace */
                    package_id?: string;
                    /** @description With package_id: the version (default latest) */
                    version?: string;
                };
                "multipart/form-data": {
                    /** @description Instead of file: a package built in this workspace */
                    package_id?: string;
                    /** @description With package_id: the version (default latest) */
                    version?: string;
                    /** Format: binary */
                    file: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            package: {
                                [key: string]: unknown;
                            };
                            verification: {
                                valid: boolean;
                                checksum: string | null;
                                checksum_ok: boolean;
                                files_ok: boolean;
                                signed: boolean;
                                signature_ok: boolean | null;
                                fingerprint: string | null;
                                /** @enum {string} */
                                trust: "instance" | "trusted" | "untrusted" | "unsigned";
                                errors: string[];
                            } & {
                                [key: string]: unknown;
                            };
                            size_bytes: number;
                            assets: {
                                [key: string]: unknown;
                            }[];
                            data: {
                                [key: string]: unknown;
                            }[];
                            requirements: ({
                                id: string;
                                /** @enum {string} */
                                kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                label: string;
                                description: string;
                                required: boolean;
                                fields: ({
                                    key: string;
                                    label: string;
                                    type: string;
                                    secret: boolean;
                                    default?: unknown;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                /** @enum {string} */
                                status?: "met" | "missing";
                            } & {
                                [key: string]: unknown;
                            })[];
                            dependencies: {
                                [key: string]: unknown;
                            }[];
                            installed: ({
                                id: string;
                                version: string;
                                status: string;
                            } & {
                                [key: string]: unknown;
                            }) | null;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    searchPackageAssets: {
        parameters: {
            query?: {
                /** @description Case-insensitive substring of the name or description (integrations: also their reference names) */
                search?: string;
                /** @description Asset types: workflow, workflow_activity, data_table, integration, connector, decision_table, email_template, agent, report, role, mcp_server, retention_policy, log_destination, form, form_theme (default every type you may view) (comma-separated) */
                type?: string;
                /** @description Tag (workflows, custom steps, integrations, agents) or report category */
                tag?: string;
                /** @description Created by: user id or "me" */
                owner?: string;
                /** @description Updated on or after: YYYY-MM-DD, a timestamp, or relative (24h, 7d, 4w) */
                updated_since?: string;
                /** @description name (A–Z, default) or updated (newest first) */
                sort?: "name" | "updated";
                /** @description Page size (1-100, default 50) */
                limit?: number;
                /** @description Cursor: the previous page's next_cursor */
                after?: string;
                /** @description Package id or slug: mark each asset as in that package (in_package) */
                package?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            assets: ({
                                /** @enum {string} */
                                type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                id: string;
                                name: string;
                                /** @description Type label, e.g. "Decision table" */
                                label: string;
                                description: string | null;
                                updated_at: string | null;
                                created_by: string | null;
                                /** @description Tags (or the report category) */
                                tags: string[];
                                /** @description Integrations found through a reference: the reference name */
                                matched_reference?: string;
                                /** @description With `package`: how the asset is in that package (null = not in it) */
                                in_package?: ("root" | "manual" | "dependency" | "excluded") | null;
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                            counts: {
                                [key: string]: number;
                            };
                            /** @description Pass as `after` for the next page (null on the last page) */
                            next_cursor: string | null;
                            types: ({
                                type: string;
                                label: string;
                            } & {
                                [key: string]: unknown;
                            })[];
                            hidden_types: string[];
                            /** @description First page only: tags and report categories in use */
                            facets?: {
                                tags: string[];
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getPackage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Package id or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            package: {
                                id: string;
                                /** @description Stable package id (the same in every environment) */
                                package_uid: string;
                                name: string;
                                slug: string;
                                description: string | null;
                                roots: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                items: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                excluded: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                data_modes: {
                                    [key: string]: string;
                                };
                                latest_version: string | null;
                            } & {
                                [key: string]: unknown;
                            };
                            versions: ({
                                id: string;
                                package_id: string;
                                version: string;
                                checksum: string;
                                signed: boolean;
                                fingerprint: string | null;
                                size_bytes: number;
                                asset_count: number;
                                created_at: string;
                            } & {
                                [key: string]: unknown;
                            })[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deletePackage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Package id or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updatePackage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Package id or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    slug?: string;
                    description?: string | null;
                    author?: string | null;
                    icon?: string | null;
                    readme?: string | null;
                    roots?: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    items?: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    excluded?: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    /** @description Add artifacts (and their dependencies) */
                    add?: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    /** @description Leave artifacts out */
                    remove?: {
                        /**
                         * @description Artifact type
                         * @enum {string}
                         */
                        type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                        /** @description Artifact id in this workspace */
                        id: string;
                    }[];
                    /** @description Merged over the stored modes */
                    data_modes?: {
                        [key: string]: "schema" | "rows";
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            package: {
                                id: string;
                                /** @description Stable package id (the same in every environment) */
                                package_uid: string;
                                name: string;
                                slug: string;
                                description: string | null;
                                roots: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                items: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                excluded: {
                                    /**
                                     * @description Artifact type
                                     * @enum {string}
                                     */
                                    type: "workflow" | "workflow_activity" | "data_table" | "integration" | "connector" | "decision_table" | "email_template" | "agent" | "report" | "role" | "mcp_server" | "retention_policy" | "log_destination" | "form" | "form_theme";
                                    /** @description Artifact id in this workspace */
                                    id: string;
                                }[];
                                data_modes: {
                                    [key: string]: string;
                                };
                                latest_version: string | null;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getPackageContents: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Package id or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            items: {
                                [key: string]: unknown;
                            }[];
                            excluded: {
                                [key: string]: unknown;
                            }[];
                            requirements: ({
                                id: string;
                                /** @enum {string} */
                                kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                label: string;
                                description: string;
                                required: boolean;
                                fields: ({
                                    key: string;
                                    label: string;
                                    type: string;
                                    secret: boolean;
                                    default?: unknown;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                /** @enum {string} */
                                status?: "met" | "missing";
                            } & {
                                [key: string]: unknown;
                            })[];
                            warnings: string[];
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listPackageVersions: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
            };
            header?: never;
            path: {
                /** @description Package id or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            versions: ({
                                id: string;
                                package_id: string;
                                version: string;
                                checksum: string;
                                signed: boolean;
                                fingerprint: string | null;
                                size_bytes: number;
                                asset_count: number;
                                created_at: string;
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    buildPackageVersion: {
        parameters: {
            query?: {
                /** @description true: run as a background job and return 202 with it (same as Prefer: respond-async) */
                async?: "true" | "false";
            };
            header?: {
                /** @description respond-async: run as a background job (202) */
                Prefer?: string;
            };
            path: {
                /** @description Package id or slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Semantic version; default: the latest version bumped by `bump`, or 1.0.0 */
                    version?: string;
                    /**
                     * @description Default patch
                     * @enum {string}
                     */
                    bump?: "major" | "minor" | "patch";
                    notes?: string | null;
                    /** @description Packages that must be installed first, e.g. [{ "package_slug": "vendor-master", "version_range": "^1.0.0" }] */
                    dependencies?: {
                        package_slug: string;
                        version_range: string;
                    }[];
                    /** @description Return the .utpkg as file_base64 */
                    include_file?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            version: {
                                id: string;
                                package_id: string;
                                version: string;
                                checksum: string;
                                signed: boolean;
                                fingerprint: string | null;
                                size_bytes: number;
                                asset_count: number;
                                created_at: string;
                            } & {
                                [key: string]: unknown;
                            };
                            manifest: {
                                [key: string]: unknown;
                            };
                            warnings: string[];
                            file_name: string;
                            file_base64?: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Accepted (async=true or Prefer: respond-async): a background job. Poll GET /jobs/{id}; the result is GET /jobs/{id}/result. */
            202: {
                headers: {
                    /** @description The job: /api/v1/jobs/{id} */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getPackageVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Package id or slug */
                id: string;
                /** @description Version id, version number (1.2.0) or "latest" */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            version: {
                                id: string;
                                package_id: string;
                                version: string;
                                checksum: string;
                                signed: boolean;
                                fingerprint: string | null;
                                size_bytes: number;
                                asset_count: number;
                                created_at: string;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    downloadPackageVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Package id or slug */
                id: string;
                /** @description Version id, version number (1.2.0) or "latest" */
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            file_name: string;
                            checksum: string;
                            size_bytes: number;
                            file_base64: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listPackageInstalls: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            installs: ({
                                id: string;
                                package_uid: string;
                                name: string;
                                slug: string;
                                version: string;
                                previous_version: string | null;
                                source: string;
                                /** @enum {string} */
                                status: "complete" | "incomplete";
                                signed: boolean;
                                fingerprint: string | null;
                                requirements: ({
                                    id: string;
                                    /** @enum {string} */
                                    kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                    label: string;
                                    description: string;
                                    required: boolean;
                                    fields: ({
                                        key: string;
                                        label: string;
                                        type: string;
                                        secret: boolean;
                                        default?: unknown;
                                    } & {
                                        [key: string]: unknown;
                                    })[];
                                    /** @enum {string} */
                                    status?: "met" | "missing";
                                } & {
                                    [key: string]: unknown;
                                })[];
                                checklist: {
                                    [key: string]: unknown;
                                }[];
                                incomplete_count: number;
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    installPackage: {
        parameters: {
            query?: {
                /** @description true: run as a background job and return 202 with it (same as Prefer: respond-async) */
                async?: "true" | "false";
            };
            header?: {
                /** @description respond-async: run as a background job (202) */
                Prefer?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The .utpkg file, base64 (or send multipart/form-data with a `file` field) */
                    file?: string;
                    file_name?: string;
                    /** @description Instead of file: a package built in this workspace */
                    package_id?: string;
                    /** @description With package_id: the version (default latest) */
                    version?: string;
                    /** @description { <requirement id>: { <field key>: value } } — e.g. { "connector:connectors:<id>": { "credentials.password": "…" } }. ${env:VAR} is substituted by the CLI */
                    values?: {
                        [key: string]: {
                            [key: string]: unknown;
                        };
                    };
                    /** @description Install even when required values are missing: affected assets are installed disabled ("Needs configuration") until complete setup */
                    keep_incomplete?: boolean;
                    /** @description First install: adopt existing assets with the same unique name */
                    adopt_by_name?: boolean;
                    /** @description Per package data table id: merge (default), replace or skip its rows */
                    data?: {
                        [key: string]: "merge" | "replace" | "skip";
                    };
                    /** @description Upgrade: keep assets changed in this workspace since the last install */
                    keep_local_changes?: boolean;
                    allow_downgrade?: boolean;
                    ignore_dependencies?: boolean;
                    /** @enum {string} */
                    source?: "file" | "library" | "api" | "cli" | "mcp";
                    /** @description Where the file came from (shown in the library) */
                    source_label?: string;
                };
                "multipart/form-data": {
                    /** @description Instead of file: a package built in this workspace */
                    package_id?: string;
                    /** @description With package_id: the version (default latest) */
                    version?: string;
                    /** @description { <requirement id>: { <field key>: value } } — e.g. { "connector:connectors:<id>": { "credentials.password": "…" } }. ${env:VAR} is substituted by the CLI */
                    values?: {
                        [key: string]: {
                            [key: string]: unknown;
                        };
                    };
                    /** @description Install even when required values are missing: affected assets are installed disabled ("Needs configuration") until complete setup */
                    keep_incomplete?: boolean;
                    /** @description First install: adopt existing assets with the same unique name */
                    adopt_by_name?: boolean;
                    /** @description Per package data table id: merge (default), replace or skip its rows */
                    data?: {
                        [key: string]: "merge" | "replace" | "skip";
                    };
                    /** @description Upgrade: keep assets changed in this workspace since the last install */
                    keep_local_changes?: boolean;
                    allow_downgrade?: boolean;
                    ignore_dependencies?: boolean;
                    /** @enum {string} */
                    source?: "file" | "library" | "api" | "cli" | "mcp";
                    /** @description Where the file came from (shown in the library) */
                    source_label?: string;
                    /** Format: binary */
                    file: string;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            dry_run: boolean;
                            /** @enum {string} */
                            mode: "install" | "upgrade" | "reinstall" | "downgrade";
                            package: {
                                [key: string]: unknown;
                            };
                            verification: {
                                valid: boolean;
                                checksum: string | null;
                                checksum_ok: boolean;
                                files_ok: boolean;
                                signed: boolean;
                                signature_ok: boolean | null;
                                fingerprint: string | null;
                                /** @enum {string} */
                                trust: "instance" | "trusted" | "untrusted" | "unsigned";
                                errors: string[];
                            } & {
                                [key: string]: unknown;
                            };
                            installed_version: string | null;
                            plan: {
                                assets: {
                                    [key: string]: unknown;
                                }[];
                                summary: {
                                    [key: string]: number;
                                };
                            } & {
                                [key: string]: unknown;
                            };
                            removed_upstream: {
                                [key: string]: unknown;
                            }[];
                            requirements: ({
                                id: string;
                                /** @enum {string} */
                                kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                label: string;
                                description: string;
                                required: boolean;
                                fields: ({
                                    key: string;
                                    label: string;
                                    type: string;
                                    secret: boolean;
                                    default?: unknown;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                /** @enum {string} */
                                status?: "met" | "missing";
                            } & {
                                [key: string]: unknown;
                            })[];
                            data: {
                                [key: string]: unknown;
                            }[];
                            dependencies: {
                                [key: string]: unknown;
                            }[];
                            /** @description Why a real install would be refused */
                            blockers: string[];
                            warnings: {
                                [key: string]: unknown;
                            }[];
                            install?: {
                                id: string;
                                package_uid: string;
                                name: string;
                                slug: string;
                                version: string;
                                previous_version: string | null;
                                source: string;
                                /** @enum {string} */
                                status: "complete" | "incomplete";
                                signed: boolean;
                                fingerprint: string | null;
                                requirements: ({
                                    id: string;
                                    /** @enum {string} */
                                    kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                    label: string;
                                    description: string;
                                    required: boolean;
                                    fields: ({
                                        key: string;
                                        label: string;
                                        type: string;
                                        secret: boolean;
                                        default?: unknown;
                                    } & {
                                        [key: string]: unknown;
                                    })[];
                                    /** @enum {string} */
                                    status?: "met" | "missing";
                                } & {
                                    [key: string]: unknown;
                                })[];
                                checklist: {
                                    [key: string]: unknown;
                                }[];
                                incomplete_count: number;
                            } & {
                                [key: string]: unknown;
                            };
                            result?: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Accepted (async=true or Prefer: respond-async): a background job. Poll GET /jobs/{id}; the result is GET /jobs/{id}/result. */
            202: {
                headers: {
                    /** @description The job: /api/v1/jobs/{id} */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    planPackageInstall: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The .utpkg file, base64 (or send multipart/form-data with a `file` field) */
                    file?: string;
                    file_name?: string;
                    /** @description Instead of file: a package built in this workspace */
                    package_id?: string;
                    /** @description With package_id: the version (default latest) */
                    version?: string;
                    /** @description { <requirement id>: { <field key>: value } } — e.g. { "connector:connectors:<id>": { "credentials.password": "…" } }. ${env:VAR} is substituted by the CLI */
                    values?: {
                        [key: string]: {
                            [key: string]: unknown;
                        };
                    };
                    /** @description Install even when required values are missing: affected assets are installed disabled ("Needs configuration") until complete setup */
                    keep_incomplete?: boolean;
                    /** @description First install: adopt existing assets with the same unique name */
                    adopt_by_name?: boolean;
                    /** @description Per package data table id: merge (default), replace or skip its rows */
                    data?: {
                        [key: string]: "merge" | "replace" | "skip";
                    };
                    /** @description Upgrade: keep assets changed in this workspace since the last install */
                    keep_local_changes?: boolean;
                    allow_downgrade?: boolean;
                    ignore_dependencies?: boolean;
                    /** @enum {string} */
                    source?: "file" | "library" | "api" | "cli" | "mcp";
                    /** @description Where the file came from (shown in the library) */
                    source_label?: string;
                };
                "multipart/form-data": {
                    /** @description Instead of file: a package built in this workspace */
                    package_id?: string;
                    /** @description With package_id: the version (default latest) */
                    version?: string;
                    /** @description { <requirement id>: { <field key>: value } } — e.g. { "connector:connectors:<id>": { "credentials.password": "…" } }. ${env:VAR} is substituted by the CLI */
                    values?: {
                        [key: string]: {
                            [key: string]: unknown;
                        };
                    };
                    /** @description Install even when required values are missing: affected assets are installed disabled ("Needs configuration") until complete setup */
                    keep_incomplete?: boolean;
                    /** @description First install: adopt existing assets with the same unique name */
                    adopt_by_name?: boolean;
                    /** @description Per package data table id: merge (default), replace or skip its rows */
                    data?: {
                        [key: string]: "merge" | "replace" | "skip";
                    };
                    /** @description Upgrade: keep assets changed in this workspace since the last install */
                    keep_local_changes?: boolean;
                    allow_downgrade?: boolean;
                    ignore_dependencies?: boolean;
                    /** @enum {string} */
                    source?: "file" | "library" | "api" | "cli" | "mcp";
                    /** @description Where the file came from (shown in the library) */
                    source_label?: string;
                    /** Format: binary */
                    file: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            dry_run: boolean;
                            /** @enum {string} */
                            mode: "install" | "upgrade" | "reinstall" | "downgrade";
                            package: {
                                [key: string]: unknown;
                            };
                            verification: {
                                valid: boolean;
                                checksum: string | null;
                                checksum_ok: boolean;
                                files_ok: boolean;
                                signed: boolean;
                                signature_ok: boolean | null;
                                fingerprint: string | null;
                                /** @enum {string} */
                                trust: "instance" | "trusted" | "untrusted" | "unsigned";
                                errors: string[];
                            } & {
                                [key: string]: unknown;
                            };
                            installed_version: string | null;
                            plan: {
                                assets: {
                                    [key: string]: unknown;
                                }[];
                                summary: {
                                    [key: string]: number;
                                };
                            } & {
                                [key: string]: unknown;
                            };
                            removed_upstream: {
                                [key: string]: unknown;
                            }[];
                            requirements: ({
                                id: string;
                                /** @enum {string} */
                                kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                label: string;
                                description: string;
                                required: boolean;
                                fields: ({
                                    key: string;
                                    label: string;
                                    type: string;
                                    secret: boolean;
                                    default?: unknown;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                /** @enum {string} */
                                status?: "met" | "missing";
                            } & {
                                [key: string]: unknown;
                            })[];
                            data: {
                                [key: string]: unknown;
                            }[];
                            dependencies: {
                                [key: string]: unknown;
                            }[];
                            /** @description Why a real install would be refused */
                            blockers: string[];
                            warnings: {
                                [key: string]: unknown;
                            }[];
                            install?: {
                                id: string;
                                package_uid: string;
                                name: string;
                                slug: string;
                                version: string;
                                previous_version: string | null;
                                source: string;
                                /** @enum {string} */
                                status: "complete" | "incomplete";
                                signed: boolean;
                                fingerprint: string | null;
                                requirements: ({
                                    id: string;
                                    /** @enum {string} */
                                    kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                    label: string;
                                    description: string;
                                    required: boolean;
                                    fields: ({
                                        key: string;
                                        label: string;
                                        type: string;
                                        secret: boolean;
                                        default?: unknown;
                                    } & {
                                        [key: string]: unknown;
                                    })[];
                                    /** @enum {string} */
                                    status?: "met" | "missing";
                                } & {
                                    [key: string]: unknown;
                                })[];
                                checklist: {
                                    [key: string]: unknown;
                                }[];
                                incomplete_count: number;
                            } & {
                                [key: string]: unknown;
                            };
                            result?: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getPackageInstall: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Install id or package slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            install: {
                                id: string;
                                package_uid: string;
                                name: string;
                                slug: string;
                                version: string;
                                previous_version: string | null;
                                source: string;
                                /** @enum {string} */
                                status: "complete" | "incomplete";
                                signed: boolean;
                                fingerprint: string | null;
                                requirements: ({
                                    id: string;
                                    /** @enum {string} */
                                    kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                    label: string;
                                    description: string;
                                    required: boolean;
                                    fields: ({
                                        key: string;
                                        label: string;
                                        type: string;
                                        secret: boolean;
                                        default?: unknown;
                                    } & {
                                        [key: string]: unknown;
                                    })[];
                                    /** @enum {string} */
                                    status?: "met" | "missing";
                                } & {
                                    [key: string]: unknown;
                                })[];
                                checklist: {
                                    [key: string]: unknown;
                                }[];
                                incomplete_count: number;
                            } & {
                                [key: string]: unknown;
                            };
                            assets: {
                                [key: string]: unknown;
                            }[];
                            data_rows: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    upgradePackageInstall: {
        parameters: {
            query?: {
                /** @description true: run as a background job and return 202 with it (same as Prefer: respond-async) */
                async?: "true" | "false";
            };
            header?: {
                /** @description respond-async: run as a background job (202) */
                Prefer?: string;
            };
            path: {
                /** @description Install id or package slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The .utpkg file, base64 (or send multipart/form-data with a `file` field) */
                    file?: string;
                    file_name?: string;
                    /** @description Instead of file: a package built in this workspace */
                    package_id?: string;
                    /** @description With package_id: the version (default latest) */
                    version?: string;
                    /** @description { <requirement id>: { <field key>: value } } — e.g. { "connector:connectors:<id>": { "credentials.password": "…" } }. ${env:VAR} is substituted by the CLI */
                    values?: {
                        [key: string]: {
                            [key: string]: unknown;
                        };
                    };
                    /** @description Install even when required values are missing: affected assets are installed disabled ("Needs configuration") until complete setup */
                    keep_incomplete?: boolean;
                    /** @description First install: adopt existing assets with the same unique name */
                    adopt_by_name?: boolean;
                    /** @description Per package data table id: merge (default), replace or skip its rows */
                    data?: {
                        [key: string]: "merge" | "replace" | "skip";
                    };
                    /** @description Upgrade: keep assets changed in this workspace since the last install */
                    keep_local_changes?: boolean;
                    allow_downgrade?: boolean;
                    ignore_dependencies?: boolean;
                    /** @enum {string} */
                    source?: "file" | "library" | "api" | "cli" | "mcp";
                    /** @description Where the file came from (shown in the library) */
                    source_label?: string;
                    dry_run?: boolean;
                };
                "multipart/form-data": {
                    /** @description Instead of file: a package built in this workspace */
                    package_id?: string;
                    /** @description With package_id: the version (default latest) */
                    version?: string;
                    /** @description { <requirement id>: { <field key>: value } } — e.g. { "connector:connectors:<id>": { "credentials.password": "…" } }. ${env:VAR} is substituted by the CLI */
                    values?: {
                        [key: string]: {
                            [key: string]: unknown;
                        };
                    };
                    /** @description Install even when required values are missing: affected assets are installed disabled ("Needs configuration") until complete setup */
                    keep_incomplete?: boolean;
                    /** @description First install: adopt existing assets with the same unique name */
                    adopt_by_name?: boolean;
                    /** @description Per package data table id: merge (default), replace or skip its rows */
                    data?: {
                        [key: string]: "merge" | "replace" | "skip";
                    };
                    /** @description Upgrade: keep assets changed in this workspace since the last install */
                    keep_local_changes?: boolean;
                    allow_downgrade?: boolean;
                    ignore_dependencies?: boolean;
                    /** @enum {string} */
                    source?: "file" | "library" | "api" | "cli" | "mcp";
                    /** @description Where the file came from (shown in the library) */
                    source_label?: string;
                    dry_run?: boolean;
                    /** Format: binary */
                    file: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            dry_run: boolean;
                            /** @enum {string} */
                            mode: "install" | "upgrade" | "reinstall" | "downgrade";
                            package: {
                                [key: string]: unknown;
                            };
                            verification: {
                                valid: boolean;
                                checksum: string | null;
                                checksum_ok: boolean;
                                files_ok: boolean;
                                signed: boolean;
                                signature_ok: boolean | null;
                                fingerprint: string | null;
                                /** @enum {string} */
                                trust: "instance" | "trusted" | "untrusted" | "unsigned";
                                errors: string[];
                            } & {
                                [key: string]: unknown;
                            };
                            installed_version: string | null;
                            plan: {
                                assets: {
                                    [key: string]: unknown;
                                }[];
                                summary: {
                                    [key: string]: number;
                                };
                            } & {
                                [key: string]: unknown;
                            };
                            removed_upstream: {
                                [key: string]: unknown;
                            }[];
                            requirements: ({
                                id: string;
                                /** @enum {string} */
                                kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                label: string;
                                description: string;
                                required: boolean;
                                fields: ({
                                    key: string;
                                    label: string;
                                    type: string;
                                    secret: boolean;
                                    default?: unknown;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                /** @enum {string} */
                                status?: "met" | "missing";
                            } & {
                                [key: string]: unknown;
                            })[];
                            data: {
                                [key: string]: unknown;
                            }[];
                            dependencies: {
                                [key: string]: unknown;
                            }[];
                            /** @description Why a real install would be refused */
                            blockers: string[];
                            warnings: {
                                [key: string]: unknown;
                            }[];
                            install?: {
                                id: string;
                                package_uid: string;
                                name: string;
                                slug: string;
                                version: string;
                                previous_version: string | null;
                                source: string;
                                /** @enum {string} */
                                status: "complete" | "incomplete";
                                signed: boolean;
                                fingerprint: string | null;
                                requirements: ({
                                    id: string;
                                    /** @enum {string} */
                                    kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                    label: string;
                                    description: string;
                                    required: boolean;
                                    fields: ({
                                        key: string;
                                        label: string;
                                        type: string;
                                        secret: boolean;
                                        default?: unknown;
                                    } & {
                                        [key: string]: unknown;
                                    })[];
                                    /** @enum {string} */
                                    status?: "met" | "missing";
                                } & {
                                    [key: string]: unknown;
                                })[];
                                checklist: {
                                    [key: string]: unknown;
                                }[];
                                incomplete_count: number;
                            } & {
                                [key: string]: unknown;
                            };
                            result?: {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Accepted (async=true or Prefer: respond-async): a background job. Poll GET /jobs/{id}; the result is GET /jobs/{id}/result. */
            202: {
                headers: {
                    /** @description The job: /api/v1/jobs/{id} */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    completePackageInstall: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Install id or package slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description { <requirement id>: { <field key>: value } } — e.g. { "connector:connectors:<id>": { "credentials.password": "…" } }. ${env:VAR} is substituted by the CLI */
                    values?: {
                        [key: string]: {
                            [key: string]: unknown;
                        };
                    };
                    dry_run?: boolean;
                    /**
                     * @description Recorded in the package history as the channel (the CLI sends "cli")
                     * @enum {string}
                     */
                    source?: "api" | "cli" | "mcp";
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            dry_run: boolean;
                            /** @enum {string} */
                            status: "complete" | "incomplete";
                            requirements: ({
                                id: string;
                                /** @enum {string} */
                                kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                label: string;
                                description: string;
                                required: boolean;
                                fields: ({
                                    key: string;
                                    label: string;
                                    type: string;
                                    secret: boolean;
                                    default?: unknown;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                /** @enum {string} */
                                status?: "met" | "missing";
                            } & {
                                [key: string]: unknown;
                            })[];
                            plan: {
                                [key: string]: unknown;
                            };
                            warnings: {
                                [key: string]: unknown;
                            }[];
                            install?: {
                                id: string;
                                package_uid: string;
                                name: string;
                                slug: string;
                                version: string;
                                previous_version: string | null;
                                source: string;
                                /** @enum {string} */
                                status: "complete" | "incomplete";
                                signed: boolean;
                                fingerprint: string | null;
                                requirements: ({
                                    id: string;
                                    /** @enum {string} */
                                    kind: "connector" | "integration_auth" | "secret" | "email_template" | "role" | "user" | "env";
                                    label: string;
                                    description: string;
                                    required: boolean;
                                    fields: ({
                                        key: string;
                                        label: string;
                                        type: string;
                                        secret: boolean;
                                        default?: unknown;
                                    } & {
                                        [key: string]: unknown;
                                    })[];
                                    /** @enum {string} */
                                    status?: "met" | "missing";
                                } & {
                                    [key: string]: unknown;
                                })[];
                                checklist: {
                                    [key: string]: unknown;
                                }[];
                                incomplete_count: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    uninstallPackage: {
        parameters: {
            query?: {
                /** @description true: run as a background job and return 202 with it (same as Prefer: respond-async) */
                async?: "true" | "false";
            };
            header?: {
                /** @description respond-async: run as a background job (202) */
                Prefer?: string;
            };
            path: {
                /** @description Install id or package slug */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description List what would be removed (plan, active runs, blockers) */
                    dry_run?: boolean;
                    /** @description Also remove assets changed in this workspace since install */
                    force?: boolean;
                    /** @description Also delete data tables that hold rows (the rows are lost) */
                    delete_data?: boolean;
                    /** @description Cancel unfinished runs of the package's workflows first (needs workflows.activate); without it they block the uninstall */
                    cancel_runs?: boolean;
                    /**
                     * @description Recorded in the package history as the channel (the CLI sends "cli")
                     * @enum {string}
                     */
                    source?: "api" | "cli" | "mcp";
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            dry_run: boolean;
                            plan: {
                                [key: string]: unknown;
                            }[];
                            summary: {
                                [key: string]: number;
                            };
                            active_runs: {
                                [key: string]: unknown;
                            }[];
                            active_run_count: number;
                            missing_permissions: string[];
                            blockers: string[];
                            errors?: {
                                [key: string]: unknown;
                            }[];
                            runs_cancelled?: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Accepted (async=true or Prefer: respond-async): a background job. Poll GET /jobs/{id}; the result is GET /jobs/{id}/result. */
            202: {
                headers: {
                    /** @description The job: /api/v1/jobs/{id} */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listPackageEvents: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
                /** @description Install id, package id (uid) or package slug */
                package?: string;
                /** @description install, upgrade, reinstall, downgrade, reconfigure, uninstall (comma-separated) */
                action?: string;
                /** @description succeeded, partial, failed (comma-separated) */
                status?: string;
                /** @description ui, cli, api, mcp (comma-separated) */
                channel?: string;
                /** @description User id or email */
                actor?: string;
                /** @description From this date (YYYY-MM-DD) or timestamp */
                since?: string;
                /** @description Up to and including this date (YYYY-MM-DD) or timestamp */
                until?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            events: ({
                                id: string;
                                install_id: string | null;
                                package_uid: string | null;
                                package_name: string;
                                package_slug: string | null;
                                /**
                                 * @description reconfigure = Complete setup
                                 * @enum {string}
                                 */
                                action: "install" | "upgrade" | "reinstall" | "downgrade" | "reconfigure" | "uninstall";
                                /** @enum {string} */
                                status: "succeeded" | "partial" | "failed";
                                from_version: string | null;
                                to_version: string | null;
                                /** @enum {string} */
                                channel: "ui" | "cli" | "api" | "mcp";
                                /** @description Where the file came from: file, library, api, cli or mcp */
                                source: string | null;
                                source_label: string | null;
                                signed: boolean | null;
                                signature_valid: boolean | null;
                                fingerprint: string | null;
                                trust: string | null;
                                /** @description created / updated / unchanged / removed / skipped / gone / errors / rows_* / runs_cancelled */
                                counts: {
                                    [key: string]: number;
                                };
                                requirement_changes: ({
                                    id: string;
                                    label: string;
                                    before: string | null;
                                    after: string | null;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                options: {
                                    [key: string]: unknown;
                                };
                                errors: unknown[];
                                error: string | null;
                                summary: string | null;
                                actor: ({
                                    id: string;
                                    name: string | null;
                                    email: string | null;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                /** @description Reconstructed from the audit log when history was introduced */
                                backfilled: boolean;
                                created_at: string;
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getPackageEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Event id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            event: {
                                id: string;
                                install_id: string | null;
                                package_uid: string | null;
                                package_name: string;
                                package_slug: string | null;
                                /**
                                 * @description reconfigure = Complete setup
                                 * @enum {string}
                                 */
                                action: "install" | "upgrade" | "reinstall" | "downgrade" | "reconfigure" | "uninstall";
                                /** @enum {string} */
                                status: "succeeded" | "partial" | "failed";
                                from_version: string | null;
                                to_version: string | null;
                                /** @enum {string} */
                                channel: "ui" | "cli" | "api" | "mcp";
                                /** @description Where the file came from: file, library, api, cli or mcp */
                                source: string | null;
                                source_label: string | null;
                                signed: boolean | null;
                                signature_valid: boolean | null;
                                fingerprint: string | null;
                                trust: string | null;
                                /** @description created / updated / unchanged / removed / skipped / gone / errors / rows_* / runs_cancelled */
                                counts: {
                                    [key: string]: number;
                                };
                                requirement_changes: ({
                                    id: string;
                                    label: string;
                                    before: string | null;
                                    after: string | null;
                                } & {
                                    [key: string]: unknown;
                                })[];
                                options: {
                                    [key: string]: unknown;
                                };
                                errors: unknown[];
                                error: string | null;
                                summary: string | null;
                                actor: ({
                                    id: string;
                                    name: string | null;
                                    email: string | null;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                /** @description Reconstructed from the audit log when history was introduced */
                                backfilled: boolean;
                                created_at: string;
                                plan: unknown | null;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listJobs: {
        parameters: {
            query?: {
                /** @description Only these statuses: queued, running, succeeded, failed, cancelled (comma-separated) */
                status?: string;
                /** @description true: only queued or running jobs */
                active?: "true" | "false";
                /** @description mine (default) or tenant (admins) */
                scope?: "mine" | "tenant";
                /** @description At most this many (default 50) */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            jobs: ({
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            })[];
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    cancelJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    retryJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            job: {
                                id: string;
                                tenant_id: string;
                                user_id: string | null;
                                /** @description What the job does, e.g. config.export or api.applyconfig */
                                kind: string;
                                title: string;
                                /** @enum {string} */
                                status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
                                /** @description 0-100 */
                                progress: number;
                                message: string | null;
                                result: ({
                                    file?: {
                                        filename: string;
                                        content_type: string;
                                        size: number;
                                    };
                                    counts?: {
                                        [key: string]: number;
                                    };
                                    summary?: string;
                                    data?: unknown;
                                    data_in_file?: boolean;
                                } & {
                                    [key: string]: unknown;
                                }) | null;
                                error: string | null;
                                attempts: number;
                                max_attempts: number;
                                created_at: string;
                                updated_at: string;
                                started_at: string | null;
                                finished_at: string | null;
                                /** @description When the result (and the job) is deleted */
                                expires_at: string | null;
                                /** @description A result file is ready: GET /jobs/{id}/download */
                                downloadable: boolean;
                                cancellable: boolean;
                                retryable: boolean;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getJobResult: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    downloadJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The file */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listEvents: {
        parameters: {
            query?: {
                /** @description Categories (comma-separated): workflow, integration, agent, audit, security, task, system. audit and security also need settings.view */
                category?: string;
                /** @description Event types or globs (comma-separated), e.g. workflow.* or *.failed */
                type?: string;
                /** @description Minimum severity */
                severity?: "debug" | "info" | "warn" | "error";
                /** @description Only events of this workflow */
                workflow_id?: string;
                /** @description Only events of this workflow run */
                run_id?: string;
                /** @description Only events of this task */
                task_id?: string;
                /** @description Only events with this trace id */
                trace_id?: string;
                /** @description ISO timestamp or a duration back from now (30s, 15m, 1h, 2d, 1w) */
                since?: string;
                /** @description Cursor: only events after this id (the previous next_cursor) */
                after?: string;
                /** @description ISO timestamp or duration: only events at or before */
                until?: string;
                /** @description Page size (1-1000, default 100) */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            events: {
                                /** @description Global, monotonic event id: the cursor (`after`, SSE `id:`) and a stable dedupe key */
                                id: number;
                                /** @description ISO timestamp */
                                occurred_at: string;
                                /** @description Dotted event type, e.g. workflow.run.completed, integration.call, audit.workflow.update, task.completed */
                                type: string;
                                /** @enum {string} */
                                category: "workflow" | "integration" | "agent" | "audit" | "security" | "task" | "system";
                                /** @enum {string} */
                                severity: "debug" | "info" | "warn" | "error";
                                message: string;
                                /** @description Table the event was normalized from */
                                source_table: string;
                                source_id: string | null;
                                trace_id: string | null;
                                run_id: string | null;
                                workflow_id: string | null;
                                task_id: string | null;
                                actor_id: string | null;
                                /** @description Allow-listed, source-specific fields (never bodies, headers, prompts or credentials) */
                                attributes: {
                                    [key: string]: unknown;
                                };
                            }[];
                            /** @description Pass as `after` to continue (unchanged when no new events) */
                            next_cursor: string | null;
                            has_more: boolean;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    streamEvents: {
        parameters: {
            query?: {
                /** @description Categories (comma-separated): workflow, integration, agent, audit, security, task, system. audit and security also need settings.view */
                category?: string;
                /** @description Event types or globs (comma-separated), e.g. workflow.* or *.failed */
                type?: string;
                /** @description Minimum severity */
                severity?: "debug" | "info" | "warn" | "error";
                /** @description Only events of this workflow */
                workflow_id?: string;
                /** @description Only events of this workflow run */
                run_id?: string;
                /** @description Only events of this task */
                task_id?: string;
                /** @description Only events with this trace id */
                trace_id?: string;
                /** @description ISO timestamp or a duration back from now (30s, 15m, 1h, 2d, 1w) */
                since?: string;
                /** @description Resume after this event id (the Last-Event-ID header wins). Default: from now, or from `since` */
                after?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Event stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listLogDestinations: {
        parameters: {
            query?: {
                /** @description Page size (1-100, default 50; 0 = no limit) */
                limit?: number;
                /** @description Rows to skip (default 0) */
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            log_destinations: ({
                                id: string;
                                name: string;
                                /** @enum {string} */
                                type: "splunk_hec" | "datadog" | "otlp_http" | "webhook" | "syslog" | "azure_monitor" | "azure_event_hubs" | "gcp_logging" | "gcp_pubsub" | "aws_cloudwatch_logs";
                                config: {
                                    [key: string]: unknown;
                                };
                                /** @description Masked: every value is __SECRET__ */
                                credentials: {
                                    [key: string]: unknown;
                                };
                                filters: {
                                    [key: string]: unknown;
                                };
                                enabled: boolean;
                                status: string;
                                /** @description Last shipped event id */
                                cursor: string;
                            } & {
                                [key: string]: unknown;
                            })[];
                            total: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createLogDestination: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Unique name within the workspace */
                    name: string;
                    /**
                     * @description Destination type: splunk_hec, datadog, otlp_http, webhook, syslog, azure_monitor, azure_event_hubs, gcp_logging, gcp_pubsub, aws_cloudwatch_logs
                     * @enum {string}
                     */
                    type: "splunk_hec" | "datadog" | "otlp_http" | "webhook" | "syslog" | "azure_monitor" | "azure_event_hubs" | "gcp_logging" | "gcp_pubsub" | "aws_cloudwatch_logs";
                    /** @description Type-specific settings: splunk_hec { url, index?, sourcetype?, source?, host?, verify_tls? }; datadog { site?, service?, tags? }; otlp_http { endpoint, resource_attributes? }; webhook { url }; syslog { host, port?, transport? (tls|tcp|udp), framing?, facility?, app_name?, hostname?, tls_servername? }; azure_monitor { endpoint, dcr_immutable_id, stream_name, auth?, tenant_id?, client_id?, cloud? }; azure_event_hubs { namespace, event_hub, auth? (sas|client_secret|managed_identity), sas_key_name?, tenant_id?, client_id?, cloud? }; gcp_logging { project_id, log_id?, resource_type?, labels?, auth? }; gcp_pubsub { project_id, topic, attributes?, ordering_key?, auth? }; aws_cloudwatch_logs { region, log_group_name, log_stream_name?, auto_create?, auth? (access_key|instance_role) } */
                    config: {
                        [key: string]: unknown;
                    };
                    /** @description Secrets: splunk_hec { token }; datadog { api_key }; otlp_http { headers? }; webhook { signing_secret?, headers? }; syslog { client_cert?, client_key? }; azure_monitor { client_secret? }; azure_event_hubs { sas_key? | client_secret? }; gcp_logging / gcp_pubsub { service_account_json? }; aws_cloudwatch_logs { access_key_id?, secret_access_key? }. Never returned: reads show __SECRET__, and __SECRET__ on update keeps the stored value */
                    credentials?: {
                        [key: string]: unknown;
                    };
                    /** @description { categories?, types? (globs), min_severity?, workflow_ids? }; default every event */
                    filters?: {
                        [key: string]: unknown;
                    };
                    /** @description Default true */
                    enabled?: boolean;
                    /**
                     * @description now (default): only events from now on; retention_start: everything still retained
                     * @enum {string}
                     */
                    start_from?: "now" | "retention_start";
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            log_destination: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                type: "splunk_hec" | "datadog" | "otlp_http" | "webhook" | "syslog" | "azure_monitor" | "azure_event_hubs" | "gcp_logging" | "gcp_pubsub" | "aws_cloudwatch_logs";
                                config: {
                                    [key: string]: unknown;
                                };
                                /** @description Masked: every value is __SECRET__ */
                                credentials: {
                                    [key: string]: unknown;
                                };
                                filters: {
                                    [key: string]: unknown;
                                };
                                enabled: boolean;
                                status: string;
                                /** @description Last shipped event id */
                                cursor: string;
                            } & {
                                [key: string]: unknown;
                            };
                            /** @description Generated webhook signing secret (shown once) */
                            signing_secret?: string;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getLogDestination: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            log_destination: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                type: "splunk_hec" | "datadog" | "otlp_http" | "webhook" | "syslog" | "azure_monitor" | "azure_event_hubs" | "gcp_logging" | "gcp_pubsub" | "aws_cloudwatch_logs";
                                config: {
                                    [key: string]: unknown;
                                };
                                /** @description Masked: every value is __SECRET__ */
                                credentials: {
                                    [key: string]: unknown;
                                };
                                filters: {
                                    [key: string]: unknown;
                                };
                                enabled: boolean;
                                status: string;
                                /** @description Last shipped event id */
                                cursor: string;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteLogDestination: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @constant */
                            deleted: true;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateLogDestination: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    /**
                     * @description Cannot change; accepted so a fetched destination can be sent back
                     * @enum {string}
                     */
                    type?: "splunk_hec" | "datadog" | "otlp_http" | "webhook" | "syslog" | "azure_monitor" | "azure_event_hubs" | "gcp_logging" | "gcp_pubsub" | "aws_cloudwatch_logs";
                    /** @description Merged over the stored config (null removes a key) */
                    config?: {
                        [key: string]: unknown;
                    };
                    /** @description Merged over the stored credentials; __SECRET__ keeps a value, null removes it */
                    credentials?: {
                        [key: string]: unknown;
                    };
                    /** @description Replaces the filters */
                    filters?: {
                        [key: string]: unknown;
                    };
                    enabled?: boolean;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            log_destination: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                type: "splunk_hec" | "datadog" | "otlp_http" | "webhook" | "syslog" | "azure_monitor" | "azure_event_hubs" | "gcp_logging" | "gcp_pubsub" | "aws_cloudwatch_logs";
                                config: {
                                    [key: string]: unknown;
                                };
                                /** @description Masked: every value is __SECRET__ */
                                credentials: {
                                    [key: string]: unknown;
                                };
                                filters: {
                                    [key: string]: unknown;
                                };
                                enabled: boolean;
                                status: string;
                                /** @description Last shipped event id */
                                cursor: string;
                            } & {
                                [key: string]: unknown;
                            };
                            changed: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    resetLogDestinationCursor: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description now: skip everything not yet shipped; retention_start: re-send everything still retained
                     * @enum {string}
                     */
                    from: "now" | "retention_start";
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            log_destination: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                type: "splunk_hec" | "datadog" | "otlp_http" | "webhook" | "syslog" | "azure_monitor" | "azure_event_hubs" | "gcp_logging" | "gcp_pubsub" | "aws_cloudwatch_logs";
                                config: {
                                    [key: string]: unknown;
                                };
                                /** @description Masked: every value is __SECRET__ */
                                credentials: {
                                    [key: string]: unknown;
                                };
                                filters: {
                                    [key: string]: unknown;
                                };
                                enabled: boolean;
                                status: string;
                                /** @description Last shipped event id */
                                cursor: string;
                            } & {
                                [key: string]: unknown;
                            };
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getLogDestinationStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            id: string;
                            status: string;
                            enabled: boolean;
                            cursor: string;
                            /** @description Newest event id in this workspace */
                            latest_event_id: string;
                            /** @description Retained events after the cursor (before filters) */
                            lag_events: number;
                            /** @description Age of the oldest unsent event; null when caught up */
                            lag_seconds: number | null;
                            events_sent: number;
                            last_success_at: string | null;
                            last_error: string | null;
                            consecutive_failures: number;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    testLogDestination: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Resource id */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        success: true;
                        data: {
                            /** @description True when the destination answered 2xx */
                            ok: boolean;
                            /** @description HTTP status (null when no response: egress blocked, network error, timeout, and for syslog) */
                            status_code: number | null;
                            /** @description Round trip in milliseconds */
                            latency_ms: number;
                            /** @description Error detail (credentials redacted) */
                            error: string | null;
                            /** @description Whether the shipper would retry this failure (408/429/5xx/network) */
                            retryable: boolean;
                        } & {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description Validation failed */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Missing, invalid or expired credential */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Credential lacks the required permission or resource scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}
