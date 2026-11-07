import type { ConnectorDefinition } from '../registry'

/**
 * Azure AI Document Intelligence: the workspace's own resource for document
 * OCR (Settings → Document OCR creates and manages one of these; see
 * lib/services/document-ocr). The key is a connector credential, so it is
 * encrypted at rest, write-only on every surface and left out of exports.
 */
export const azureDocumentIntelligenceConnector: ConnectorDefinition = {
  key: 'azure_document_intelligence',
  name: 'Azure AI Document Intelligence',
  description: 'OCR for scanned PDFs and images in document steps (prebuilt-read), billed to your own Azure resource',
  category: 'ai',
  icon: 'Cloud',
  color: '#0078D4',
  docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/',
  fields: [
    {
      key: 'endpoint',
      label: 'Endpoint',
      type: 'text',
      placeholder: 'https://my-resource.cognitiveservices.azure.com',
      required: true,
      validation: { type: 'url' },
      helpText: 'Azure portal → your Document Intelligence (or AI services) resource → Keys and Endpoint',
    },
    {
      key: 'api_version',
      label: 'API version',
      type: 'text',
      placeholder: '2024-11-30',
      required: false,
      helpText: 'Leave blank for 2024-11-30 (the current GA version)',
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
      key: 'resource_info', name: 'Get Resource Info', description: 'Custom model count and limit of the Document Intelligence resource (a free call: checks the endpoint and key)', method: 'GET',
      pathTemplate: '/documentintelligence/info?api-version=2024-11-30',
      inputs: [],
      outputs: [{ name: 'customDocumentModels', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (config, credentials) => {
    const endpoint = String(config.endpoint ?? '').trim().replace(/\/+$/, '')
    const apiVersion = String(config.api_version ?? '').trim()
    return {
      base_url: endpoint,
      auth_type: 'api_key',
      auth_config: { key_name: 'Ocp-Apim-Subscription-Key', key_value: credentials.api_key, add_to: 'header', endpoint, ...(apiVersion ? { api_version: apiVersion } : {}) },
    }
  },
}
