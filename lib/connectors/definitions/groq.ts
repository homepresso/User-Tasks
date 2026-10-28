import type { ConnectorDefinition } from '../registry'

export const groqConnector: ConnectorDefinition = {
  key: 'groq',
  name: 'Groq',
  description: 'Ultra-fast AI inference with Llama, Mixtral, and Gemma models',
  category: 'ai',
  icon: 'Zap',
  color: '#F55036',
  docsUrl: 'https://console.groq.com/docs/quickstart',
  fields: [
    {
      key: 'default_model',
      label: 'Default Model',
      type: 'select',
      options: [
        { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
        { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
        { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
        { value: 'gemma2-9b-it', label: 'Gemma 2 9B' },
      ],
      defaultValue: 'llama-3.3-70b-versatile',
    },
  ],
  credentialFields: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'gsk_...', required: true, helpText: 'Groq API Key from console.groq.com' },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a chat completion', method: 'POST', pathTemplate: '/openai/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ model: '{{model}}', messages: [{ role: 'system', content: '{{system_prompt}}' }, { role: 'user', content: '{{user_message}}' }], max_tokens: '{{max_tokens}}', temperature: '{{temperature}}' }),
      inputs: [
        { name: 'model', type: 'string', required: false, description: 'Model name (default: llama-3.3-70b-versatile)', defaultValue: 'llama-3.3-70b-versatile' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt' },
        { name: 'user_message', type: 'string', required: true, description: 'User message' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max tokens', defaultValue: '1024' },
        { name: 'temperature', type: 'number', required: false, description: 'Temperature 0-2', defaultValue: '0.7' },
      ],
      outputs: [{ name: 'content', type: 'string' }, { name: 'usage', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://api.groq.com',
    auth_type: 'bearer',
    auth_config: { token: credentials.api_key },
  }),
}
