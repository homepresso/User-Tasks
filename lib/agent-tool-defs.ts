/**
 * Agent tool shape and the built-in tool catalogue. Kept apart from
 * lib/agent-executor (which loads server-only modules such as the MCP client)
 * so the agent designer can import it without pulling those into the browser.
 */

export interface AgentTool {
  id: string
  type: 'reference' | 'workflow' | 'builtin' | 'mcp'
  name: string
  description: string
  referenceId?: string
  workflowId?: string
  mcpServerId?: string
  mcpToolName?: string
  inputSchema?: { name: string; type: string; description: string; required?: boolean; items?: Record<string, unknown> }[]
  outputMapping?: Record<string, string>
  /** This tool call waits for a person's approval (a task) before it runs. */
  requiresApproval?: boolean
}

/**
 * Built-in tools that only read (never change data or reach the outside
 * world). They never need approval and run for real in evaluations; every
 * other tool is "side-effecting".
 */
export const READ_ONLY_BUILTIN_TOOLS = new Set([
  'calculate', 'current_datetime', 'read_shared_facts', 'query_data_table', 'get_task_status',
  'get_workflow_run_status', 'read_attached_file', 'search_knowledge', 'read_knowledge_document',
])

export type BuiltinToolCategory = 'core' | 'data' | 'workflow' | 'documents' | 'http' | 'files' | 'knowledge' | 'media' | 'multi_agent'

