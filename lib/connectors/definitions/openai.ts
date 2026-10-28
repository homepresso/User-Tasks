import type { ConnectorDefinition } from '../registry'

export const openaiConnector: ConnectorDefinition = {
  key: 'openai',
  name: 'OpenAI',
  description: 'Chat completions, embeddings, and image generation via OpenAI',
  category: 'ai',
  icon: 'Sparkles',
  color: '#412991',
  docsUrl: 'https://platform.openai.com/docs/api-reference',
  fields: [
    {
      key: 'default_model',
      label: 'Default Model',
      type: 'select',
      options: [
        { value: 'gpt-4o', label: 'GPT-4o' },
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
        { value: 'gpt-4.1', label: 'GPT-4.1' },
        { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
        { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
        { value: 'o3-mini', label: 'o3-mini' },
      ],
      defaultValue: 'gpt-4o-mini',
      helpText: 'Default model for chat completions',
    },
    {
      key: 'default_max_tokens',
      label: 'Default Max Tokens',
      type: 'number',
      placeholder: '1024',
      defaultValue: '1024',
    },
  ],
  credentialFields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      placeholder: 'sk-...',
      required: true,
      helpText: 'OpenAI API Key from platform.openai.com',
    },
    {
      key: 'org_id',
      label: 'Organization ID (optional)',
      type: 'text',
      placeholder: 'org-...',
      helpText: 'If you belong to multiple organizations',
    },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion',
      name: 'Chat Completion',
      description: 'Generate a chat completion response',
      method: 'POST',
      pathTemplate: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({
        model: '{{model}}',
        messages: [
          { role: 'system', content: '{{system_prompt}}' },
          { role: 'user', content: '{{user_message}}' },
        ],
        max_tokens: '{{max_tokens}}',
        temperature: '{{temperature}}',
      }),
      inputs: [
        { name: 'user_message', type: 'string', required: true, description: 'The user message / prompt' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt to set context', defaultValue: 'You are a helpful assistant.' },
        { name: 'model', type: 'string', required: false, description: 'Model override', defaultValue: 'gpt-4o-mini' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Maximum response tokens', defaultValue: '1024' },
        { name: 'temperature', type: 'number', required: false, description: 'Sampling temperature (0-2)', defaultValue: '0.7' },
      ],
      outputs: [
        { name: 'content', type: 'string' },
        { name: 'usage', type: 'object' },
        { name: 'model', type: 'string' },
      ],
    },
    {
      key: 'create_embedding',
      name: 'Create Embedding',
      description: 'Generate vector embeddings for text',
      method: 'POST',
      pathTemplate: '/v1/embeddings',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({
        model: '{{model}}',
        input: '{{text}}',
      }),
      inputs: [
        { name: 'text', type: 'string', required: true, description: 'Text to embed' },
        { name: 'model', type: 'string', required: false, description: 'Embedding model', defaultValue: 'text-embedding-3-small' },
      ],
      outputs: [
        { name: 'embedding', type: 'array' },
        { name: 'usage', type: 'object' },
      ],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => {
    const headers: Record<string, string> = {}
    if (credentials.org_id) headers['OpenAI-Organization'] = credentials.org_id
    return {
      base_url: 'https://api.openai.com',
      auth_type: 'bearer',
      auth_config: { token: credentials.api_key },
      headers,
    }
  },
}
