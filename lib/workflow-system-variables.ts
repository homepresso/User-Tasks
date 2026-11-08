/**
 * Run variables the engine sets itself (lib/workflow-engine.ts), by when they
 * exist. Shared by the engine (per-step User Task copies) and the wiring
 * validator (lib/workflow-wiring.ts), which must know every name a run can
 * hold so it never flags a real one. Pure, no imports.
 */

/** Set when every run starts (executeWorkflow) or by the engine at any step. */
export const ALWAYS_RUN_VARIABLES = [
  'task_id', 'tenant_id', 'workflow_id', 'workflow_name', 'workflow_started_at',
  'workflow_started_by', 'workflow_started_via', 'workflow_owner_id', 'workflow_initiator_user_id',
  'trigger_type', '_trigger_type', '_workflow_inputs', 'run_id', 'app_url',
  // A step that failed with "continue on error".
  'has_error', 'last_error', 'last_error_node', 'last_error_node_id', 'last_error_node_type',
  // Live bindings (`{{live.<name>}}`).
  'live',
] as const

/**
 * Variables a User Task sets on resume (lib/task-completion.ts ResumePayload):
 * the generic names are the LATEST completed task's.
 */
export const USER_TASK_RESUME_VARIABLES = [
  'outcome', 'outcome_notes', 'actioned_by', 'actioned_by_name',
  'completed_by', 'completed_by_name', 'completed_by_email', 'completed_at',
  'actioned_on_behalf_of', 'actioned_on_behalf_of_name', 'on_behalf_note',
  'user_task_id', 'response_count', 'outcome_counts', 'task_data', 'attachments',
] as const

/**
 * Resume variables the engine also keeps per step, as `<prefix>_<name>`
 * (e.g. `{{hr_approval_task_data.comment}}`), so a later User Task does not
 * hide an earlier one's values.
 */
export const USER_TASK_PER_STEP_VARIABLES = [
  'task_data', 'outcome', 'outcome_notes', 'completed_by', 'completed_by_name', 'completed_by_email', 'completed_at', 'attachments',
] as const

/** Set while a User Task waits (and kept after): the generic and `<prefix>_` names. */
export const USER_TASK_CREATE_VARIABLES = [
  'task_id', 'event_id', 'user_task_id', 'user_task_title', 'user_task_description', 'user_task_description_html', 'user_task_event_id',
] as const

/**
 * Generic names steps set besides their configured outputs (setVar in the
 * engine sets `<prefix>_<name>` and `<name>`).
 */
export const STEP_GENERIC_VARIABLES: Record<string, readonly string[]> = {
  set_title: ['_title'],
  set_sla: ['workflow_sla_label', 'workflow_sla_due_at', 'workflow_sla_warning_at', 'workflow_sla_status'],
  call_sub_workflow: ['status', 'results', 'error', 'sub_workflow_status', 'sub_workflow_results', 'sub_workflow_error'],
  decision_table: ['matched', 'rule_id', 'rule_label', 'outputs'],
  retention_policies: ['policy_count', 'policies', 'retention_policy_id', 'retention_policy_name', 'policy', 'asset_count', 'assets', 'data_tables', 'data_rows', 'roles', 'target_type', 'target_id'],
  user_task: [...USER_TASK_CREATE_VARIABLES, ...USER_TASK_RESUME_VARIABLES],
  server_event: ['event_id', 'event_name'],
  update_data_table: ['retention_policy_id'],
  call_reference: ['response', 'status', 'api_response', 'api_status', 'api_file', 'api_file_url', 'api_file_name', 'api_file_size'],
  add_task_attachment: ['attachment'],
  add_user_to_role: ['success', 'action', 'user_id', 'role_id', 'role_name', 'audited'],
  remove_user_from_role: ['success', 'action', 'user_id', 'role_id', 'role_name', 'audited'],
  check_permission: ['has_permission', 'permissions'],
  http_request: ['response', 'status', 'file', 'file_url', 'http_file', 'http_file_url'],
  read_csv: ['file', 'file_url'],
  read_excel: ['file', 'file_url'],
}

/**
 * Default output variable of steps whose `output_var` (or similar) is
 * optional — the engine's `config.output_var ?? '<default>'`.
 */
export const STEP_DEFAULT_OUTPUTS: Record<string, readonly string[]> = {
  math: ['result'],
  modify_string: ['modified_string'],
  text_template: ['text'],
  format_date: ['formatted_date'],
  date_math: ['new_date'],
  regex: ['regex_result'],
  collection_count: ['count'],
  collection_get: ['item'],
  collection_filter: ['filtered'],
  collection_sort: ['sorted'],
  collection_unique: ['unique'],
  collection_join: ['joined'],
  json_build_array: ['json_array'],
  json_add_to_array: ['json_array'],
  read_csv: ['csv_data', 'csv_data_count', 'csv_file'],
  read_excel: ['excel_data', 'excel_data_count', 'excel_file'],
  download_file: ['downloaded_file'],
  read_file: ['file_content'],
  file_to_base64: ['base64', 'file_content'],
  base64_to_file: ['file_url'],
  loop: ['item', 'index'],
  loop_n_times: ['i', 'index', 'iteration'],
  run_agent: ['agent_response'],
  doc_word: ['doc_file'],
  doc_excel: ['doc_file'],
  doc_powerpoint: ['doc_file'],
}
