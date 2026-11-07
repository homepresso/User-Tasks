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
        { value: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo' },
        { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
        { value: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B Turbo' },
        { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
        { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
      ],
      defaultValue: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    },
  ],
  credentialFields: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: '', required: true, helpText: 'Together API Key from api.together.xyz' },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a chat completion', method: 'POST', pathTemplate: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"model":"{{model}}","messages":[{"role":"system","content":"{{system_prompt}}"},{"role":"user","content":"{{user_message}}"}],"max_tokens":{{max_tokens}},"temperature":{{temperature}}}',
      inputs: [
        { name: 'model', type: 'string', required: false, description: 'Model name', defaultValue: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System prompt', defaultValue: 'You are a helpful assistant.' },
        { name: 'user_message', type: 'string', required: true, description: 'User message' },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max tokens', defaultValue: '1024' },
        { name: 'temperature', type: 'number', required: false, description: 'Temperature 0-2', defaultValue: '0.7' },
      ],
      outputs: [{ name: 'choices.0.message.content', type: 'string' }, { name: 'usage', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://api.together.xyz',
    auth_type: 'bearer',
    auth_config: { token: credentials.api_key },
  }),
}
