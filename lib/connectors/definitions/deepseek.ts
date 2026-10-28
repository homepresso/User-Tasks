import type { ConnectorDefinition } from '../registry'

export const deepseekConnector: ConnectorDefinition = {
  key: 'deepseek',
  name: 'DeepSeek',
  description: 'Advanced reasoning and coding models from DeepSeek',
  category: 'ai',
  icon: 'Sparkles',
  color: '#4D6BFE',
  docsUrl: 'https://platform.deepseek.com/api-docs',
  fields: [
    {
      key: 'default_model',
      label: 'Default Model',
      type: 'select',
      options: [
        { value: 'deepseek-chat', label: 'DeepSeek Chat (V3)' },
        { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' },
      ],
      defaultValue: 'deepseek-chat',
    },
  ],
  credentialFields: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'sk-...', required: true, helpText: 'DeepSeek API Key from platform.deepseek.com' },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a chat completion', method: 'POST', pathTemplate: '/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ model: '{{model}}', messages: [{ role: 'system', content: '{{system_prompt}}' }, { role: 'user', content: '{{user_message}}' }], max_tokens: '{{max_tokens}}', temperature: '{{temperature}}' }),
      inputs: [
        { name: 'model', type: 'string', required: false, description: 'Model name', defaultValue: 'deepseek-chat' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt' },
        { name: 'user_message', type: 'string', required: true, description: 'User message' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max tokens', defaultValue: '4096' },
        { name: 'temperature', type: 'number', required: false, description: 'Temperature 0-2', defaultValue: '1.0' },
      ],
      outputs: [{ name: 'content', type: 'string' }, { name: 'reasoning_content', type: 'string' }, { name: 'usage', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://api.deepseek.com',
    auth_type: 'bearer',
    auth_config: { token: credentials.api_key },
  }),
}
