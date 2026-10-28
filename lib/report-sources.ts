/* Report source definitions — maps data sources to their queryable columns */

export interface ReportColumn {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "json";
  /** If present, this column requires a join */
  join?: string;
}

export interface ReportSourceInput {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  defaultValue?: any;
  placeholder?: string;
  description?: string;
  options?: Array<{ label: string; value: string }>;
}

export interface ReportSource {
  key: string;
  table: string;
  label: string;
  category: string;
  description?: string;
  columns: ReportColumn[];
  defaultSort: { field: string; direction: "asc" | "desc" };
  /** Supabase select string including joins */
  select: string;
  /** Optional source-level filters always applied when querying this source */
  baseFilters?: ReportFilter[];
  /** If true, this source is resolved through custom server-side logic */
  virtual?: boolean;
  /** If true, this source was dynamically loaded (custom table / reference) */
  dynamic?: boolean;
  /** If true, columns may be discovered from runtime payloads rather than catalog metadata */
  schemaFlexible?: boolean;
  /** Optional input definitions for reference-backed or virtual sources */
  inputs?: ReportSourceInput[];
}

export interface ReportFilter {
  field: string;
  operator:
    | "eq"
    | "neq"
    | "gt"
    | "lt"
    | "gte"
    | "lte"
    | "like"
    | "ilike"
    | "in"
    | "is_null"
    | "is_not_null";
  value: any;
}

export interface ReportAggregation {
  field: string;
  fn: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
}

export interface ReportJoinConfig {
  id?: string;
  source: string;
  alias: string;
  local_field: string;
  foreign_field: string;
  columns: string[];
  join_type?: "left" | "inner";
  source_inputs?: Record<string, any>;
}

export interface ReportConfig {
  data_source: string;
  columns: string[];
  filters: ReportFilter[];
  source_inputs?: Record<string, any>;
  joins?: ReportJoinConfig[];
  group_by?: string[];
  aggregations?: ReportAggregation[];
  calculated_columns?: { name: string; expression: string }[];
  visualization:
    | "table"
    | "bar"
    | "line"
    | "area"
    | "pie"
    | "radar"
    | "scatter"
    | "funnel"
    | "stacked-bar"
    | "horizontal-bar";
  sort?: { field: string; direction: "asc" | "desc" };
  date_range?: { field: string; preset?: string; from?: string; to?: string };
  row_limit?: number;
  /**
   * Drill-down configuration. When set, each row in the table view becomes
   * a clickable link that navigates to a detail page. The template is a
   * string with {column_name} placeholders that get substituted with the
   * row's values. Example: "/tasks/{id}" or "/automations/runs/{id}"
   */
  drill_target?: {
    href_template: string; // e.g. "/tasks/{id}"
    label?: string; // e.g. "View task"
  };
  /**
   * Optional chart styling. Lets users override the default color palette,
   * add axis labels, and set a chart title independent of the saved report
   * name. All fields are optional — omit to fall back to sensible defaults.
   */
  chart_style?: {
    /** Color palette — array of hex strings. Applied in order to series/slices. */
    colors?: string[];
    /** Custom chart title (overrides saved-report name when displayed on the canvas). */
    chart_title?: string;
    /** X-axis label. Only applies to cartesian charts (bar/line/area/scatter). */
    x_axis_label?: string;
    /** Y-axis label. Only applies to cartesian charts. */
    y_axis_label?: string;
    /** Hide the legend — useful for small tiles. */
    hide_legend?: boolean;
    /** Hide gridlines — minimalist look. */
    hide_grid?: boolean;
  };
}

export const REFERENCE_REPORT_SOURCE_PREFIX = "reference_";

