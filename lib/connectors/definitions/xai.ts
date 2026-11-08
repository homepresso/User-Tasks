import type { ConnectorDefinition } from '../registry'

/** xAI (Grok): OpenAI-compatible Chat Completions at https://api.x.ai/v1, Bearer key. */
export const xaiConnector: ConnectorDefinition = {
  key: 'xai',
  name: 'xAI Grok',
  description: 'Grok models from xAI through the OpenAI-compatible Chat Completions API',
  category: 'ai',
  icon: 'Sparkles',
  color: '#111111',
  docsUrl: 'https://docs.x.ai/docs/overview',
  fields: [
    {
      key: 'default_model',
      label: 'Default Model',
      type: 'select',
      options: [
        { value: 'grok-4', label: 'Grok 4' },
        { value: 'grok-4-fast', label: 'Grok 4 Fast' },
        { value: 'grok-3-mini', label: 'Grok 3 Mini' },
      ],
      defaultValue: 'grok-4',
    },
  ],
  credentialFields: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'xai-...', required: true, helpText: 'xAI API key from console.x.ai' },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a chat completion', method: 'POST', pathTemplate: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"model":"{{model}}","messages":[{"role":"system","content":"{{system_prompt}}"},{"role":"user","content":"{{user_message}}"}],"max_tokens":{{max_tokens}},"temperature":{{temperature}}}',
      inputs: [
        { name: 'model', type: 'string', required: false, description: 'Model name (default: grok-4)', defaultValue: 'grok-4' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt', defaultValue: 'You are a helpful assistant.' },
        { name: 'user_message', type: 'string', required: true, description: 'User message' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max tokens', defaultValue: '1024' },
        { name: 'temperature', type: 'number', required: false, description: 'Temperature 0-2', defaultValue: '0.7' },
      ],
      outputs: [{ name: 'choices.0.message.content', type: 'string' }, { name: 'usage', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://api.x.ai',
    auth_type: 'bearer',
    auth_config: { token: credentials.api_key },
  }),
}
