import type { ConnectorDefinition } from '../registry'

export const ollamaConnector: ConnectorDefinition = {
  key: 'ollama',
  name: 'Ollama (Local)',
  description: 'Run AI models locally — Llama, Mistral, Phi, Gemma, and more',
  category: 'ai',
  icon: 'Monitor',
  color: '#000000',
  docsUrl: 'https://ollama.com/blog/openai-compatibility',
  fields: [
    {
      key: 'base_url',
      label: 'Ollama URL',
      type: 'text',
      placeholder: 'http://localhost:11434',
      defaultValue: 'http://localhost:11434',
      helpText: 'URL where Ollama is running',
    },
    {
      key: 'default_model',
      label: 'Default Model',
      type: 'text',
      placeholder: 'llama3.1',
      defaultValue: 'llama3.1',
      helpText: 'Model name (must be pulled first: ollama pull llama3.1)',
    },
  ],
  credentialFields: [],  // No API key needed for local
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a chat completion (OpenAI-compatible)', method: 'POST', pathTemplate: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ model: '{{model}}', messages: [{ role: 'system', content: '{{system_prompt}}' }, { role: 'user', content: '{{user_message}}' }], stream: false }),
      inputs: [
        { name: 'model', type: 'string', required: false, description: 'Model name', defaultValue: 'llama3.1' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt' },
        { name: 'user_message', type: 'string', required: true, description: 'User message' },
      ],
      outputs: [{ name: 'content', type: 'string' }, { name: 'usage', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (config) => ({
    base_url: config.base_url || 'http://localhost:11434',
    auth_type: 'none',
    auth_config: {},
  }),
}
