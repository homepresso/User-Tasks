import type { ConnectorDefinition } from '../registry'

export const deepgramConnector: ConnectorDefinition = {
  key: 'deepgram',
  name: 'Deepgram',
  description: 'Fast speech to text with speakers and word timings (Nova), and Aura text to speech',
  category: 'ai',
  icon: 'Sparkles',
  color: '#13EF93',
  docsUrl: 'https://developers.deepgram.com/reference',
  fields: [],
  credentialFields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText: 'console.deepgram.com → your project → API Keys → Create a New API Key',
    },
  ],
  referenceTemplates: [
    {
      key: 'list_projects', name: 'List Projects', description: 'The projects this API key can use (checks the key)', method: 'GET',
      pathTemplate: '/v1/projects', inputs: [], outputs: [{ name: 'projects', type: 'array' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://api.deepgram.com',
    auth_type: 'api_key',
    auth_config: { key_name: 'Authorization', key_value: `Token ${String(credentials.api_key ?? '').trim()}`, add_to: 'header' },
  }),
}
