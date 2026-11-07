import type { ConnectorDefinition } from '../registry'

export const assemblyaiConnector: ConnectorDefinition = {
  key: 'assemblyai',
  name: 'AssemblyAI',
  description: 'Speech to text with speaker labels, language detection and word timings (asynchronous)',
  category: 'ai',
  icon: 'Sparkles',
  color: '#2545D3',
  docsUrl: 'https://www.assemblyai.com/docs',
  fields: [
    {
      key: 'data_region',
      label: 'Data region',
      type: 'select',
      options: [
        { value: 'us', label: 'US (api.assemblyai.com)' },
        { value: 'eu', label: 'EU (api.eu.assemblyai.com)' },
      ],
      defaultValue: 'us',
      helpText: 'Where AssemblyAI processes and stores the audio',
    },
  ],
  credentialFields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText: 'assemblyai.com/dashboard → API Keys',
    },
  ],
  referenceTemplates: [],
  buildIntegrationConfig: (config, credentials) => ({
    base_url: config.data_region === 'eu' ? 'https://api.eu.assemblyai.com' : 'https://api.assemblyai.com',
    auth_type: 'api_key',
    auth_config: { key_name: 'Authorization', key_value: credentials.api_key, add_to: 'header' },
  }),
}
