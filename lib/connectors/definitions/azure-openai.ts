import type { ConnectorDefinition } from '../registry'

export const azureOpenaiConnector: ConnectorDefinition = {
  key: 'azure_openai',
  name: 'Azure OpenAI',
  description: 'OpenAI models hosted on Microsoft Azure with enterprise security',
  category: 'ai',
  icon: 'Cloud',
  color: '#0078D4',
  docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
  fields: [
    {
      key: 'resource_name',
      label: 'Resource Name',
      type: 'text',
      placeholder: 'my-openai-resource',
      required: true,
      validation: { type: 'azure_resource_name' },
      helpText: 'Azure OpenAI resource name (from portal.azure.com)',
    },
    {
      key: 'deployment_name',
      label: 'Deployment Name',
      type: 'text',
      placeholder: 'gpt-4o',
      required: true,
      helpText: 'Model deployment name configured in Azure',
    },
    {
      key: 'api_version',
      label: 'API Version',
      type: 'text',
      placeholder: '2024-10-21',
      defaultValue: '2024-10-21',
    },
  ],
  credentialFields: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: '', required: true, helpText: 'Azure OpenAI API Key from portal.azure.com' },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a chat completion via Azure', method: 'POST',
      pathTemplate: '/openai/deployments/{{deployment_name}}/chat/completions?api-version={{api_version}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ messages: [{ role: 'system', content: '{{system_prompt}}' }, { role: 'user', content: '{{user_message}}' }], max_tokens: '{{max_tokens}}', temperature: '{{temperature}}' }),
      inputs: [
        { name: 'deployment_name', type: 'string', required: false, description: 'Deployment name override' },
        { name: 'api_version', type: 'string', required: false, description: 'API version', defaultValue: '2024-10-21' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt' },
        { name: 'user_message', type: 'string', required: true, description: 'User message' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max tokens', defaultValue: '1024' },
        { name: 'temperature', type: 'number', required: false, description: 'Temperature 0-2', defaultValue: '0.7' },
      ],
      outputs: [{ name: 'content', type: 'string' }, { name: 'usage', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (config, credentials) => ({
    base_url: `https://${config.resource_name}.openai.azure.com`,
    auth_type: 'api_key',
    auth_config: { key_name: 'api-key', key_value: credentials.api_key, add_to: 'header' },
  }),
}
