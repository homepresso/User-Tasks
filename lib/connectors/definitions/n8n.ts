import type { ConnectorDefinition } from '../registry'

export const n8nConnector: ConnectorDefinition = {
  key: 'n8n',
  name: 'n8n',
  description: 'Manage n8n workflows and executions through the n8n public API (trigger workflows through their webhook URL with the HTTP/webhook integration, not this API key)',
  category: 'productivity',
  icon: 'Workflow',
  color: '#FF6D5A',
  docsUrl: 'https://docs.n8n.io/api/',
  recommendedPermissions: {
    title: 'Recommended n8n Setup',
    items: ['API access enabled in the workspace', 'API key created for the correct environment', 'Workflow and execution permissions for the account behind the API key'],
    note: 'Use the base instance URL, not a webhook path. The public API has no "run now" call — to start a workflow, call its Webhook node URL from a separate webhook integration so the API key is never sent to workflow webhooks.',
  },
  fields: [
    {
      key: 'base_url',
      label: 'n8n Instance URL',
      type: 'text',
      placeholder: 'https://your-n8n.example.com',
      required: true,
      validation: { type: 'url' },
      helpText: 'Your n8n instance URL (self-hosted or n8n.cloud)',
      exampleText: 'https://automation.yourcompany.com',
    },
  ],
  credentialFields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText: 'API key from n8n Settings > API > Create API Key',
      setupHint: 'Create this in your n8n workspace settings, then test with the base instance URL rather than a webhook URL.',
    },
  ],
  referenceTemplates: [
    // ─── Workflows ───
    {
      key: 'list_workflows',
      name: 'List Workflows',
      description: 'List all workflows with their status',
      method: 'GET',
      pathTemplate: '/api/v1/workflows?limit={{limit}}&cursor={{cursor}}&active={{active}}',
      inputs: [
        { name: 'limit', type: 'number', required: false, description: 'Max results', defaultValue: '50' },
        { name: 'cursor', type: 'string', required: false, description: 'Pagination cursor from previous response' },
        { name: 'active', type: 'string', required: false, description: 'Filter by active status (true/false)' },
      ],
      outputs: [{ name: 'data', type: 'array' }, { name: 'nextCursor', type: 'string' }],
    },
    {
      key: 'get_workflow',
      name: 'Get Workflow',
      description: 'Get a workflow by ID with full node/connection details',
      method: 'GET',
      pathTemplate: '/api/v1/workflows/{{workflow_id}}',
      inputs: [
        { name: 'workflow_id', type: 'string', required: true, description: 'Workflow ID' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'active', type: 'boolean' }, { name: 'nodes', type: 'array' }],
    },
    {
      key: 'activate_workflow',
      name: 'Activate Workflow',
      description: 'Activate (publish) a workflow so it responds to triggers',
      method: 'POST',
      pathTemplate: '/api/v1/workflows/{{workflow_id}}/activate',
      inputs: [
        { name: 'workflow_id', type: 'string', required: true, description: 'Workflow ID' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'active', type: 'boolean' }],
    },
    {
      key: 'deactivate_workflow',
      name: 'Deactivate Workflow',
      description: 'Deactivate a workflow',
      method: 'POST',
      pathTemplate: '/api/v1/workflows/{{workflow_id}}/deactivate',
      inputs: [
        { name: 'workflow_id', type: 'string', required: true, description: 'Workflow ID' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'active', type: 'boolean' }],
    },
    // ─── Executions ───
    {
      key: 'get_execution',
      name: 'Get Execution',
      description: 'Get details and result of a workflow execution',
      method: 'GET',
      pathTemplate: '/api/v1/executions/{{execution_id}}?includeData={{include_data}}',
      inputs: [
        { name: 'execution_id', type: 'string', required: true, description: 'Execution ID' },
        { name: 'include_data', type: 'string', required: false, description: 'true to include the execution data', defaultValue: 'false' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'finished', type: 'boolean' }, { name: 'status', type: 'string' }, { name: 'data', type: 'object' }],
    },
    {
      key: 'list_executions',
      name: 'List Executions',
      description: 'List workflow executions with filtering',
      method: 'GET',
      pathTemplate: '/api/v1/executions?workflowId={{workflow_id}}&status={{status}}&limit={{limit}}&cursor={{cursor}}',
      inputs: [
        { name: 'workflow_id', type: 'string', required: false, description: 'Filter by workflow ID' },
        { name: 'status', type: 'string', required: false, description: 'Filter: success, error, waiting' },
        { name: 'limit', type: 'number', required: false, description: 'Max results', defaultValue: '20' },
        { name: 'cursor', type: 'string', required: false, description: 'Pagination cursor' },
      ],
      outputs: [{ name: 'data', type: 'array' }, { name: 'nextCursor', type: 'string' }],
    },
    {
      key: 'delete_execution',
      name: 'Delete Execution',
      description: 'Delete an execution record',
      method: 'DELETE',
      pathTemplate: '/api/v1/executions/{{execution_id}}',
      inputs: [
        { name: 'execution_id', type: 'string', required: true, description: 'Execution ID' },
      ],
      outputs: [{ name: 'status', type: 'number' }],
    },
    {
      key: 'retry_execution',
      name: 'Retry Execution',
      description: 'Retry a failed execution',
      method: 'POST',
      pathTemplate: '/api/v1/executions/{{execution_id}}/retry',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"loadWorkflow":{{load_workflow}}}',
      inputs: [
        { name: 'execution_id', type: 'string', required: true, description: 'Execution ID' },
        { name: 'load_workflow', type: 'boolean', required: false, description: 'true = retry with the current workflow version' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'status', type: 'string' }],
    },
    // ─── Credentials ───
    {
      key: 'list_credentials',
      name: 'List Credentials',
      description: 'List stored credentials in n8n (metadata only, no secrets)',
      method: 'GET',
      pathTemplate: '/api/v1/credentials?limit={{limit}}&cursor={{cursor}}',
      inputs: [
        { name: 'limit', type: 'number', required: false, description: 'Max results', defaultValue: '50' },
        { name: 'cursor', type: 'string', required: false, description: 'nextCursor from the previous page' },
      ],
      outputs: [{ name: 'data', type: 'array' }, { name: 'nextCursor', type: 'string' }],
    },
  ],
  buildIntegrationConfig: (config, credentials) => ({
    base_url: config.base_url || '',
    auth_type: 'api_key',
    auth_config: {
      key_name: 'X-N8N-API-KEY',
      key_value: credentials.api_key,
      add_to: 'header',
    },
  }),
}