function humanizeReportKey(key: string) {
  return key
    .replace(/^data_/, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mapReferenceOutputType(type: unknown): ReportColumn["type"] {
  const normalized = String(type ?? "")
    .trim()
    .toLowerCase();
  if (["number", "integer", "float", "decimal"].includes(normalized))
    return "number";
  if (["boolean", "bool"].includes(normalized)) return "boolean";
  if (["date", "datetime", "timestamp"].includes(normalized)) return "date";
  if (["array", "object", "json"].includes(normalized)) return "json";
  return "text";
}

export function isReferenceReportSourceKey(key: string) {
  return (
    typeof key === "string" && key.startsWith(REFERENCE_REPORT_SOURCE_PREFIX)
  );
}

export function getReferenceReportSourceId(key: string) {
  return isReferenceReportSourceKey(key)
    ? key.slice(REFERENCE_REPORT_SOURCE_PREFIX.length)
    : null;
}

export function referenceToSource(reference: {
  id: string;
  name?: string | null;
  description?: string | null;
  inputs?: Array<{
    name?: string;
    label?: string;
    type?: string;
    required?: boolean;
    default_value?: any;
    placeholder?: string;
    description?: string;
    options?: Array<string | { label?: string; value?: string }>;
  }> | null;
  outputs?: Array<{ name?: string; type?: string }> | null;
  integration?: { id?: string; name?: string | null } | null;
}): ReportSource {
  const columns: ReportColumn[] = [];
  const seen = new Set<string>();

  const addColumn = (
    key: string,
    label?: string,
    type: ReportColumn["type"] = "text",
  ) => {
    const normalizedKey = key.trim();
    if (!normalizedKey || seen.has(normalizedKey)) return;
    seen.add(normalizedKey);
    columns.push({
      key: normalizedKey,
      label: label?.trim() || humanizeReportKey(normalizedKey),
      type,
    });
  };

  addColumn("id", "ID", "text");

  for (const output of reference.outputs ?? []) {
    const name = String(output?.name ?? "").trim();
    if (!name) continue;
    addColumn(
      name,
      humanizeReportKey(name),
      mapReferenceOutputType(output?.type),
    );
  }

  return {
    key: `${REFERENCE_REPORT_SOURCE_PREFIX}${reference.id}`,
    table: "__integration_reference__",
    label: reference.integration?.name
      ? `${reference.integration.name}: ${reference.name ?? "Reference"}`
      : (reference.name ?? "Reference"),
    description: reference.description ?? undefined,
    category: "Integration References",
    select: "*",
    defaultSort: { field: "id", direction: "asc" },
    columns,
    dynamic: true,
    virtual: true,
    schemaFlexible: true,
    inputs: (reference.inputs ?? [])
      .map((input) => ({
        name: String(input?.name ?? "").trim(),
        label: input?.label ? String(input.label).trim() : undefined,
        type: input?.type ? String(input.type).trim() : undefined,
        required: Boolean(input?.required),
        defaultValue: input?.default_value,
        placeholder: input?.placeholder
          ? String(input.placeholder).trim()
          : undefined,
        description: input?.description
          ? String(input.description).trim()
          : undefined,
        options: Array.isArray(input?.options)
          ? input.options
              .map((option) => {
                if (typeof option === "string") {
                  const normalized = option.trim();
                  return normalized
                    ? { label: normalized, value: normalized }
                    : null;
                }
                const value = String(option?.value ?? "").trim();
                if (!value) return null;
                const label = String(option?.label ?? value).trim() || value;
                return { label, value };
              })
              .filter((option): option is { label: string; value: string } =>
                Boolean(option),
              )
          : undefined,
      }))
      .filter((input) => input.name),
  };
}

/**
 * Default chart color palettes that users can pick from in the builder UI.
 * Each palette is a set of hex colors chosen to be visually distinguishable
 * and to work on both light and dark backgrounds.
 */
export const CHART_PALETTES: { id: string; label: string; colors: string[] }[] =
  [
    {
      id: "default",
      label: "Default",
      colors: [
        "#B08A54",
        "#4F7A5B",
        "#5B7285",
        "#C25E4C",
        "#A6721C",
        "#7D5B7A",
        "#8A9B6E",
        "#9B6B4F",
        "#6E8CA0",
        "#8C857A",
      ],
    },
    {
      id: "ocean",
      label: "Ocean",
      colors: [
        "#0EA5E9",
        "#06B6D4",
        "#0891B2",
        "#0D9488",
        "#14B8A6",
        "#10B981",
        "#3B82F6",
        "#6366F1",
        "#8B5CF6",
        "#2563EB",
      ],
    },
    {
      id: "sunset",
      label: "Sunset",
      colors: [
        "#F59E0B",
        "#F97316",
        "#EF4444",
        "#EC4899",
        "#D946EF",
        "#A855F7",
        "#FBBF24",
        "#FB923C",
        "#F87171",
        "#E11D48",
      ],
    },
    {
      id: "forest",
      label: "Forest",
      colors: [
        "#10B981",
        "#14B8A6",
        "#22C55E",
        "#84CC16",
        "#65A30D",
        "#047857",
        "#0D9488",
        "#059669",
        "#16A34A",
        "#4D7C0F",
      ],
    },
    {
      id: "monochrome",
      label: "Monochrome",
      colors: [
        "#0F172A",
        "#334155",
        "#475569",
        "#64748B",
        "#94A3B8",
        "#CBD5E1",
        "#1E293B",
        "#1E40AF",
        "#3B82F6",
        "#60A5FA",
      ],
    },
    {
      id: "vibrant",
      label: "Vibrant",
      colors: [
        "#EF4444",
        "#F97316",
        "#FBBF24",
        "#84CC16",
        "#10B981",
        "#06B6D4",
        "#3B82F6",
        "#8B5CF6",
        "#EC4899",
        "#F43F5E",
      ],
    },
  ];

/**
 * Drill-down target presets — a lookup of known entity types to the
 * corresponding detail page URL template. Used by the report builder's
 * drill-target picker so users don't have to hand-write templates.
 */
export const DRILL_TARGETS: {
  source: string;
  label: string;
  href_template: string;
}[] = [
  { source: "tasks", label: "Task detail", href_template: "/tasks/{id}" },
  {
    source: "workflow_runs",
    label: "Workflow run",
    href_template: "/automations/runs/{id}",
  },
  {
    source: "workflows",
    label: "Workflow builder",
    href_template: "/automations/{id}",
  },
  {
    source: "integration_call_logs",
    label: "Integration call",
    href_template: "/integrations/{integration_id}/calls/{id}",
  },
  {
    source: "integrations",
    label: "Integration detail",
    href_template: "/integrations/{id}",
  },
  {
    source: "agent_runs",
    label: "Agent run",
    href_template: "/agents/{agent_id}/runs/{id}",
  },
  { source: "agents", label: "Agent detail", href_template: "/agents/{id}" },
  {
    source: "business_rule_executions",
    label: "Business rule",
    href_template: "/automations/rules/{metadata.decision_table_id}",
  },
  {
    source: "retention_policies",
    label: "Retention policy",
    href_template: "/settings/governance?tab=retention",
  },
  {
    source: "retention_policy_reviews",
    label: "Retention review",
    href_template: "/settings/governance?tab=retention",
  },
  {
    source: "retention_policy_executions",
    label: "Retention execution",
    href_template: "/settings/governance?tab=retention",
  },
  {
    source: "retention_policy_assignments",
    label: "Retention coverage",
    href_template: "/settings/governance?tab=retention",
  },
  {
    source: "object_audit_log",
    label: "Linked entity",
    href_template: "" /* handled specially */,
  },
  { source: "users", label: "User profile", href_template: "/team" },
];

/** Resolve a href_template against a row by substituting {column} placeholders. */
export function resolveDrillHref(
  template: string | undefined,
  row: Record<string, any>,
): string | null {
  if (!template) return null;
  let result = template;
  const placeholders = template.match(/\{([^}]+)\}/g) ?? [];
  for (const ph of placeholders) {
    const key = ph.slice(1, -1);
    const value = key.split(".").reduce((o: any, k: string) => o?.[k], row);
    if (value == null || value === "") return null; // missing value — can't drill
    result = result.replaceAll(ph, String(value));
  }
  return result;
}

/* ── Static source definitions ── */

export const REPORT_SOURCES: ReportSource[] = [
  // ── Tasks ──
  {
    key: "tasks",
    table: "tasks",
    label: "Tasks",
    category: "Tasks",
    select:
      "*, assignee:users!tasks_assignee_id_fkey(id, display_name), tenant:tenants(id, name)",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "title", label: "Title", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "priority", label: "Priority", type: "text" },
      { key: "due_date", label: "Due Date", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
      { key: "completed_at", label: "Completed", type: "date" },
      { key: "started_at", label: "Started", type: "date" },
      {
        key: "estimated_effort_assigner",
        label: "Estimated Effort (Assigner)",
        type: "number",
      },
      {
        key: "estimated_effort_assignee",
        label: "Estimated Effort (Assignee)",
        type: "number",
      },
      { key: "actual_effort", label: "Actual Effort", type: "number" },
      { key: "progress_pct", label: "Progress %", type: "number" },
      { key: "is_workflow_task", label: "Workflow Task", type: "boolean" },
      { key: "acceptance_status", label: "Acceptance", type: "text" },
      { key: "outcome", label: "Outcome", type: "text" },
      { key: "child_count", label: "Subtask Count", type: "number" },
      {
        key: "completed_child_count",
        label: "Completed Subtasks",
        type: "number",
      },
      {
        key: "assignee.display_name",
        label: "Assignee",
        type: "text",
        join: "assignee",
      },
      {
        key: "tenant.name",
        label: "Organisation",
        type: "text",
        join: "tenant",
      },
    ],
  },
  {
    key: "effort_records",
    table: "effort_records",
    label: "Effort Records",
    category: "Tasks",
    select: "*, user:users(id, display_name)",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "task_id", label: "Task ID", type: "text" },
      { key: "minutes", label: "Minutes", type: "number" },
      { key: "record_type", label: "Type", type: "text" },
      { key: "notes", label: "Notes", type: "text" },
      { key: "created_at", label: "Created", type: "date" },
      { key: "user.display_name", label: "User", type: "text", join: "user" },
    ],
  },
  {
    key: "lifecycle_events",
    table: "lifecycle_events",
    label: "Task Events",
    category: "Tasks",
    select: "*, actor:users!lifecycle_events_actor_id_fkey(id, display_name)",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "task_id", label: "Task ID", type: "text" },
      { key: "event_type", label: "Event Type", type: "text" },
      { key: "created_at", label: "Created", type: "date" },
      {
        key: "actor.display_name",
        label: "Actor",
        type: "text",
        join: "actor",
      },
    ],
  },
  {
    key: "task_assignees",
    table: "task_assignees",
    label: "Task Assignees",
    category: "Tasks",
    select: "*, user:users(id, display_name)",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "task_id", label: "Task ID", type: "text" },
      { key: "role", label: "Role", type: "text" },
      { key: "acceptance_status", label: "Acceptance", type: "text" },
      { key: "accepted_at", label: "Accepted At", type: "date" },
      { key: "created_at", label: "Assigned", type: "date" },
      { key: "user.display_name", label: "User", type: "text", join: "user" },
    ],
  },
  {
    key: "task_escalations",
    table: "task_escalations",
    label: "Task Escalations",
    category: "Tasks",
    select: "*",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "task_id", label: "Task ID", type: "text" },
      { key: "escalation_type", label: "Type", type: "text" },
      { key: "escalate_after_minutes", label: "After (min)", type: "number" },
      { key: "is_escalated", label: "Escalated", type: "boolean" },
      { key: "escalated_at", label: "Escalated At", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
    ],
  },
  {
    key: "task_responses",
    table: "task_responses",
    label: "Task Responses",
    category: "Tasks",
    select: "*, user:users(id, display_name)",
    defaultSort: { field: "responded_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "task_id", label: "Task ID", type: "text" },
      { key: "outcome", label: "Outcome", type: "text" },
      { key: "outcome_notes", label: "Notes", type: "text" },
      { key: "responded_at", label: "Responded", type: "date" },
      { key: "user.display_name", label: "User", type: "text", join: "user" },
    ],
  },

  // ── Workflows ──
  {
    key: "workflow_runs",
    table: "workflow_runs",
    label: "Workflow Runs",
    category: "Workflows",
    select: "*, workflow:workflows(id, name)",
    defaultSort: { field: "started_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "sla_status", label: "SLA Status", type: "text" },
      { key: "sla_label", label: "SLA Label", type: "text" },
      { key: "sla_due_at", label: "SLA Due", type: "date" },
      { key: "sla_warning_at", label: "SLA Warning", type: "date" },
      { key: "started_at", label: "Started", type: "date" },
      { key: "completed_at", label: "Completed", type: "date" },
      { key: "error", label: "Error", type: "text" },
      { key: "title", label: "Title", type: "text" },
      {
        key: "workflow.name",
        label: "Workflow",
        type: "text",
        join: "workflow",
      },
    ],
  },
  {
    key: "workflow_logs",
    table: "workflow_logs",
    label: "Workflow Logs",
    category: "Workflows",
    select:
      "*, workflow:workflows!workflow_logs_workflow_id_fkey(id, name), run:workflow_runs!workflow_logs_run_id_fkey(id, title, status, started_at, completed_at, error)",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "workflow_id", label: "Workflow ID", type: "text" },
      { key: "run_id", label: "Run ID", type: "text" },
      { key: "level", label: "Level", type: "text" },
      { key: "message", label: "Message", type: "text" },
      { key: "node_type", label: "Node Type", type: "text" },
      { key: "node_label", label: "Node Label", type: "text" },
      { key: "duration_ms", label: "Duration (ms)", type: "number" },
      {
        key: "workflow.name",
        label: "Workflow",
        type: "text",
        join: "workflow",
      },
      { key: "run.title", label: "Run Title", type: "text", join: "run" },
      { key: "run.status", label: "Run Status", type: "text", join: "run" },
      { key: "created_at", label: "Created", type: "date" },
    ],
  },
  {
    key: "business_rule_executions",
    table: "workflow_logs",
    label: "Business Rule Executions",
    category: "Business Rules",
    select:
      "*, workflow:workflows!workflow_logs_workflow_id_fkey(id, name), run:workflow_runs!workflow_logs_run_id_fkey(id, title, status, started_at, completed_at, error)",
    defaultSort: { field: "created_at", direction: "desc" },
    baseFilters: [
      { field: "node_type", operator: "eq", value: "decision_table" },
    ],
    columns: [
      { key: "id", label: "Execution Log ID", type: "text" },
      { key: "workflow_id", label: "Workflow ID", type: "text" },
      {
        key: "workflow.name",
        label: "Workflow",
        type: "text",
        join: "workflow",
      },
      { key: "run_id", label: "Run ID", type: "text" },
      { key: "run.title", label: "Run Title", type: "text", join: "run" },
      { key: "run.status", label: "Run Status", type: "text", join: "run" },
      { key: "node_label", label: "Activity Label", type: "text" },
      { key: "duration_ms", label: "Execution Time (ms)", type: "number" },
      {
        key: "metadata.decision_table_id",
        label: "Business Rule ID",
        type: "text",
      },
      {
        key: "metadata.decision_table_name",
        label: "Business Rule",
        type: "text",
      },
      { key: "metadata.matched", label: "Matched Rule", type: "boolean" },
      { key: "metadata.rule_id", label: "Matched Rule ID", type: "text" },
      { key: "metadata.rule_label", label: "Matched Rule Label", type: "text" },
      { key: "metadata.input_count", label: "Input Count", type: "number" },
      { key: "metadata.output_count", label: "Output Count", type: "number" },
      { key: "metadata.output_keys", label: "Output Keys", type: "json" },
      { key: "metadata.inputs", label: "Inputs", type: "json" },
      { key: "metadata.outputs", label: "Outputs", type: "json" },
      { key: "created_at", label: "Executed At", type: "date" },
    ],
  },
  {
    key: "workflow_queue",
    table: "workflow_queue",
    label: "Workflow Queue",
    category: "Workflows",
    select: "*, workflow:workflows(id, name)",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "priority", label: "Priority", type: "number" },
      { key: "trigger_type", label: "Trigger", type: "text" },
      { key: "attempts", label: "Attempts", type: "number" },
      { key: "max_attempts", label: "Max Attempts", type: "number" },
      { key: "error", label: "Error", type: "text" },
      { key: "scheduled_for", label: "Scheduled For", type: "date" },
      { key: "started_at", label: "Started", type: "date" },
      { key: "completed_at", label: "Completed", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
      {
        key: "workflow.name",
        label: "Workflow",
        type: "text",
        join: "workflow",
      },
    ],
  },
  {
    key: "workflows",
    table: "workflows",
    label: "Workflows",
    category: "Workflows",
    select:
      "id, name, is_active, trigger_type, run_count, last_run_at, tags, created_at, updated_at",
    defaultSort: { field: "updated_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "is_active", label: "Active", type: "boolean" },
      { key: "trigger_type", label: "Trigger Type", type: "text" },
      { key: "run_count", label: "Run Count", type: "number" },
      { key: "last_run_at", label: "Last Run", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
      { key: "updated_at", label: "Updated", type: "date" },
    ],
  },

  // ── Integrations ──
  {
    key: "integrations",
    table: "integrations",
    label: "Integrations",
    category: "Integrations",
    select: "*",
    defaultSort: { field: "updated_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "type", label: "Type", type: "text" },
      { key: "is_active", label: "Active", type: "boolean" },
      { key: "last_test_status", label: "Test Status", type: "text" },
      { key: "last_tested_at", label: "Last Tested", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
      { key: "updated_at", label: "Updated", type: "date" },
    ],
  },
  {
    key: "integration_references",
    table: "integration_references",
    label: "Integration References",
    category: "Integrations",
    select: "*, integration:integrations(id, name)",
    defaultSort: { field: "updated_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "created_at", label: "Created", type: "date" },
      { key: "updated_at", label: "Updated", type: "date" },
      {
        key: "integration.name",
        label: "Integration",
        type: "text",
        join: "integration",
      },
    ],
  },
  {
    key: "tenant_connectors",
    table: "tenant_connectors",
    label: "Connectors",
    category: "Integrations",
    select: "*, integration:integrations(id, name)",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "connector_key", label: "Connector Key", type: "text" },
      { key: "display_name", label: "Display Name", type: "text" },
      { key: "is_enabled", label: "Enabled", type: "boolean" },
      { key: "last_test_status", label: "Test Status", type: "text" },
      { key: "last_tested_at", label: "Last Tested", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
      {
        key: "integration.name",
        label: "Integration",
        type: "text",
        join: "integration",
      },
    ],
  },

  // ── Users & Teams ──
  {
    key: "users",
    table: "users",
    label: "Users",
    category: "Organisation",
    select:
      "id, display_name, email, role, available_hours_week, timezone, last_seen_at, created_at, updated_at",
    defaultSort: { field: "display_name", direction: "asc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "display_name", label: "Name", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "role", label: "Role", type: "text" },
      {
        key: "available_hours_week",
        label: "Available Hrs/Week",
        type: "number",
      },
      { key: "timezone", label: "Timezone", type: "text" },
      { key: "last_seen_at", label: "Last Seen", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
    ],
  },
  {
    key: "teams",
    table: "teams",
    label: "Teams",
    category: "Organisation",
    select: "*",
    defaultSort: { field: "name", direction: "asc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "created_at", label: "Created", type: "date" },
    ],
  },

  // ── Notifications & Audit ──
  {
    key: "notifications",
    table: "notifications",
    label: "Notifications",
    category: "Audit",
    select: "*, user:users(id, display_name)",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "title", label: "Title", type: "text" },
      { key: "body", label: "Body", type: "text" },
      { key: "type", label: "Type", type: "text" },
      { key: "is_read", label: "Read", type: "boolean" },
      { key: "task_id", label: "Task ID", type: "text" },
      { key: "created_at", label: "Created", type: "date" },
      { key: "user.display_name", label: "User", type: "text", join: "user" },
    ],
  },
  {
    key: "dead_letter_events",
    table: "dead_letter_events",
    label: "Failed Deliveries",
    category: "Audit",
    select: "*",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "event_type", label: "Event Type", type: "text" },
      { key: "target_url", label: "Target URL", type: "text" },
      { key: "attempts", label: "Attempts", type: "number" },
      { key: "error_message", label: "Error", type: "text" },
      { key: "last_attempt_at", label: "Last Attempt", type: "date" },
      { key: "task_id", label: "Task ID", type: "text" },
      { key: "created_at", label: "Created", type: "date" },
    ],
  },
  {
    key: "api_keys",
    table: "api_keys",
    label: "API Keys",
    category: "Audit",
    select:
      "id, name, key_prefix, is_revoked, expires_at, last_used_at, created_at",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "key_prefix", label: "Key Prefix", type: "text" },
      { key: "is_revoked", label: "Revoked", type: "boolean" },
      { key: "expires_at", label: "Expires", type: "date" },
      { key: "last_used_at", label: "Last Used", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
    ],
  },
  {
    key: "invitations",
    table: "invitations",
    label: "Invitations",
    category: "Audit",
    select: "*",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "role", label: "Role", type: "text" },
      { key: "accepted_at", label: "Accepted", type: "date" },
      { key: "expires_at", label: "Expires", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
    ],
  },

  // ── Observability (Phase 1 instrumentation) ──
  {
    key: "object_audit_log",
    table: "object_audit_log",
    label: "Object Audit Log",
    category: "Observability",
    select: "*, actor:users!object_audit_log_actor_id_fkey(id, display_name)",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "object_type", label: "Object Type", type: "text" },
      { key: "object_id", label: "Object ID", type: "text" },
      { key: "action", label: "Action", type: "text" },
      { key: "summary", label: "Summary", type: "text" },
      {
        key: "actor.display_name",
        label: "Actor",
        type: "text",
        join: "actor",
      },
      { key: "created_at", label: "When", type: "date" },
    ],
  },
  {
    key: "integration_call_logs",
    table: "integration_call_logs",
    label: "Integration Call Logs",
    category: "Observability",
    // Use explicit FK constraint names — PostgREST can't always auto-resolve
    // when multiple FKs exist between the same tables, and stale schema
    // caches fail silently with a generic "query failed". Explicit is best.
    select:
      "*, integration:integrations!integration_call_logs_integration_id_fkey(id, name), reference:integration_references!integration_call_logs_reference_id_fkey(id, name)",
    defaultSort: { field: "started_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      {
        key: "integration.name",
        label: "Integration",
        type: "text",
        join: "integration",
      },
      {
        key: "reference.name",
        label: "Reference",
        type: "text",
        join: "reference",
      },
      { key: "method", label: "Method", type: "text" },
      { key: "url", label: "URL", type: "text" },
      { key: "response_status", label: "Status", type: "number" },
      { key: "duration_ms", label: "Duration (ms)", type: "number" },
      { key: "caller_type", label: "Caller Type", type: "text" },
      { key: "caller_id", label: "Caller ID", type: "text" },
      { key: "error", label: "Error", type: "text" },
      { key: "started_at", label: "Started", type: "date" },
      { key: "completed_at", label: "Completed", type: "date" },
    ],
  },
  {
    key: "agent_runs",
    table: "agent_runs",
    label: "Agent Runs",
    category: "Observability",
    select: "*, agent:agents!agent_runs_agent_id_fkey(id, name, model)",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: [
      { key: "id", label: "ID", type: "text" },
      { key: "agent.name", label: "Agent", type: "text", join: "agent" },
      { key: "status", label: "Status", type: "text" },
      { key: "model", label: "Model", type: "text" },
      { key: "iterations", label: "Iterations", type: "number" },
      { key: "total_tokens", label: "Total Tokens", type: "number" },
      { key: "input_tokens", label: "Input Tokens", type: "number" },
      { key: "output_tokens", label: "Output Tokens", type: "number" },
      { key: "duration_ms", label: "Duration (ms)", type: "number" },
      { key: "caller_type", label: "Caller Type", type: "text" },
      { key: "error", label: "Error", type: "text" },
      { key: "started_at", label: "Started", type: "date" },
      { key: "completed_at", label: "Completed", type: "date" },
    ],
  },
  {
    key: "retention_policies",
    table: "retention_policies",
    label: "Retention Policies",
    category: "Retention",
    select: "*",
    defaultSort: { field: "updated_at", direction: "desc" },
    columns: [
      { key: "id", label: "Policy ID", type: "text" },
      { key: "name", label: "Policy Name", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "policy_mode", label: "Mode", type: "text" },
      { key: "duration_value", label: "Duration Value", type: "number" },
      { key: "duration_unit", label: "Duration Unit", type: "text" },
      { key: "exact_date", label: "Exact Date", type: "date" },
      { key: "applies_to", label: "Applies To", type: "json" },
      { key: "created_at", label: "Created", type: "date" },
      { key: "updated_at", label: "Updated", type: "date" },
    ],
  },
  {
    key: "retention_policy_reviews",
    table: "retention_review_events",
    label: "Retention Reviews",
    category: "Retention",
    select:
      "*, retention_policy:retention_policies!retention_review_events_retention_policy_id_fkey(id, name, policy_mode)",
    defaultSort: { field: "review_date", direction: "desc" },
    columns: [
      { key: "id", label: "Review Event ID", type: "text" },
      { key: "retention_policy_id", label: "Policy ID", type: "text" },
      {
        key: "retention_policy.name",
        label: "Policy",
        type: "text",
        join: "retention_policy",
      },
      {
        key: "retention_policy.policy_mode",
        label: "Policy Mode",
        type: "text",
        join: "retention_policy",
      },
      { key: "target_type", label: "Target Type", type: "text" },
      { key: "target_id", label: "Target ID", type: "text" },
      { key: "asset_name", label: "Asset Name", type: "text" },
      { key: "review_date", label: "Review Date", type: "date" },
      { key: "status", label: "Status", type: "text" },
      {
        key: "admin_tasks_created_at",
        label: "Admin Tasks Created",
        type: "date",
      },
      {
        key: "workflow_triggered_at",
        label: "Workflow Triggered",
        type: "date",
      },
      { key: "task_ids", label: "Review Tasks", type: "json" },
      { key: "metadata", label: "Metadata", type: "json" },
      { key: "created_at", label: "Created", type: "date" },
      { key: "updated_at", label: "Updated", type: "date" },
    ],
  },
  {
    key: "retention_policy_executions",
    table: "retention_execution_events",
    label: "Retention Executions",
    category: "Retention",
    select:
      "*, retention_policy:retention_policies!retention_execution_events_retention_policy_id_fkey(id, name, policy_mode)",
    defaultSort: { field: "executed_at", direction: "desc" },
    columns: [
      { key: "id", label: "Execution Event ID", type: "text" },
      { key: "retention_policy_id", label: "Policy ID", type: "text" },
      {
        key: "retention_policy.name",
        label: "Policy",
        type: "text",
        join: "retention_policy",
      },
      {
        key: "retention_policy.policy_mode",
        label: "Policy Mode",
        type: "text",
        join: "retention_policy",
      },
      { key: "action_type", label: "Action", type: "text" },
      { key: "target_type", label: "Target Type", type: "text" },
      { key: "target_id", label: "Target ID", type: "text" },
      { key: "asset_name", label: "Asset Name", type: "text" },
      { key: "result_status", label: "Result Status", type: "text" },
      {
        key: "workflow_triggered_at",
        label: "Workflow Triggered",
        type: "date",
      },
      { key: "metadata", label: "Metadata", type: "json" },
      { key: "executed_at", label: "Executed At", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
      { key: "updated_at", label: "Updated", type: "date" },
    ],
  },
  {
    key: "retention_policy_assignments",
    table: "__retention_policy_assignments__",
    label: "Retention Coverage",
    category: "Retention",
    select: "*",
    virtual: true,
    defaultSort: { field: "asset_name", direction: "asc" },
    columns: [
      { key: "id", label: "Assignment ID", type: "text" },
      { key: "target_type", label: "Target Type", type: "text" },
      { key: "target_id", label: "Target ID", type: "text" },
      { key: "asset_name", label: "Asset Name", type: "text" },
      { key: "retention_policy_id", label: "Policy ID", type: "text" },
      { key: "retention_policy_name", label: "Policy", type: "text" },
      { key: "policy_mode", label: "Policy Mode", type: "text" },
      { key: "applies_to", label: "Applies To", type: "json" },
      { key: "retention_applied_at", label: "Applied At", type: "date" },
      { key: "created_at", label: "Created", type: "date" },
      { key: "next_review_date", label: "Next Review", type: "date" },
      { key: "next_execution_date", label: "Next Execution", type: "date" },
      { key: "retention_status", label: "Retention Status", type: "text" },
      { key: "retention_status_tone", label: "Status Tone", type: "text" },
    ],
  },
];

