export type NodeType =
  // Triggers
  | 'task_created'
  | 'task_received'
  | 'task_submitted'
  | 'task_updated'
  | 'task_completed'
  | 'task_rejected'
  | 'workflow_error'
  | 'workflow_sla'
  | 'retention_policy_review'
  | 'retention_policy_executed'
  | 'data_table_event'
  | 'form_submitted'
  | 'middleware_received'
  | 'schedule'
  | 'webhook_received'
  // Logic & Flow
  | 'condition'
  | 'switch_case'
  | 'loop'
  | 'loop_n_times'
  | 'delay'
  | 'pause_until'
  | 'end_workflow'
  // Operations
  | 'set_title'
  | 'set_sla'
  | 'set_variable'
  | 'math'
  | 'modify_string'
  | 'format_date'
  | 'date_math'
  | 'regex'
  | 'text_template'
  // JSON operations
  | 'json_build_object'
  | 'json_build_array'
  | 'json_add_to_array'
  | 'json_get_value'
  // Collection operations
  | 'collection_count'
  | 'collection_get'
  | 'collection_filter'
  | 'collection_sort'
  | 'collection_unique'
  | 'collection_join'
  // Actions
  | 'update_task'
  | 'update_data_table'
  | 'retention_policies'
  | 'call_reference'
  | 'custom_activity'
  | 'create_subtask'
  | 'auto_action'
  | 'http_request'
  | 'log'
  // File operations
  | 'file_to_base64'
  | 'base64_to_file'
  | 'download_file'
  | 'read_file'
  // File parsing
  | 'read_csv'
  | 'read_excel'
  // Document generation
  | 'doc_word'
  | 'doc_excel'
  | 'doc_powerpoint'
  // Sub-workflow
  | 'call_sub_workflow'
  | 'decision_table'
  // Human-in-the-loop
  | 'user_task'
  // Navigation & Flow Control
  | 'goto_activity'
  | 'parallel'
  // Placeholder
  | 'placeholder'
  // Events
  | 'server_event'
  // Tools
  | 'section_group'
  | 'live_reference'
  | 'send_email'
  | 'run_agent'
  // Governance
  | 'add_user_to_role'
  | 'remove_user_from_role'
  | 'check_permission'

export interface WorkflowNode {
  id: string
  type: NodeType
  label: string
  position: { x: number; y: number }
  config: Record<string, any>
  onError?: 'stop' | 'continue'  // Default: 'stop'
  executionMode?: 'sync' | 'async'  // Default: 'sync' (wait for result)
  collapsed?: boolean  // Compact view mode
  sectionId?: string  // ID of the containing section (UI grouping only)
}

export type PortSide = 'bottom' | 'left' | 'right'

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  label?: string
  sourcePort?: PortSide  // default: 'bottom'
}

// Collapsible sections — visual grouping of nodes on the canvas
export interface WorkflowSection {
  id: string
  label: string
  color: string
  position: { x: number; y: number }
  width: number
  height: number
  collapsed: boolean
}

export interface WorkflowSchema {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  sections?: WorkflowSection[]
}

