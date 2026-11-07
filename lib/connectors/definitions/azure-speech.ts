import type { ConnectorDefinition } from '../registry'

export const azureSpeechConnector: ConnectorDefinition = {
  key: 'azure_speech',
  name: 'Azure AI Speech',
  description: 'Speech to text (fast transcription with speakers and word timings) and neural text to speech on Microsoft Azure',
  category: 'ai',
  icon: 'Cloud',
  color: '#0078D4',
  docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/speech-service/',
  fields: [
    {
      key: 'region',
      label: 'Region',
      type: 'text',
      placeholder: 'eastus',
      required: true,
      helpText: 'The region of your Speech (or AI services) resource, e.g. eastus or westeurope (Azure portal → resource → Keys and Endpoint → Location/Region)',
    },
    {
      key: 'endpoint',
      label: 'Endpoint (optional)',
      type: 'text',
      placeholder: 'https://my-speech.cognitiveservices.azure.com',
      validation: { type: 'url' },
      helpText: 'The resource endpoint. Leave empty to use the regional endpoint.',
    },
    {
      key: 'voice',
      label: 'Default voice (optional)',
      type: 'text',
      placeholder: 'en-US-AvaMultilingualNeural',
      helpText: 'Neural voice name used for text to speech when a step does not choose one',
    },
  ],
  credentialFields: [
    {
      key: 'api_key',
      label: 'Key',
      type: 'password',
      required: true,
      helpText: 'KEY 1 or KEY 2 from the Azure portal → your Speech resource → Keys and Endpoint',
    },
  ],
  referenceTemplates: [],
  buildIntegrationConfig: (config, credentials) => {
    const region = String(config.region ?? '').trim()
    const endpoint = String(config.endpoint ?? '').trim().replace(/\/+$/, '')
    return {
      base_url: endpoint || `https://${region}.api.cognitive.microsoft.com`,
      auth_type: 'api_key',
      auth_config: {
        key_name: 'Ocp-Apim-Subscription-Key',
        key_value: credentials.api_key,
        add_to: 'header',
        region,
        ...(endpoint ? { endpoint } : {}),
        ...(config.voice ? { voice: String(config.voice).trim() } : {}),
      },
    }
  },
}
