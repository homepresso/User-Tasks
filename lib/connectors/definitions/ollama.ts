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
      helpText: 'URL where Ollama is running. Private/loopback addresses (localhost, 10.x, 192.168.x) are only reachable on self-hosted installs with ALLOW_PRIVATE_EGRESS=true — otherwise expose Ollama over HTTPS.',
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
  credentialFields: [
    { key: 'api_key', label: 'API Key (optional)', type: 'password', required: false, helpText: 'Bearer token when Ollama sits behind an authenticating proxy or is Ollama Cloud' },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a chat completion (OpenAI-compatible)', method: 'POST', pathTemplate: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"model":"{{model}}","messages":[{"role":"system","content":"{{system_prompt}}"},{"role":"user","content":"{{user_message}}"}],"max_tokens":{{max_tokens}},"temperature":{{temperature}},"stream":false}',
      inputs: [
        { name: 'model', type: 'string', required: false, description: 'Model name', defaultValue: 'llama3.1' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt', defaultValue: 'You are a helpful assistant.' },
        { name: 'user_message', type: 'string', required: true, description: 'User message' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max tokens (empty = model default)' },
        { name: 'temperature', type: 'number', required: false, description: 'Temperature (empty = model default)' },
      ],
      outputs: [{ name: 'choices.0.message.content', type: 'string' }, { name: 'usage', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (config, credentials) => {
    const baseUrl = String(config.base_url || 'http://localhost:11434').trim().replace(/\/+$/, '')
    return credentials?.api_key
      ? { base_url: baseUrl, auth_type: 'bearer', auth_config: { token: credentials.api_key } }
      : { base_url: baseUrl, auth_type: 'none', auth_config: {} }
  },
}
