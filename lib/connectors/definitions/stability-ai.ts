import type { ConnectorDefinition } from '../registry'

export const stabilityAiConnector: ConnectorDefinition = {
  key: 'stability_ai',
  name: 'Stability AI',
  description: 'Image generation (Stable Image Core, Ultra, Stable Diffusion 3.5) and inpainting',
  category: 'ai',
  icon: 'Sparkles',
  color: '#7C3AED',
  docsUrl: 'https://docs.stability.ai/',
  fields: [
    {
      key: 'image_model',
      label: 'Default model',
      type: 'select',
      options: [
        { value: 'core', label: 'Stable Image Core' },
        { value: 'ultra', label: 'Stable Image Ultra' },
        { value: 'sd3.5-large', label: 'Stable Diffusion 3.5 Large' },
        { value: 'sd3.5-large-turbo', label: 'Stable Diffusion 3.5 Large Turbo' },
        { value: 'sd3.5-medium', label: 'Stable Diffusion 3.5 Medium' },
      ],
      defaultValue: 'core',
    },
  ],
  credentialFields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      placeholder: 'sk-...',
      required: true,
      helpText: 'platform.stability.ai → Account → API Keys',
    },
  ],
  referenceTemplates: [
    {
      key: 'account_balance', name: 'Account Balance', description: 'Remaining credits on the account', method: 'GET',
      pathTemplate: '/v1/user/balance', inputs: [], outputs: [{ name: 'credits', type: 'number' }],
    },
  ],
  buildIntegrationConfig: (config, credentials) => ({
    base_url: 'https://api.stability.ai',
    auth_type: 'bearer',
    auth_config: { token: credentials.api_key, ...(config.image_model ? { image_model: String(config.image_model) } : {}) },
  }),
}
