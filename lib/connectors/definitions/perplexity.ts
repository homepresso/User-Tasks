import type { ConnectorDefinition } from '../registry'

export const perplexityConnector: ConnectorDefinition = {
  key: 'perplexity',
  name: 'Perplexity AI',
  description: 'AI search and chat with real-time web access and citations',
  category: 'ai',
  icon: 'Search',
  color: '#20808D',
  docsUrl: 'https://docs.perplexity.ai/',
  fields: [
    {
      key: 'default_model',
      label: 'Default Model',
      type: 'select',
      options: [
        { value: 'sonar-pro', label: 'Sonar Pro (search + reasoning)' },
        { value: 'sonar', label: 'Sonar (search)' },
        { value: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro' },
        { value: 'sonar-reasoning', label: 'Sonar Reasoning' },
      ],
      defaultValue: 'sonar-pro',
    },
  ],
  credentialFields: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'pplx-...', required: true, helpText: 'Perplexity API Key from perplexity.ai/settings/api' },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a response with web search', method: 'POST', pathTemplate: '/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ model: '{{model}}', messages: [{ role: 'system', content: '{{system_prompt}}' }, { role: 'user', content: '{{user_message}}' }], max_tokens: '{{max_tokens}}', temperature: '{{temperature}}' }),
      inputs: [
        { name: 'model', type: 'string', required: false, description: 'Model name', defaultValue: 'sonar-pro' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt' },
        { name: 'user_message', type: 'string', required: true, description: 'User message' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max tokens', defaultValue: '1024' },
        { name: 'temperature', type: 'number', required: false, description: 'Temperature 0-2', defaultValue: '0.2' },
      ],
      outputs: [{ name: 'content', type: 'string' }, { name: 'citations', type: 'array' }, { name: 'usage', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://api.perplexity.ai',
    auth_type: 'bearer',
    auth_config: { token: credentials.api_key },
  }),
}
