import type { ConnectorDefinition } from '../registry'

export const azureAiVisionConnector: ConnectorDefinition = {
  key: 'azure_ai_vision',
  name: 'Azure AI Vision',
  description: 'Image analysis on Microsoft Azure: captions, tags, objects, text (OCR) with positions and face detection',
  category: 'ai',
  icon: 'Cloud',
  color: '#0078D4',
  docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/',
  fields: [
    {
      key: 'endpoint',
      label: 'Endpoint',
      type: 'text',
      placeholder: 'https://my-vision.cognitiveservices.azure.com',
      required: true,
      validation: { type: 'url' },
      helpText: 'Azure portal → your Computer Vision (or AI services) resource → Keys and Endpoint. Face boxes use the Face API on the same resource (detection only).',
    },
  ],
  credentialFields: [
    {
      key: 'api_key',
      label: 'Key',
      type: 'password',
      required: true,
      helpText: 'KEY 1 or KEY 2 from the Azure portal → your resource → Keys and Endpoint',
    },
  ],
  referenceTemplates: [
    {
      key: 'analyze_image_url', name: 'Analyze Image (URL)', description: 'Image Analysis 4.0 on a public image URL: caption, tags, objects, read (OCR)', method: 'POST',
      pathTemplate: '/computervision/imageanalysis:analyze?api-version=2024-02-01&features={{features}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({ url: '{{image_url}}' }),
      inputs: [
        { name: 'image_url', type: 'string', required: true, description: 'Public URL of the image' },
        { name: 'features', type: 'string', required: false, description: 'Comma-separated: caption,tags,objects,read,people', defaultValue: 'tags,read' },
      ],
      outputs: [{ name: 'tagsResult', type: 'object' }, { name: 'readResult', type: 'object' }, { name: 'metadata', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (config, credentials) => {
    const endpoint = String(config.endpoint ?? '').trim().replace(/\/+$/, '')
    return {
      base_url: endpoint,
      auth_type: 'api_key',
      auth_config: { key_name: 'Ocp-Apim-Subscription-Key', key_value: credentials.api_key, add_to: 'header', endpoint },
    }
  },
}
