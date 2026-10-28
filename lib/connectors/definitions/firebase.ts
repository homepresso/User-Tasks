import type { ConnectorDefinition } from '../registry'

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'

export const firebaseConnector: ConnectorDefinition = {
  key: 'firebase',
  name: 'Firebase',
  description: 'Connect to Firebase Firestore with a Google service account to query, create, update, and delete documents',
  category: 'database',
  icon: 'Flame',
  color: '#FFCA28',
  docsUrl: 'https://firebase.google.com/docs/firestore/use-rest-api',
  fields: [
    {
      key: 'app_id',
      label: 'Firebase App ID',
      type: 'text',
      placeholder: 'my-firebase-app',
      required: true,
      helpText: 'The Firebase or Google Cloud app that hosts your Firestore database.',
    },
    {
      key: 'database_id',
      label: 'Database ID',
      type: 'text',
      placeholder: '(default)',
      required: true,
      defaultValue: '(default)',
      helpText: 'Use (default) unless you created a named Firestore database.',
    },
  ],
  credentialFields: [
    {
      key: 'service_account_json',
      label: 'Service Account JSON',
      type: 'textarea',
      required: true,
      validation: { type: 'json_object' },
      placeholder: '{\n  "type": "service_account",\n  "app_id": "...",\n  "client_email": "...",\n  "private_key": "..."\n}',
      helpText: 'A Google service account with Firestore access.',
      exampleText: '{"type":"service_account","app_id":"my-app","client_email":"firebase-bot@my-app.iam.gserviceaccount.com"}',
    },
  ],
  referenceTemplates: [
    {
      key: 'list_documents',
      name: 'List Documents',
      description: 'List documents from a Firestore collection with page size and optional page token',
      method: 'GET',
      pathTemplate: '/{{collection_path}}?pageSize={{page_size}}&pageToken={{page_token}}&orderBy={{order_by}}&mask.fieldPaths={{field_mask}}',
      headers: { Accept: 'application/json' },
      inputs: [
        { name: 'collection_path', type: 'string', required: true, description: 'Collection path, e.g. users or companies/acme/orders' },
        { name: 'page_size', type: 'number', required: false, description: 'Maximum number of documents to return', defaultValue: '100' },
        { name: 'page_token', type: 'string', required: false, description: 'Next page token from a prior response', defaultValue: '' },
        { name: 'order_by', type: 'string', required: false, description: 'Firestore orderBy expression, e.g. updatedAt desc', defaultValue: '' },
        { name: 'field_mask', type: 'string', required: false, description: 'Comma-separated field mask to limit payload', defaultValue: '' },
      ],
      outputs: [
        { name: 'documents', type: 'array' },
        { name: 'nextPageToken', type: 'string' },
      ],
    },
    {
      key: 'get_document',
      name: 'Get Document',
      description: 'Fetch a single Firestore document by full document path',
      method: 'GET',
      pathTemplate: '/{{document_path}}?mask.fieldPaths={{field_mask}}',
      headers: { Accept: 'application/json' },
      inputs: [
        { name: 'document_path', type: 'string', required: true, description: 'Document path, e.g. users/alice or companies/acme/orders/ord_1' },
        { name: 'field_mask', type: 'string', required: false, description: 'Comma-separated field mask', defaultValue: '' },
      ],
      outputs: [
        { name: 'document', type: 'object' },
      ],
    },
    {
      key: 'create_document',
      name: 'Create Document',
      description: 'Create a Firestore document in a collection using the REST API document payload',
      method: 'POST',
      pathTemplate: '/{{collection_path}}?documentId={{document_id}}',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      bodyTemplate: '{{document_json}}',
      inputs: [
        { name: 'collection_path', type: 'string', required: true, description: 'Collection path to create into' },
        { name: 'document_id', type: 'string', required: false, description: 'Optional explicit document ID', defaultValue: '' },
        { name: 'document_json', type: 'string', required: true, description: 'Firestore document JSON payload' },
      ],
      outputs: [
        { name: 'document', type: 'object' },
      ],
    },
    {
      key: 'update_document',
      name: 'Update Document',
      description: 'Patch an existing Firestore document with optional update mask and optimistic concurrency',
      method: 'PATCH',
      pathTemplate: '/{{document_path}}?updateMask.fieldPaths={{update_mask}}&currentDocument.exists={{current_document_exists}}',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      bodyTemplate: '{{document_json}}',
      inputs: [
        { name: 'document_path', type: 'string', required: true, description: 'Document path to update' },
        { name: 'document_json', type: 'string', required: true, description: 'Firestore document JSON payload' },
        { name: 'update_mask', type: 'string', required: false, description: 'Comma-separated field paths to update', defaultValue: '' },
        { name: 'current_document_exists', type: 'string', required: false, description: 'Set true/false to enforce existence checks', defaultValue: '' },
      ],
      outputs: [
        { name: 'document', type: 'object' },
      ],
    },
    {
      key: 'delete_document',
      name: 'Delete Document',
      description: 'Delete a Firestore document by path',
      method: 'DELETE',
      pathTemplate: '/{{document_path}}',
      headers: { Accept: 'application/json' },
      inputs: [
        { name: 'document_path', type: 'string', required: true, description: 'Document path to delete' },
      ],
      outputs: [
        { name: 'deleted', type: 'boolean' },
      ],
    },
    {
      key: 'run_query',
      name: 'Run Query',
      description: 'Run a structured Firestore query against a collection',
      method: 'POST',
      pathTemplate: ':runQuery',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      bodyTemplate: '{{query_json}}',
      inputs: [
        { name: 'query_json', type: 'string', required: true, description: 'Firestore structuredQuery JSON body' },
      ],
      outputs: [
        { name: 'results', type: 'array' },
      ],
    },
  ],
  buildIntegrationConfig: (config, credentials) => ({
    base_url: `https://firestore.googleapis.com/v1/apps/${config.app_id}/databases/${config.database_id || '(default)'}/documents`,
    auth_type: 'bearer',
    auth_config: {
      _executor: 'google_service_account',
      service_account_json: credentials.service_account_json,
      scopes: [FIRESTORE_SCOPE],
    },
  }),
}