export function buildJoinedReportColumns(
  baseColumns: ReportColumn[],
  joins: ReportJoinConfig[] | undefined,
  allSources: ReportSource[],
): ReportColumn[] {
  const next = [...baseColumns];
  for (const join of joins ?? []) {
    if (!join?.source || !join?.alias) continue;
    const target = allSources.find((source) => source.key === join.source);
    if (!target) continue;
    for (const columnKey of join.columns ?? []) {
      const col =
        target.columns.find((targetColumn) => targetColumn.key === columnKey) ??
        (target.schemaFlexible
          ? {
              key: columnKey,
              label: humanizeReportKey(columnKey),
              type: "text" as const,
            }
          : null);
      if (!col) continue;
      next.push({
        key: `${join.alias}.${columnKey}`,
        label: `${join.alias}: ${col.label}`,
        type: col.type,
        join: join.alias,
      });
    }
  }
  return next;
}

/* ── Custom table column type mapping ── */
const CUSTOM_COL_TYPE_MAP: Record<string, ReportColumn["type"]> = {
  text: "text",
  longtext: "text",
  select: "text",
  file: "text",
  number: "number",
  date: "date",
  boolean: "boolean",
};

/** Build a dynamic ReportSource from a custom_tables record */
export function customTableToSource(table: {
  id: string;
  name: string;
  columns: any[];
}): ReportSource {
  const cols: ReportColumn[] = [
    { key: "id", label: "Row ID", type: "text" },
    { key: "created_at", label: "Created", type: "date" },
    { key: "updated_at", label: "Updated", type: "date" },
  ];
  for (const c of table.columns ?? []) {
    // Data is stored as JSONB — columns appear as data->key
    cols.push({
      key: `data_${c.key || c.name}`,
      label: c.name,
      type: CUSTOM_COL_TYPE_MAP[c.type] ?? "text",
    });
  }
  return {
    key: `custom_table_${table.id}`,
    table: "custom_table_rows",
    label: table.name,
    category: "Data Tables",
    select: "*",
    defaultSort: { field: "created_at", direction: "desc" },
    columns: cols,
    dynamic: true,
  };
}
