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
        { value: 'gpt-4.1', label: 'GPT-4.1' },
        { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
        { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
        { value: 'gpt-5', label: 'GPT-5 (reasoning)' },
        { value: 'gpt-5-mini', label: 'GPT-5 Mini (reasoning)' },
        { value: 'gpt-4o', label: 'GPT-4o' },
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      ],
      defaultValue: 'gpt-4.1',
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
    {
      key: 'project_id',
      label: 'Project ID (optional)',
      type: 'text',
      placeholder: 'proj_...',
      helpText: 'Bill usage to a specific project (legacy user keys only — project keys already carry it)',
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
      bodyTemplate: '{"model":"{{model}}","messages":[{"role":"system","content":"{{system_prompt}}"},{"role":"user","content":"{{user_message}}"}],"max_completion_tokens":{{max_tokens}},"temperature":{{temperature}}}',
      inputs: [
        { name: 'user_message', type: 'string', required: true, description: 'The user message / prompt' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt to set context', defaultValue: 'You are a helpful assistant.' },
        { name: 'model', type: 'string', required: false, description: 'Model override', defaultValue: 'gpt-4.1' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Maximum response tokens (sent as max_completion_tokens; reasoning models count reasoning tokens too)', defaultValue: '4096' },
        { name: 'temperature', type: 'number', required: false, description: 'Sampling temperature 0-2 — leave empty for reasoning models (gpt-5, o-series), which reject it' },
      ],
      outputs: [
        { name: 'choices.0.message.content', type: 'string' },
        { name: 'choices.0.finish_reason', type: 'string' },
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
      bodyTemplate: '{"model":"{{model}}","input":"{{text}}","dimensions":{{dimensions}}}',
      inputs: [
        { name: 'text', type: 'string', required: true, description: 'Text to embed' },
        { name: 'model', type: 'string', required: false, description: 'Embedding model', defaultValue: 'text-embedding-3-small' },
        { name: 'dimensions', type: 'number', required: false, description: 'Output dimensions (text-embedding-3 models only; empty = model default)' },
      ],
      outputs: [
        { name: 'data.0.embedding', type: 'array' },
        { name: 'usage', type: 'object' },
      ],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => {
    const headers: Record<string, string> = {}
    if (credentials.org_id) headers['OpenAI-Organization'] = credentials.org_id
    if (credentials.project_id) headers['OpenAI-Project'] = credentials.project_id
    return {
      base_url: 'https://api.openai.com',
      auth_type: 'bearer',
      auth_config: { token: credentials.api_key },
      headers,
    }
  },
}
