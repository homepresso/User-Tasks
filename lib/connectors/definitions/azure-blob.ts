import type { ConnectorDefinition } from '../registry'

export const azureBlobConnector: ConnectorDefinition = {
  key: 'azure_blob',
  name: 'Azure Blob Storage',
  description: 'Upload, download, and manage blobs in Azure Storage containers',
  category: 'cloud',
  icon: 'Container',
  color: '#0078D4',
  docsUrl: 'https://learn.microsoft.com/en-us/rest/api/storageservices/blob-service-rest-api',
  fields: [
    {
      key: 'account_name',
      label: 'Storage Account Name',
      type: 'text',
      placeholder: 'mystorageaccount',
      required: true,
      validation: { type: 'azure_storage_account' },
      helpText: 'Azure Storage account name',
      exampleText: 'contosostorage',
    },
    {
      key: 'container',
      label: 'Default Container',
      type: 'text',
      placeholder: 'my-container',
      required: true,
      validation: { type: 'azure_container' },
      helpText: 'Default blob container name',
      exampleText: 'documents',
    },
  ],
  credentialFields: [
    {
      key: 'account_key',
      label: 'Account Key',
      type: 'password',
      required: false,
      helpText: 'Storage Account Access Key (use this OR SAS token)',
      setupHint: 'Use one of the access keys from Storage Account > Security + networking > Access keys.',
    },
    {
      key: 'sas_token',
      label: 'SAS Token',
      type: 'password',
      required: false,
      placeholder: 'sv=2022-11-02&ss=b&srt=sco&sp=rwdlacyx&...',
      helpText: 'Shared Access Signature token (alternative to Account Key)',
      setupHint: 'Use a SAS token when you want narrower permissions or expiry windows than an account key.',
    },
  ],
  referenceTemplates: [
    {
      key: 'put_blob',
      name: 'Upload Blob',
      description: 'Upload a file to Azure Blob Storage',
      method: 'PUT',
      pathTemplate: '/{{container}}/{{blob_name}}',
      headers: { 'x-ms-blob-type': 'BlockBlob' },
      bodyTemplate: '{{content}}',
      inputs: [
        { name: 'container', type: 'string', required: false, description: 'Container name (uses default if empty)' },
        { name: 'blob_name', type: 'string', required: true, description: 'Blob name / path (e.g. uploads/file.pdf)' },
        { name: 'content', type: 'string', required: true, description: 'File content or base64 data' },
        { name: 'content_type', type: 'string', required: false, description: 'MIME type', defaultValue: 'application/octet-stream' },
      ],
      outputs: [
        { name: 'etag', type: 'string' },
        { name: 'url', type: 'string' },
      ],
    },
    {
      key: 'get_blob',
      name: 'Download Blob',
      description: 'Download a blob from Azure Storage',
      method: 'GET',
      pathTemplate: '/{{container}}/{{blob_name}}',
      inputs: [
        { name: 'container', type: 'string', required: false, description: 'Container name' },
        { name: 'blob_name', type: 'string', required: true, description: 'Blob name / path' },
      ],
      outputs: [
        { name: 'content', type: 'string' },
        { name: 'content_type', type: 'string' },
        { name: 'content_length', type: 'number' },
      ],
    },
    {
      key: 'list_blobs',
      name: 'List Blobs',
      description: 'List blobs in a container with optional prefix filter',
      method: 'GET',
      pathTemplate: '/{{container}}?restype=container&comp=list&prefix={{prefix}}&maxresults={{max_results}}',
      inputs: [
        { name: 'container', type: 'string', required: false, description: 'Container name' },
        { name: 'prefix', type: 'string', required: false, description: 'Filter by blob name prefix' },
        { name: 'max_results', type: 'number', required: false, description: 'Max results to return', defaultValue: '100' },
      ],
      outputs: [
        { name: 'blobs', type: 'array' },
      ],
    },
    {
      key: 'delete_blob',
      name: 'Delete Blob',
      description: 'Delete a blob from Azure Storage',
      method: 'DELETE',
      pathTemplate: '/{{container}}/{{blob_name}}',
      inputs: [
        { name: 'container', type: 'string', required: false, description: 'Container name' },
        { name: 'blob_name', type: 'string', required: true, description: 'Blob name / path to delete' },
      ],
      outputs: [
        { name: 'status', type: 'number' },
      ],
    },
  ],
  buildIntegrationConfig: (config, credentials) => {
    const baseUrl = `https://${config.account_name}.blob.core.windows.net`
    const authConfig: Record<string, any> = {
      _executor: 'azure_blob',
      account_name: config.account_name,
      container: config.container,
    }
    if (credentials.sas_token) {
      authConfig.sas_token = credentials.sas_token
    } else if (credentials.account_key) {
      authConfig.account_key = credentials.account_key
    }
    return {
      base_url: baseUrl,
      auth_type: 'api_key',
      auth_config: authConfig,
    }
  },
}
