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
  inputSchema?: { name: string; type: string; description: string; required?: boolean }[]
  outputMapping?: Record<string, string>
}

export type BuiltinToolCategory = 'core' | 'data' | 'workflow' | 'documents' | 'http' | 'files' | 'multi_agent'

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
    id: 'builtin_gen_word', type: 'builtin', name: 'generate_word_document', category: 'documents',
    description: 'Generate a Word document from a template with find/replace placeholders.',
    inputSchema: [
      { name: 'template_url', type: 'string', description: 'URL of the Word template (.docx)', required: true },
      { name: 'replacements', type: 'object', description: 'JSON object of placeholder→value pairs', required: true },
    ],
  },
  {
    id: 'builtin_gen_excel', type: 'builtin', name: 'generate_excel', category: 'documents',
    description: 'Generate an Excel spreadsheet from data rows.',
    inputSchema: [
      { name: 'sheet_name', type: 'string', description: 'Sheet name (default "Sheet1")' },
      { name: 'headers', type: 'array', description: 'Array of column header names', required: true },
      { name: 'rows', type: 'array', description: 'Array of arrays (each inner array is a row)', required: true },
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
    id: 'builtin_read_file', type: 'builtin', name: 'read_file_content', category: 'files',
    description: 'Read the text content of a file from storage.',
    inputSchema: [
      { name: 'file_path', type: 'string', description: 'Path or URL to the file', required: true },
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