export const NODE_CATALOG: {
  type: NodeType
  label: string
  icon: string
  category: 'trigger' | 'logic' | 'operation' | 'collection' | 'action' | 'section'
  color: string
  description: string
}[] = [
  // ─── Triggers ───
  { type: 'task_created', label: 'Task Created', icon: 'Plus', category: 'trigger', color: '#22C55E', description: 'When a new task is created' },
  { type: 'task_received', label: 'Task Received', icon: 'Inbox', category: 'trigger', color: '#22C55E', description: 'When a task lands in the queue' },
  { type: 'task_submitted', label: 'Task Submitted', icon: 'Send', category: 'trigger', color: '#22C55E', description: 'When a task is accepted' },
  { type: 'task_updated', label: 'Task Updated', icon: 'RefreshCw', category: 'trigger', color: '#22C55E', description: 'When a task is modified' },
  { type: 'task_completed', label: 'Task Completed', icon: 'CheckCircle', category: 'trigger', color: '#22C55E', description: 'When a task is completed' },
  { type: 'task_rejected', label: 'Task Rejected', icon: 'XCircle', category: 'trigger', color: '#EF4444', description: 'When a task is rejected from the queue' },
  { type: 'workflow_error', label: 'Workflow Error', icon: 'AlertTriangle', category: 'trigger', color: '#EF4444', description: 'When any workflow fails with an error' },
  { type: 'workflow_sla', label: 'Workflow SLA', icon: 'Siren', category: 'trigger', color: '#F59E0B', description: 'When a workflow SLA is nearing or breached' },
  { type: 'retention_policy_review', label: 'Policy Review', icon: 'Archive', category: 'trigger', color: '#22C55E', description: 'When a retention policy review becomes due' },
  { type: 'retention_policy_executed', label: 'Policy Executed', icon: 'ArchiveRestore', category: 'trigger', color: '#22C55E', description: 'When a retention policy action such as purge is executed' },
  { type: 'form_submitted', label: 'Form Submitted', icon: 'ClipboardCheck', category: 'trigger', color: '#22C55E', description: 'When a reusable form is submitted (its own page, the API or as a task form)' },
  { type: 'data_table_event', label: 'Data Table Event', icon: 'Database', category: 'trigger', color: '#22C55E', description: 'When a data table row is created, updated, or deleted' },
  { type: 'middleware_received', label: 'Middleware', icon: 'Globe', category: 'trigger', color: '#22C55E', description: 'Receive a webhook and return a workflow response synchronously' },
  { type: 'schedule', label: 'Schedule', icon: 'Clock', category: 'trigger', color: '#22C55E', description: 'Run on a schedule' },
  { type: 'webhook_received', label: 'Webhook', icon: 'Globe', category: 'trigger', color: '#22C55E', description: 'Triggered by an incoming webhook' },
  // ─── Logic & Flow ───
  { type: 'condition', label: 'Branch by Condition', icon: 'GitBranch', category: 'logic', color: '#F59E0B', description: 'If/else if/else branching' },
  { type: 'switch_case', label: 'Branch by Value', icon: 'GitMerge', category: 'logic', color: '#F59E0B', description: 'Multi-way branch on a value' },
  { type: 'loop', label: 'Loop For Each', icon: 'Repeat', category: 'logic', color: '#F59E0B', description: 'Iterate over a collection' },
  { type: 'loop_n_times', label: 'Loop N Times', icon: 'RotateCw', category: 'logic', color: '#F59E0B', description: 'Repeat N times' },
  { type: 'delay', label: 'Pause for Duration', icon: 'Timer', category: 'logic', color: '#F59E0B', description: 'Wait a fixed amount of time' },
  { type: 'pause_until', label: 'Pause Until Date', icon: 'CalendarClock', category: 'logic', color: '#F59E0B', description: 'Wait until a specific date/time' },
  { type: 'end_workflow', label: 'End Workflow', icon: 'CircleStop', category: 'logic', color: '#EF4444', description: 'Stop execution immediately' },
  // ─── Operations ───
  { type: 'set_title', label: 'Set Title', icon: 'Tag', category: 'operation', color: '#8B5CF6', description: 'Set the title for this workflow instance' },
  { type: 'set_sla', label: 'Set SLA', icon: 'AlarmClock', category: 'operation', color: '#8B5CF6', description: 'Set the SLA deadline and warning threshold for this workflow run' },
  { type: 'set_variable', label: 'Set Variable', icon: 'Variable', category: 'operation', color: '#8B5CF6', description: 'Store a value' },
  { type: 'math', label: 'Calculate Value', icon: 'Calculator', category: 'operation', color: '#8B5CF6', description: 'Math expression' },
  { type: 'modify_string', label: 'Modify String', icon: 'CaseSensitive', category: 'operation', color: '#8B5CF6', description: 'Transform text' },
  { type: 'text_template', label: 'Create Text', icon: 'Type', category: 'operation', color: '#8B5CF6', description: 'Build text from template' },
  { type: 'format_date', label: 'Format Date', icon: 'Calendar', category: 'operation', color: '#8B5CF6', description: 'Format date to string' },
  { type: 'date_math', label: 'Date Math', icon: 'CalendarPlus', category: 'operation', color: '#8B5CF6', description: 'Add time or find interval' },
  { type: 'regex', label: 'Regex', icon: 'Regex', category: 'operation', color: '#8B5CF6', description: 'Apply a regular expression' },
  // ─── Collection Operations ───
  // ─── JSON Operations ───
  { type: 'json_build_object', label: 'Build JSON Object', icon: 'Braces', category: 'operation', color: '#F97316', description: 'Create or update a JSON object from key/value pairs' },
  { type: 'json_build_array', label: 'Build JSON Array', icon: 'Brackets', category: 'operation', color: '#F97316', description: 'Create a new JSON array or push items into an existing one' },
  { type: 'json_add_to_array', label: 'Add to JSON Array', icon: 'ListPlus', category: 'operation', color: '#F97316', description: 'Add an object to an existing JSON array variable' },
  { type: 'json_get_value', label: 'Get JSON Value', icon: 'Search', category: 'operation', color: '#F97316', description: 'Extract a value from a JSON object or array by path' },
  // ─── Collection Operations ───
  { type: 'collection_count', label: 'Count Items', icon: 'Hash', category: 'collection', color: '#06B6D4', description: 'Count items in a list' },
  { type: 'collection_get', label: 'Get Item', icon: 'ListTree', category: 'collection', color: '#06B6D4', description: 'Get item by index or key' },
  { type: 'collection_filter', label: 'Filter Collection', icon: 'Filter', category: 'collection', color: '#06B6D4', description: 'Filter items by condition' },
  { type: 'collection_sort', label: 'Sort Collection', icon: 'ArrowUpDown', category: 'collection', color: '#06B6D4', description: 'Sort items in a list' },
  { type: 'collection_unique', label: 'Remove Duplicates', icon: 'Fingerprint', category: 'collection', color: '#06B6D4', description: 'Deduplicate a list' },
  { type: 'collection_join', label: 'Join to Text', icon: 'Merge', category: 'collection', color: '#06B6D4', description: 'Join list items into a string' },
  // ─── Actions ───
  { type: 'update_task', label: 'Update Task', icon: 'Edit', category: 'action', color: '#3B82F6', description: 'Modify task fields' },
  { type: 'update_data_table', label: 'Data', icon: 'Database', category: 'action', color: '#3B82F6', description: 'Query, insert, update, or delete data store rows' },
  { type: 'retention_policies', label: 'Retention Policies', icon: 'ArchiveRestore', category: 'action', color: '#3B82F6', description: 'Create, assign, and inspect retention policies and their assets' },
  { type: 'call_reference', label: 'Call API / Reference', icon: 'Globe', category: 'action', color: '#3B82F6', description: 'Execute an API reference' },
  { type: 'custom_activity', label: 'Custom Activity', icon: 'Puzzle', category: 'action', color: '#0EA5E9', description: 'Run uploaded custom workflow code with typed inputs and outputs' },
  { type: 'create_subtask', label: 'Create Subtask', icon: 'ListPlus', category: 'action', color: '#3B82F6', description: 'Add a subtask' },
  { type: 'auto_action', label: 'Auto Action', icon: 'Zap', category: 'action', color: '#3B82F6', description: 'Set status, outcome, acceptance' },
  { type: 'http_request', label: 'HTTP Request', icon: 'Send', category: 'action', color: '#3B82F6', description: 'Make HTTP call' },
  { type: 'log', label: 'Log', icon: 'FileText', category: 'action', color: '#3B82F6', description: 'Write audit log' },
  { type: 'send_email', label: 'Send Email', icon: 'Mail', category: 'action', color: '#3B82F6', description: 'Send an email via Resend' },
  // ─── File Operations ───
  { type: 'file_to_base64', label: 'File to Base64', icon: 'FileUp', category: 'operation', color: '#F97316', description: 'Read file from URL/storage → base64' },
  { type: 'base64_to_file', label: 'Base64 to File', icon: 'FileDown', category: 'operation', color: '#F97316', description: 'Save base64 data as file in storage' },
  { type: 'download_file', label: 'Download File', icon: 'Download', category: 'operation', color: '#F97316', description: 'Download from URL to storage' },
  { type: 'read_file', label: 'Read File Content', icon: 'FileText', category: 'operation', color: '#F97316', description: 'Read file content as text' },
  { type: 'read_csv', label: 'CSV', icon: 'FileSpreadsheet', category: 'operation', color: '#F97316', description: 'Read or write CSV files' },
  { type: 'read_excel', label: 'Excel', icon: 'Sheet', category: 'operation', color: '#F97316', description: 'Read or write Excel files' },
  // ─── Document Generation ───
  { type: 'doc_word', label: 'Word Document', icon: 'FileText', category: 'operation', color: '#2B579A', description: 'Find/replace, tables, lists, images in Word docs' },
  { type: 'doc_excel', label: 'Excel Spreadsheet', icon: 'Sheet', category: 'operation', color: '#217346', description: 'Update cells, find/replace, insert data in Excel' },
  { type: 'doc_powerpoint', label: 'PowerPoint Slides', icon: 'Presentation', category: 'operation', color: '#D24726', description: 'Find/replace, tables, lists, images in PowerPoint' },
  // ─── Sub-workflow ───
  { type: 'call_sub_workflow', label: 'Call Sub Workflow', icon: 'GitMerge', category: 'action', color: '#6366F1', description: 'Execute another workflow as a sub-process' },
  { type: 'decision_table', label: 'Decision Table', icon: 'Scale', category: 'action', color: '#0EA5E9', description: 'Evaluate a business rule / decision table and return outputs' },
  // ─── Human-in-the-loop ───
  { type: 'user_task', label: 'User Task', icon: 'Users', category: 'action', color: '#14B8A6', description: 'Assign a task to a person and wait for action' },
  // ─── Navigation & Flow Control ───
  { type: 'goto_activity', label: 'Go To Activity', icon: 'CornerDownRight', category: 'logic', color: '#0EA5E9', description: 'Jump to another activity on the canvas' },
  { type: 'parallel', label: 'Parallel / Sequential', icon: 'GitFork', category: 'logic', color: '#8B5CF6', description: 'Run branches in parallel or sequentially' },
  // ─── Placeholder ───
  { type: 'placeholder', label: 'Placeholder', icon: 'MessageSquareDashed', category: 'action', color: '#9CA3AF', description: 'Empty action — swap out later' },
  // ─── Events ───
  { type: 'server_event', label: 'Server Event', icon: 'Radio', category: 'action', color: '#0EA5E9', description: 'Emit or listen for a server event' },
  // ─── Disabled ───
  { type: 'run_agent', label: 'Run Agent', icon: 'Bot', category: 'action', color: '#8B5CF6', description: 'Execute an AI agent with tools and instructions' },
  { type: 'add_user_to_role', label: 'Add User to Role', icon: 'UserPlus', category: 'action', color: '#3B82F6', description: 'Assign a governance role to a user' },
  { type: 'remove_user_from_role', label: 'Remove from Role', icon: 'UserMinus', category: 'action', color: '#3B82F6', description: 'Remove a governance role from a user' },
  { type: 'check_permission', label: 'Check Permission', icon: 'Shield', category: 'operation', color: '#8B5CF6', description: 'Check if a user has a specific permission' },
  // ─── Tools ───
  { type: 'section_group', label: 'Section', icon: 'FolderOpen', category: 'section', color: '#6366F1', description: 'Group activities into a collapsible section' },
  { type: 'live_reference', label: 'Live Reference', icon: 'RefreshCw', category: 'section', color: '#10B981', description: 'Fetch fresh data on demand when variables are referenced' },
]

export function createDefaultNode(type: NodeType, x: number = 250, y: number = 100): WorkflowNode {
  const catalog = NODE_CATALOG.find(n => n.type === type)
  const config: Record<string, any> = {}
  if (type === 'section_group') {
    config.width = 500
    config.height = 300
    config.color = '#6366F1'
  }
  return {
    id: crypto.randomUUID(),
    type,
    label: catalog?.label ?? type,
    position: { x, y },
    config,
  }
}
