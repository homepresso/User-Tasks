import type { ConnectorDefinition } from '../registry'

export const claudeConnector: ConnectorDefinition = {
  key: 'claude',
  name: 'Claude (Anthropic)',
  description: 'AI-powered text generation, analysis, and coding with Claude',
  category: 'ai',
  icon: 'Brain',
  color: '#D97757',
  docsUrl: 'https://platform.claude.com/docs',
  fields: [
    {
      key: 'default_model',
      label: 'Default Model',
      type: 'select',
      options: [
        { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
        { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
        { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
        { value: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
        { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      ],
      defaultValue: 'claude-opus-5-5',
      helpText: 'Default model for messages',
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
      placeholder: 'sk-ant-...',
      required: true,
      helpText: 'Anthropic API Key from console.anthropic.com',
    },
  ],
  referenceTemplates: [
    {
      key: 'message',
      name: 'Send Message',
      description: 'Generate a response from Claude. The reply is the text block in content (thinking blocks may precede it); check stop_reason (refusal / max_tokens).',
      method: 'POST',
      pathTemplate: '/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      bodyTemplate: '{"model":"{{model}}","max_tokens":{{max_tokens}},"system":{{system_prompt}},"messages":[{"role":"user","content":"{{user_message}}"}],"output_config":{"effort":{{effort}}}}',
      inputs: [
        { name: 'user_message', type: 'string', required: true, description: 'The user message / prompt' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt to set context and instructions' },
        { name: 'model', type: 'string', required: false, description: 'Model override', defaultValue: 'claude-opus-5-5' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Maximum response tokens (includes thinking)', defaultValue: '16000' },
        { name: 'effort', type: 'string', required: false, description: 'low, medium, high, xhigh or max (thinking depth / token spend)', defaultValue: 'medium' },
      ],
      outputs: [
        { name: 'content', type: 'array' },
        { name: 'model', type: 'string' },
        { name: 'usage', type: 'object' },
        { name: 'stop_reason', type: 'string' },
      ],
    },
    {
      key: 'analyze',
      name: 'Analyze Text',
      description: 'Analyze, summarize, or extract information from text',
      method: 'POST',
      pathTemplate: '/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      bodyTemplate: '{"model":"{{model}}","max_tokens":{{max_tokens}},"system":"{{instructions}}","messages":[{"role":"user","content":"{{text}}"}],"output_config":{"effort":{{effort}}}}',
      inputs: [
        { name: 'text', type: 'string', required: true, description: 'Text to analyze' },
        { name: 'instructions', type: 'string', required: true, description: 'Analysis instructions (e.g. "Summarize this document", "Extract key entities")' },
        { name: 'model', type: 'string', required: false, description: 'Model override', defaultValue: 'claude-opus-5-5' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Maximum response tokens (includes thinking)', defaultValue: '16000' },
        { name: 'effort', type: 'string', required: false, description: 'low, medium, high, xhigh or max (thinking depth / token spend)', defaultValue: 'medium' },
      ],
      outputs: [
        { name: 'content', type: 'array' },
        { name: 'stop_reason', type: 'string' },
        { name: 'usage', type: 'object' },
      ],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://api.anthropic.com',
    auth_type: 'api_key',
    auth_config: {
      key_name: 'x-api-key',
      key_value: credentials.api_key,
      add_to: 'header',
    },
    headers: {
      'anthropic-version': '2023-06-01',
    },
  }),
}
