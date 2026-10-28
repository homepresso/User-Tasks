import type { ConnectorDefinition } from '../registry'

export const togetherConnector: ConnectorDefinition = {
  key: 'together',
  name: 'Together AI',
  description: 'Run open-source models — Llama, Mixtral, Qwen, DeepSeek, and more',
  category: 'ai',
  icon: 'Sparkles',
  color: '#0066FF',
  docsUrl: 'https://docs.together.ai/',
  fields: [
    {
      key: 'default_model',
      label: 'Default Model',
      type: 'select',
      options: [
        { value: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', label: 'Llama 3.1 70B Turbo' },
        { value: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', label: 'Llama 3.1 8B Turbo' },
        { value: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B Turbo' },
        { value: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B', label: 'DeepSeek R1 70B' },
        { value: 'mistralai/Mixtral-8x22B-Instruct-v0.1', label: 'Mixtral 8x22B' },
      ],
      defaultValue: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    },
  ],
  credentialFields: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: '', required: true, helpText: 'Together API Key from api.together.xyz' },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a chat completion', method: 'POST', pathTemplate: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ model: '{{model}}', messages: [{ role: 'system', content: '{{system_prompt}}' }, { role: 'user', content: '{{user_message}}' }], max_tokens: '{{max_tokens}}', temperature: '{{temperature}}' }),
      inputs: [
        { name: 'model', type: 'string', required: false, description: 'Model name', defaultValue: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt' },
        { name: 'user_message', type: 'string', required: true, description: 'User message' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max tokens', defaultValue: '1024' },
        { name: 'temperature', type: 'number', required: false, description: 'Temperature 0-2', defaultValue: '0.7' },
      ],
      outputs: [{ name: 'content', type: 'string' }, { name: 'usage', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://api.together.xyz',
    auth_type: 'bearer',
    auth_config: { token: credentials.api_key },
  }),
}
