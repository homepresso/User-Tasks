export const MCP_BUILD_ORDER = [
  'data tables first',
  'then business rules',
  'retention policies',
  'custom workflow activities',
  'and finally workflows',
] as const

export const MCP_BUILD_ORDER_SENTENCE = `When assembling a solution, MCP should think in this order: ${MCP_BUILD_ORDER.join(', ')}.`

export const MCP_REPORT_SCHEMA_GUIDANCE =
  'Use real source column keys for raw fields. For grouped outputs, use derived aggregate keys such as COUNT_id, SUM_amount, or AVG_duration_ms. Do not reference phantom source-prefixed aggregate columns such as workflow_runs._count.'

export const MCP_REPORT_EXAMPLES_GUIDANCE =
  'Canonical examples: raw table report => {"data_source":"workflow_runs","columns":["id","title","status","started_at","completed_at"],"filters":[{"field":"status","operator":"eq","value":"completed"}],"visualization":"table","sort":{"field":"started_at","direction":"desc"}}. Grouped aggregate report => {"data_source":"workflow_runs","columns":["status","COUNT_id"],"group_by":["status"],"aggregations":[{"field":"id","fn":"COUNT"}],"visualization":"bar","sort":{"field":"COUNT_id","direction":"desc"}}. Joined report => {"data_source":"tasks","columns":["title","status","assignee.display_name"],"joins":[{"source":"users","alias":"assignee","local_field":"assignee_id","foreign_field":"id","columns":["display_name"],"join_type":"left"}],"visualization":"table"}.'

export const MCP_REPORT_CHARTS_GUIDANCE =
  'Summary charts: config.charts (at most 8) are chart cards drawn above the report\'s table, each aggregated on the server from the report\'s own rows (same source, filters and permissions). A chart is {"id","title","type": number | line | area | column | bar | donut | pie | heatmap, "dimension": {"field", "bucket"?: day | week | month | day_of_week | hour_of_day} (omit for number cards; line / area need a bucket; heatmap = day of week × hour of a date column), "measure": {"fn": count | sum | avg | min | max | nps, "field"?}, "filters"?, "top_n"?, "range_days"? (last N days of the dimension date; number cards use "window_field"), "categories"? (fixed category order), "sort"?: value | label}. Example: {"id":"over_time","title":"Responses over time","type":"area","dimension":{"field":"created_at","bucket":"day"},"measure":{"fn":"count"},"range_days":90}. reports_preview returns each chart\'s series.'

export const MCP_WORKFLOW_RECIPES_GUIDANCE =
  'Prefer canonical workflow recipes for common automation patterns: data change to notification/action, approval with user_task branching, and middleware/webhook request-response flows with end_workflow.'

export const MCP_CORE_TOOL_DESCRIPTIONS = {
  workflows_preflight:
    'Validate a proposed workflow graph before creation or update. This checks node-level validation, middleware rules, trigger wiring, and whether referenced tables, retention policies, rules, references, teams, users, roles, custom activities, agents, and other workflow dependencies exist in the tenant.',
  workflows_validate:
    'Check a workflow (a saved draft by workflow_id, or a draft graph in nodes / edges / user_variables) without saving: node_errors are configuration errors (they block publishing); warnings are wiring problems that run but read blanks — {{…}} references nothing sets at that point (e.g. {{full_name}} after a form_submitted trigger: the fields are {{form.<key>}}; a User Task\'s form values are {{task_data.<key>}} or {{<step>_task_data.<key>}}), typos, and config keys the engine ignores (e.g. update_data_table output_var: the row id goes in output_row_id_var). Each warning has node_id, message and a suggestion to apply.',
  retention_policies_create:
    'Create a centrally governed retention policy that can later be assigned to tables/lists, individual rows, and roles. Roles support review-style retention only.',
  workflow_activities_create:
    'Create a custom workflow activity asset. Provide uploaded or inline code, and declare typed inputs and outputs so it appears as a native custom activity node in workflows.',
  reports_remediate_config:
    `Inspect and automatically repair a custom report config before preview or save. This tool rewrites legacy aggregate aliases such as workflow_runs._count, removes invalid columns/filters/joins, seeds safe defaults, and returns both the issues found and the remediated config. ${MCP_REPORT_SCHEMA_GUIDANCE}`,
  org_scope_resolve:
    'Resolve "who is in X" to people: scope me, direct_reports, all_reports (the people the caller manages), team, org_unit or project (give id). team / org_unit: recursive includes sub-teams / sub-units; project: include_teams (default true) adds attached teams\' members.',
  projects_members:
    'A project\'s people: direct members, and (include_teams, default true) the members of its attached and owning teams, sub-teams included; each with direct and via_team_ids.',
  tasks_follow:
    'Follow a task for the acting person: it appears in their Task tracker → Following tab (and tasks_following) until they unfollow it, completed or not. Only a task they can see: assignee, collaborator, member of the assigned team, a manager of an assignee, the assigner, someone it is shared with (invite), or tasks.view_all / tasks.manage_queue. Idempotent.',
  tasks_add_subtask:
    'Add a subtask under a task: title plus optional subtitle, description (plain text or HTML), estimated_effort_minutes, due_date, priority (default: the parent\'s) and tags. Allowed for anyone who can work on the task — assignee, collaborator, team member, the assignee\'s manager, its assigner, or tasks.view_all — with tasks.complete, while the task is open. Works on workflow tasks too: subtasks are a personal checklist and never complete or resume the workflow. The subtask goes to the parent\'s assignee (else the acting person) and counts toward the parent\'s progress.',
  tasks_following:
    'The acting person\'s followed tasks (Task tracker → Following) in the tracker\'s row shape: status, priority, due date, assignee, assigner, team, workflow, subtasks, recent activity, progress, followed_at and shared_with_me (tasks shared with them by an invite — directly, a team or a role — are listed too, read only; shared_only lists just those); sorted by due date. Completed tasks stay until unfollowed (hide_completed leaves them out); deleted tasks and tasks they can no longer see drop out.',
  forms_wizard_create:
    'Create a form with the form wizard in one call: a reusable form (questions in plain kinds: short_text, long_text, number, money, date, choice, choices, rating, nps, yes_no, email, phone, file, heading, page_break; "show only if" conditions; optional quiz scoring), a data table for the responses (a column per question + reference, submitted by / at, status, decision, score), an optional review / approval workflow (approval.mode none | single | manager | team | multi, published and active: each stage a task with the answers read only and Approve / Decline / Ask for changes; the decision is written back to the row and emailed to the requester) and a results page (/forms/results/<project id>) with saved reports. Needs forms.wizard only; everything is owned by the caller; on a failure nothing is kept. dry_run: true returns the plan only. Returns the project id (forms_wizard_update, forms_wizard_results), the created ids and links.',
  reports_create:
    `Create a saved custom report. The config supports full custom-report authoring, including joins, filters, date ranges, grouping, aggregations, calculated columns, visualization, chart styling, summary charts, drill targets, and row limits. Use reports_preview first when MCP is assembling a comprehensive report. ${MCP_REPORT_SCHEMA_GUIDANCE} ${MCP_REPORT_EXAMPLES_GUIDANCE} ${MCP_REPORT_CHARTS_GUIDANCE}`,
} as const
