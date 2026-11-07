import type { ConnectorDefinition } from '../registry'

export const elevenlabsConnector: ConnectorDefinition = {
  key: 'elevenlabs',
  name: 'ElevenLabs',
  description: 'Natural text to speech in many voices and languages, and Scribe speech to text',
  category: 'ai',
  icon: 'Sparkles',
  color: '#000000',
  docsUrl: 'https://elevenlabs.io/docs/api-reference',
  fields: [
    {
      key: 'voice',
      label: 'Default voice ID (optional)',
      type: 'text',
      placeholder: 'Voice ID from the Voice Library',
      helpText: 'Used for text to speech when a step does not choose a voice. Empty = the first of your account\'s default voices.',
    },
  ],
  credentialFields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText: 'elevenlabs.io → Developers (or Profile) → API Keys. Give the key Text to Speech, Speech to Text and Voices (read) access.',
    },
  ],
  referenceTemplates: [
    {
      key: 'list_voices', name: 'List Voices', description: 'Voices available to this account (ids for Text to Speech)', method: 'GET',
      pathTemplate: '/v2/voices?page_size={{page_size}}',
      inputs: [{ name: 'page_size', type: 'number', required: false, description: 'Voices per page', defaultValue: '30' }],
      outputs: [{ name: 'voices', type: 'array' }, { name: 'has_more', type: 'boolean' }],
    },
  ],
  buildIntegrationConfig: (config, credentials) => ({
    base_url: 'https://api.elevenlabs.io',
    auth_type: 'api_key',
    auth_config: {
      key_name: 'xi-api-key',
      key_value: credentials.api_key,
      add_to: 'header',
      ...(config.voice ? { voice: String(config.voice).trim() } : {}),
    },
  }),
}
