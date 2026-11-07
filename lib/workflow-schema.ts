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
  | 'esign_event'
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
  | 'add_task_attachment'
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
  // Document actions
  | 'doc_read'
  | 'doc_compare'
  | 'doc_convert'
  | 'doc_pdf'
  | 'doc_extract'
  | 'doc_redact'
  | 'doc_inspect'
  // Media (images, audio, video)
  | 'media_transcribe'
  | 'media_analyze_image'
  | 'media_analyze_video'
  | 'media_redact_image'
  | 'media_redact_video'
  | 'media_generate_image'
  | 'media_tts'
  | 'media_tools'
  // E-signature
  | 'esign_send'
  | 'esign_envelope'
  | 'esign_wait'
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
  { type: 'task_received', label: 'Task Received', icon: 'Inbox', category: 'trigger', color: '#22C55E', description: 'When a task is assigned (queued or added)' },
  { type: 'task_submitted', label: 'Task Submitted', icon: 'Send', category: 'trigger', color: '#22C55E', description: 'When a task is accepted' },
  { type: 'task_updated', label: 'Task Updated', icon: 'RefreshCw', category: 'trigger', color: '#22C55E', description: 'When a task is modified' },
  { type: 'task_completed', label: 'Task Completed', icon: 'CheckCircle', category: 'trigger', color: '#22C55E', description: 'When a task is completed' },
  { type: 'task_rejected', label: 'Task Rejected', icon: 'XCircle', category: 'trigger', color: '#EF4444', description: 'When an assignee declines a queued task' },
  { type: 'workflow_error', label: 'Workflow Error', icon: 'AlertTriangle', category: 'trigger', color: '#EF4444', description: 'When any workflow fails with an error' },
  { type: 'workflow_sla', label: 'Workflow SLA', icon: 'Siren', category: 'trigger', color: '#F59E0B', description: 'When a workflow SLA is nearing or breached' },
  { type: 'retention_policy_review', label: 'Policy Review', icon: 'Archive', category: 'trigger', color: '#22C55E', description: 'When a retention policy review becomes due' },
  { type: 'retention_policy_executed', label: 'Policy Executed', icon: 'ArchiveRestore', category: 'trigger', color: '#22C55E', description: 'When a retention policy action such as purge is executed' },
  { type: 'form_submitted', label: 'Form Submitted', icon: 'ClipboardCheck', category: 'trigger', color: '#22C55E', description: 'When a reusable form is submitted (its own page, the API or as a task form)' },
  { type: 'data_table_event', label: 'Data Table Event', icon: 'Database', category: 'trigger', color: '#22C55E', description: 'When a data table row is created, updated, or deleted' },
  { type: 'middleware_received', label: 'Middleware', icon: 'Globe', category: 'trigger', color: '#22C55E', description: 'Receive a webhook and return a workflow response synchronously' },
  { type: 'schedule', label: 'Schedule', icon: 'Clock', category: 'trigger', color: '#22C55E', description: 'Run on a schedule' },
  { type: 'webhook_received', label: 'Webhook', icon: 'Globe', category: 'trigger', color: '#22C55E', description: 'Triggered by an incoming webhook' },
  { type: 'esign_event', label: 'E-signature Event', icon: 'Signature', category: 'trigger', color: '#22C55E', description: 'When an envelope is completed, signed by a recipient, declined, voided or expires (DocuSign, Adobe Acrobat Sign, Dropbox Sign …)' },
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
  { type: 'custom_activity', label: 'Custom Action', icon: 'Puzzle', category: 'action', color: '#0EA5E9', description: 'Run a custom workflow action (sandboxed code with typed inputs and outputs) from Extensibility' },
  { type: 'create_subtask', label: 'Create Subtask', icon: 'ListPlus', category: 'action', color: '#3B82F6', description: 'Add a subtask' },
  { type: 'add_task_attachment', label: 'Add Task Attachment', icon: 'FileUp', category: 'action', color: '#3B82F6', description: "Attach a generated or downloaded file to a task's Attachments tab" },
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
  // ─── Document actions ───
  { type: 'doc_read', label: 'Read Document', icon: 'FileSearch', category: 'operation', color: '#0F766E', description: 'Read Word, Excel, PowerPoint, PDF and more into text, rows and structure' },
  { type: 'doc_compare', label: 'Compare Documents', icon: 'GitCompare', category: 'operation', color: '#0F766E', description: 'Diff two documents, sheets or JSON: changes, similarity, report and redline' },
  { type: 'doc_convert', label: 'Convert Document', icon: 'FileOutput', category: 'operation', color: '#0F766E', description: 'Convert between PDF, Word, HTML, Markdown, text, CSV, Excel and JSON' },
  { type: 'doc_pdf', label: 'PDF Tools', icon: 'FileStack', category: 'operation', color: '#B91C1C', description: 'Merge, split, extract pages, watermark, rotate, fill or read PDF forms' },
  { type: 'doc_extract', label: 'Extract from Document', icon: 'ScanText', category: 'operation', color: '#0F766E', description: 'Tables, key values, emails, dates and amounts — optionally into a data table' },
  { type: 'doc_redact', label: 'Redact Document', icon: 'EyeOff', category: 'operation', color: '#0F766E', description: 'Find or remove sensitive information (IDs, dates of birth, card and bank numbers…) and custom terms' },
  { type: 'doc_inspect', label: 'Inspect Document', icon: 'FileScan', category: 'operation', color: '#0F766E', description: 'File type, checksum, word counts and search with context' },
  // ─── Media (images, audio, video) ───
  { type: 'media_transcribe', label: 'Transcribe Audio / Video', icon: 'Captions', category: 'operation', color: '#C026D3', description: 'Speech to text with timestamps, speakers and SRT / VTT files (your AI provider)' },
  { type: 'media_analyze_image', label: 'Analyze Image', icon: 'ScanEye', category: 'operation', color: '#C026D3', description: 'Describe, label, read text, find faces and check safety in an image' },
  { type: 'media_analyze_video', label: 'Analyze Video', icon: 'Film', category: 'operation', color: '#C026D3', description: 'Summary, scenes with timestamps, labels, on-screen text and key frames' },
  { type: 'media_redact_image', label: 'Redact Image', icon: 'ScanFace', category: 'operation', color: '#C026D3', description: 'Blur, pixelate or box faces, license plates and sensitive text in an image' },
  { type: 'media_redact_video', label: 'Redact Video', icon: 'VideoOff', category: 'operation', color: '#C026D3', description: 'Blur faces, plates and text over time; bleep or mute sensitive speech' },
  { type: 'media_generate_image', label: 'Generate / Edit Image', icon: 'ImagePlus', category: 'operation', color: '#C026D3', description: 'Create an image from a prompt, or edit one with a mask' },
  { type: 'media_tts', label: 'Text to Speech', icon: 'AudioLines', category: 'operation', color: '#C026D3', description: 'Turn text into an audio file in a chosen voice' },
  { type: 'media_tools', label: 'Media Utilities', icon: 'Clapperboard', category: 'operation', color: '#C026D3', description: 'Media info, extract audio or frames, thumbnail, trim, convert, compress, burn in subtitles' },
  // ─── E-signature ───
  { type: 'esign_send', label: 'Send for Signature', icon: 'FileSignature', category: 'action', color: '#7C3AED', description: 'Send documents or a provider template for e-signature (DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, SignNow, BoldSign)' },
  { type: 'esign_wait', label: 'Wait for Signature', icon: 'Hourglass', category: 'action', color: '#7C3AED', description: 'Pause until the envelope is completed, declined, voided or expires; store the signed PDF' },
  { type: 'esign_envelope', label: 'E-signature Envelope', icon: 'FileCheck', category: 'action', color: '#7C3AED', description: 'Envelope status, download signed document / certificate, void, embedded signing URL, list templates' },
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

