import type { ConnectorDefinition } from '../registry'

export const n8nConnector: ConnectorDefinition = {
  key: 'n8n',
  name: 'n8n',
  description: 'Trigger workflows, manage executions, and orchestrate automations in n8n',
  category: 'productivity',
  icon: 'Workflow',
  color: '#FF6D5A',
  docsUrl: 'https://docs.n8n.io/api/',
  recommendedPermissions: {
    title: 'Recommended n8n Setup',
    items: ['API access enabled in the workspace', 'API key created for the correct environment', 'Workflow and execution permissions for the account behind the API key'],
    note: 'Use the base instance URL for testing, not a webhook path.',
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
      description: 'Activate a workflow so it responds to triggers',
      method: 'PATCH',
      pathTemplate: '/api/v1/workflows/{{workflow_id}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ active: true }),
      inputs: [
        { name: 'workflow_id', type: 'string', required: true, description: 'Workflow ID' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'active', type: 'boolean' }],
    },
    {
      key: 'deactivate_workflow',
      name: 'Deactivate Workflow',
      description: 'Deactivate a workflow',
      method: 'PATCH',
      pathTemplate: '/api/v1/workflows/{{workflow_id}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ active: false }),
      inputs: [
        { name: 'workflow_id', type: 'string', required: true, description: 'Workflow ID' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'active', type: 'boolean' }],
    },
    // ─── Executions ───
    {
      key: 'execute_workflow',
      name: 'Execute Workflow',
      description: 'Trigger a workflow execution with optional input data',
      method: 'POST',
      pathTemplate: '/api/v1/executions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ workflowId: '{{workflow_id}}', data: '{{input_data}}' }),
      inputs: [
        { name: 'workflow_id', type: 'string', required: true, description: 'Workflow ID to execute' },
        { name: 'input_data', type: 'string', required: false, description: 'JSON input data to pass to the workflow' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'finished', type: 'boolean' }, { name: 'data', type: 'object' }],
    },
    {
      key: 'get_execution',
      name: 'Get Execution',
      description: 'Get details and result of a workflow execution',
      method: 'GET',
      pathTemplate: '/api/v1/executions/{{execution_id}}',
      inputs: [
        { name: 'execution_id', type: 'string', required: true, description: 'Execution ID' },
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
    // ─── Webhook Trigger ───
    {
      key: 'trigger_webhook',
      name: 'Trigger Webhook Workflow',
      description: 'Trigger a workflow via its webhook URL with a JSON payload',
      method: 'POST',
      pathTemplate: '/webhook/{{webhook_path}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{{payload}}',
      inputs: [
        { name: 'webhook_path', type: 'string', required: true, description: 'Webhook path (from the Webhook trigger node in n8n)' },
        { name: 'payload', type: 'string', required: false, description: 'JSON payload to send', defaultValue: '{}' },
      ],
      outputs: [{ name: 'status', type: 'number' }, { name: 'body', type: 'string' }],
    },
    // ─── Credentials ───
    {
      key: 'list_credentials',
      name: 'List Credentials',
      description: 'List stored credentials in n8n (metadata only, no secrets)',
      method: 'GET',
      pathTemplate: '/api/v1/credentials?limit={{limit}}',
      inputs: [
        { name: 'limit', type: 'number', required: false, description: 'Max results', defaultValue: '50' },
      ],
      outputs: [{ name: 'data', type: 'array' }],
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
