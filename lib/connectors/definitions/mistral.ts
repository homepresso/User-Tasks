import type { ConnectorDefinition } from '../registry'

export const mistralConnector: ConnectorDefinition = {
  key: 'mistral',
  name: 'Mistral AI',
  description: 'European AI models — Mistral Large, Medium, Small, and Codestral',
  category: 'ai',
  icon: 'Sparkles',
  color: '#FF7000',
  docsUrl: 'https://docs.mistral.ai/',
  fields: [
    {
      key: 'default_model',
      label: 'Default Model',
      type: 'select',
      options: [
        { value: 'mistral-large-latest', label: 'Mistral Large' },
        { value: 'mistral-medium-latest', label: 'Mistral Medium' },
        { value: 'mistral-small-latest', label: 'Mistral Small' },
        { value: 'codestral-latest', label: 'Codestral' },
        { value: 'open-mistral-nemo', label: 'Mistral Nemo' },
      ],
      defaultValue: 'mistral-large-latest',
    },
  ],
  credentialFields: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: '', required: true, helpText: 'Mistral API Key from console.mistral.ai' },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a chat completion', method: 'POST', pathTemplate: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ model: '{{model}}', messages: [{ role: 'system', content: '{{system_prompt}}' }, { role: 'user', content: '{{user_message}}' }], max_tokens: '{{max_tokens}}', temperature: '{{temperature}}' }),
      inputs: [
        { name: 'model', type: 'string', required: false, description: 'Model name', defaultValue: 'mistral-large-latest' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt' },
        { name: 'user_message', type: 'string', required: true, description: 'User message' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max tokens', defaultValue: '1024' },
        { name: 'temperature', type: 'number', required: false, description: 'Temperature 0-1', defaultValue: '0.7' },
      ],
      outputs: [{ name: 'content', type: 'string' }, { name: 'usage', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://api.mistral.ai',
    auth_type: 'bearer',
    auth_config: { token: credentials.api_key },
  }),
}