// ─── Node colour category (design system, docs/design/ui-polish-spec.md §5.5) ───
// The catalog's `color` stays as the legacy fallback (MCP descriptions, tests,
// stored `node_color` overrides). Cards, palette and minimap take their colour
// from the node's colour category instead, which resolves to a theme token so
// every workspace theme (light and dark) recolours the canvas.

/** Colour category of a step: what kind of work it does, not where it sits in the palette. */
export type NodeColorCategory = 'trigger' | 'action' | 'logic' | 'human' | 'ai' | 'data' | 'end'

export const NODE_COLOR_CATEGORIES: readonly NodeColorCategory[] = ['trigger', 'action', 'logic', 'human', 'ai', 'data', 'end']

/**
 * Theme chart slot behind each category (`--theme-chart-N`, from the theme's
 * chart palette). The six spec categories take slots 1–6; `data` (value,
 * collection, file and document operations) takes slot 7.
 */
export const NODE_COLOR_CHART_SLOT: Record<NodeColorCategory, number> = {
  human: 1, trigger: 2, action: 3, end: 4, logic: 5, ai: 6, data: 7,
}

const HUMAN_TYPES = new Set<string>(['user_task', 'esign_send', 'esign_wait', 'esign_envelope'])
const LOGIC_ACTION_TYPES = new Set<string>(['decision_table'])

/** The colour category of a node type (unknown types read as actions). */
export function nodeColorCategory(type: string): NodeColorCategory {
  if (type === 'end_workflow') return 'end'
  if (HUMAN_TYPES.has(type)) return 'human'
  if (type === 'run_agent' || type.startsWith('media_')) return 'ai'
  if (LOGIC_ACTION_TYPES.has(type)) return 'logic'
  const category = NODE_CATALOG.find((n) => n.type === type)?.category
  switch (category) {
    case 'trigger': return 'trigger'
    case 'logic': return 'logic'
    case 'operation':
    case 'collection': return 'data'
    case 'section': return type === 'section_group' ? 'logic' : 'data'
    default: return 'action'
  }
}

/** CSS colour of a category: `--ds-node-<category>`, falling back to its theme chart slot. */
export function nodeColorVar(category: NodeColorCategory): string {
  return `var(--ds-node-${category}, var(--theme-chart-${NODE_COLOR_CHART_SLOT[category]}))`
}

/** Text-legible variant of a category's colour (AA on the card background). */
export function nodeColorTextVar(category: NodeColorCategory): string {
  return `var(--ds-node-${category}-text, var(--theme-chart-${NODE_COLOR_CHART_SLOT[category]}-text))`
}

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