export const BUILTIN_TOOL_DEFS: (AgentTool & { category: BuiltinToolCategory })[] = [
  // Core
  {
    id: 'builtin_calculate', type: 'builtin', name: 'calculate', category: 'core',
    description: 'Evaluate a mathematical expression. Returns the numeric result.',
    inputSchema: [{ name: 'expression', type: 'string', description: 'Math expression e.g. "2 + 3 * 4"', required: true }],
  },
  {
    id: 'builtin_datetime', type: 'builtin', name: 'current_datetime', category: 'core',
    description: 'Get the current date and time in ISO format.',
    inputSchema: [],
  },

  // Data
  {
    id: 'builtin_query_data', type: 'builtin', name: 'query_data_table', category: 'data',
    description: 'Query rows from a data table. Returns matching rows as JSON array.',
    inputSchema: [
      { name: 'table_name', type: 'string', description: 'Name of the data table to query', required: true },
      { name: 'filter_column', type: 'string', description: 'Column name to filter on (optional)' },
      { name: 'filter_value', type: 'string', description: 'Value to filter for (optional)' },
      { name: 'limit', type: 'number', description: 'Max rows to return (default 50)' },
    ],
  },
  {
    id: 'builtin_insert_data', type: 'builtin', name: 'insert_data_row', category: 'data',
    description: 'Insert a new row into a data table.',
    inputSchema: [
      { name: 'table_name', type: 'string', description: 'Name of the data table', required: true },
      { name: 'data', type: 'object', description: 'JSON object with column values', required: true },
    ],
  },
  {
    id: 'builtin_insert_data_many', type: 'builtin', name: 'insert_data_rows', category: 'data',
    description: 'Insert several rows into a data table in one call (at most 100).',
    inputSchema: [
      { name: 'table_name', type: 'string', description: 'Name of the data table', required: true },
      { name: 'rows', type: 'array', description: 'Array of JSON objects with column values, one per new row', required: true },
    ],
  },
  {
    id: 'builtin_update_data', type: 'builtin', name: 'update_data_rows', category: 'data',
    description: 'Update rows in a data table matching a filter.',
    inputSchema: [
      { name: 'table_name', type: 'string', description: 'Name of the data table', required: true },
      { name: 'filter_column', type: 'string', description: 'Column to match', required: true },
      { name: 'filter_value', type: 'string', description: 'Value to match', required: true },
      { name: 'updates', type: 'object', description: 'JSON object with column updates', required: true },
    ],
  },
  {
    id: 'builtin_delete_data', type: 'builtin', name: 'delete_data_rows', category: 'data',
    description: 'Delete rows in a data table matching a filter (at most 100 per call).',
    inputSchema: [
      { name: 'table_name', type: 'string', description: 'Name of the data table', required: true },
      { name: 'filter_column', type: 'string', description: 'Column to match', required: true },
      { name: 'filter_value', type: 'string', description: 'Value to match', required: true },
    ],
  },
  {
    id: 'builtin_get_task_status', type: 'builtin', name: 'get_task_status', category: 'workflow',
    description: 'Get the current status and summary details for a task.',
    inputSchema: [
      { name: 'task_id', type: 'string', description: 'Task id to inspect', required: true },
    ],
  },
  {
    id: 'builtin_respond_to_task', type: 'builtin', name: 'respond_to_task', category: 'workflow',
    description: 'Accept, hold, or reject a task in the queue.',
    inputSchema: [
      { name: 'task_id', type: 'string', description: 'Task id to respond to', required: true },
      { name: 'response', type: 'string', description: 'accepted, held, or rejected', required: true },
      { name: 'comment', type: 'string', description: 'Optional response comment' },
    ],
  },
  {
    id: 'builtin_complete_task', type: 'builtin', name: 'complete_task', category: 'workflow',
    description: 'Complete a non-workflow task with an outcome.',
    inputSchema: [
      { name: 'task_id', type: 'string', description: 'Task id to complete', required: true },
      { name: 'outcome', type: 'string', description: 'Outcome value such as completed, approved, or rejected' },
      { name: 'outcome_notes', type: 'string', description: 'Optional notes about the outcome' },
    ],
  },
  {
    id: 'builtin_complete_workflow_task', type: 'builtin', name: 'complete_workflow_task', category: 'workflow',
    description: 'Complete a workflow task and resume the underlying paused workflow event.',
    inputSchema: [
      { name: 'task_id', type: 'string', description: 'Workflow task id to complete', required: true },
      { name: 'outcome', type: 'string', description: 'Outcome value such as approved, rejected, or completed', required: true },
      { name: 'notes', type: 'string', description: 'Optional notes about the outcome' },
    ],
  },
  {
    id: 'builtin_escalate_task', type: 'builtin', name: 'escalate_task', category: 'workflow',
    description: 'Escalate a task to another user.',
    inputSchema: [
      { name: 'task_id', type: 'string', description: 'Task id to escalate', required: true },
      { name: 'escalate_to', type: 'string', description: 'User id to escalate the task to', required: true },
      { name: 'reason', type: 'string', description: 'Optional escalation reason' },
    ],
  },
  {
    id: 'builtin_redirect_task', type: 'builtin', name: 'redirect_task', category: 'workflow',
    description: 'Redirect a task to another user.',
    inputSchema: [
      { name: 'task_id', type: 'string', description: 'Task id to redirect', required: true },
      { name: 'redirect_to', type: 'string', description: 'User id to redirect the task to', required: true },
      { name: 'reason', type: 'string', description: 'Optional redirect reason' },
    ],
  },
  {
    id: 'builtin_start_workflow_run', type: 'builtin', name: 'start_workflow_run', category: 'workflow',
    description: 'Start a workflow and return the run identifier and current status.',
    inputSchema: [
      { name: 'workflow_id', type: 'string', description: 'Workflow id to start', required: true },
      { name: 'variables', type: 'object', description: 'Optional workflow input variables' },
      { name: 'async', type: 'boolean', description: 'Run asynchronously when true' },
    ],
  },
  {
    id: 'builtin_get_workflow_run_status', type: 'builtin', name: 'get_workflow_run_status', category: 'workflow',
    description: 'Get the current status and timing details for a workflow run.',
    inputSchema: [
      { name: 'run_id', type: 'string', description: 'Workflow run id to inspect', required: true },
    ],
  },
  {
    id: 'builtin_complete_server_event', type: 'builtin', name: 'complete_server_event', category: 'workflow',
    description: 'Complete a waiting server event and resume the paused workflow with return variables.',
    inputSchema: [
      { name: 'event_id', type: 'string', description: 'Server event id to complete', required: true },
      { name: 'variables', type: 'object', description: 'Variables to return back into the waiting workflow' },
    ],
  },

  // Documents
  {
    id: 'builtin_gen_excel', type: 'builtin', name: 'generate_excel', category: 'documents',
    description: 'Generate an Excel workbook from data rows. Returns the stored file (name, url) — it is also listed in the run\'s generated files.',
    inputSchema: [
      { name: 'sheet_name', type: 'string', description: 'Sheet name (default "Sheet1")' },
      { name: 'headers', type: 'array', description: 'Array of column header names', required: true, items: { type: 'string' } },
      { name: 'rows', type: 'array', description: 'Array of arrays (each inner array is a row)', required: true, items: { type: 'array', items: { type: 'string' } } },
      { name: 'file_name', type: 'string', description: 'File name for the workbook (default "export.xlsx")' },
    ],
  },
  {
    id: 'builtin_read_csv', type: 'builtin', name: 'read_csv_file', category: 'documents',
    description: 'Read and parse a CSV file. Returns rows as JSON array.',
    inputSchema: [
      { name: 'file_url', type: 'string', description: 'URL of the CSV file', required: true },
      { name: 'delimiter', type: 'string', description: 'Column delimiter (default ",")' },
    ],
  },

  // HTTP
  {
    id: 'builtin_http_get', type: 'builtin', name: 'http_get', category: 'http',
    description: 'Make an HTTP GET request and return the response.',
    inputSchema: [
      { name: 'url', type: 'string', description: 'Full URL to request', required: true },
      { name: 'headers', type: 'object', description: 'Optional request headers as JSON' },
    ],
  },
  {
    id: 'builtin_http_post', type: 'builtin', name: 'http_post', category: 'http',
    description: 'Make an HTTP POST request with a JSON body.',
    inputSchema: [
      { name: 'url', type: 'string', description: 'Full URL to request', required: true },
      { name: 'body', type: 'object', description: 'Request body as JSON', required: true },
      { name: 'headers', type: 'object', description: 'Optional request headers as JSON' },
    ],
  },

  // Files
  {
    id: 'builtin_download_file', type: 'builtin', name: 'download_file', category: 'files',
    description: 'Download a file from a URL and return its content or metadata.',
    inputSchema: [
      { name: 'url', type: 'string', description: 'URL of the file to download', required: true },
    ],
  },
  {
    id: 'builtin_read_attached_file', type: 'builtin', name: 'read_attached_file', category: 'files',
    description: 'Read a file given to this agent step (its "Files", e.g. a form\'s attachments) as text: PDF, Word, Excel, PowerPoint, text, CSV, JSON. Pass its file id (or name).',
    inputSchema: [
      { name: 'file_id', type: 'string', description: 'The file id (or the file name)', required: true },
    ],
  },
  {
    id: 'builtin_read_file', type: 'builtin', name: 'read_file_content', category: 'files',
    description: 'Read the text content of a file from storage.',
    inputSchema: [
      { name: 'file_path', type: 'string', description: 'Path or URL to the file', required: true },
    ],
  },

  // Media (the workspace's AI media provider; output_config.media_access)
  {
    id: 'builtin_transcribe_media', type: 'builtin', name: 'transcribe_media', category: 'media',
    description: 'Transcribe an audio or video file to text with timestamps (and speakers when the provider supports it). Pass the id (or name) of a file given to this agent step, or a public URL. The file is sent to the workspace\'s AI media provider.',
    inputSchema: [
      { name: 'file_id', type: 'string', description: 'The file id (or name) of a file given to this step' },
      { name: 'url', type: 'string', description: 'Or: a public http(s) URL of the media' },
      { name: 'language', type: 'string', description: 'Language code (e.g. en); empty = detect' },
      { name: 'diarize', type: 'boolean', description: 'Label speakers (where supported)' },
    ],
  },
  {
    id: 'builtin_analyze_image', type: 'builtin', name: 'analyze_image', category: 'media',
    description: 'Analyze an image: description, labels, the text in it (OCR), face count (never identity), safety flags, or the answer to a question. Pass the id (or name) of a file given to this agent step, or a public URL. The image is sent to the workspace\'s AI media provider.',
    inputSchema: [
      { name: 'file_id', type: 'string', description: 'The file id (or name) of an image given to this step' },
      { name: 'url', type: 'string', description: 'Or: a public http(s) URL of the image' },
      { name: 'prompt', type: 'string', description: 'A question about the image (optional)' },
      { name: 'features', type: 'array', description: 'Any of description, labels, objects, text, faces, safety (default description, labels, text)', items: { type: 'string' } },
    ],
  },

  // Knowledge
  {
    id: 'builtin_search_knowledge', type: 'builtin', name: 'search_knowledge', category: 'knowledge',
    description: 'Search this agent\'s knowledge sources (attached documents and data tables) by keywords. Returns the most relevant passages with their source. Use it before answering questions the sources may cover.',
    inputSchema: [
      { name: 'query', type: 'string', description: 'What to look for (keywords or a question)', required: true },
      { name: 'limit', type: 'number', description: 'Max passages to return (default 5, max 20)' },
    ],
  },
  {
    id: 'builtin_read_knowledge_document', type: 'builtin', name: 'read_knowledge_document', category: 'knowledge',
    description: 'Read the full text of one of this agent\'s knowledge documents by name (as returned by search_knowledge).',
    inputSchema: [
      { name: 'name', type: 'string', description: 'The document name', required: true },
    ],
  },

  // Multi-agent
  {
    id: 'builtin_read_facts', type: 'builtin', name: 'read_shared_facts', category: 'multi_agent',
    description: 'Read all shared facts from the multi-agent context.',
    inputSchema: [],
  },
  {
    id: 'builtin_write_fact', type: 'builtin', name: 'write_shared_fact', category: 'multi_agent',
    description: 'Write a fact to the shared context visible to all agents.',
    inputSchema: [
      { name: 'key', type: 'string', description: 'Fact key', required: true },
      { name: 'value', type: 'string', description: 'Fact value', required: true },
    ],
  },
]
