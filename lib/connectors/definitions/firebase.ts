import type { ConnectorDefinition } from '../registry'

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'

function serviceAccountProjectId(json: unknown): string {
  if (typeof json !== 'string' || !json.trim()) return ''
  try {
    const parsed = JSON.parse(json)
    return typeof parsed?.project_id === 'string' ? parsed.project_id : ''
  } catch {
    return ''
  }
}

/** Firestore REST root for a project + database (both are single path segments). */
export function firestoreBaseUrl(projectId: string, databaseId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId || '(default)')}/documents`
}

export const firebaseConnector: ConnectorDefinition = {
  key: 'firebase',
  name: 'Firebase',
  description: 'Connect to Firebase Firestore with a Google service account to query, create, update, and delete documents',
  category: 'database',
  icon: 'Flame',
  color: '#FFCA28',
  docsUrl: 'https://firebase.google.com/docs/firestore/use-rest-api',
  recommendedPermissions: {
    title: 'Recommended IAM role',
    items: ['roles/datastore.user (Cloud Datastore User)'],
    note: 'Grant the service account this role on the project. Use roles/datastore.viewer for read-only access.',
  },
  fields: [
    {
      key: 'project_id',
      label: 'Google Cloud Project ID',
      type: 'text',
      placeholder: 'my-firebase-project',
      helpText: 'The project that hosts your Firestore database (Firebase console > Project settings > Project ID — not the App ID). Defaults to the service account\'s project_id.',
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
      placeholder: '{\n  "type": "service_account",\n  "project_id": "...",\n  "client_email": "...",\n  "private_key": "..."\n}',
      helpText: 'A Google service account with Firestore access.',
      exampleText: '{"type":"service_account","project_id":"my-project","client_email":"firebase-bot@my-project.iam.gserviceaccount.com"}',
    },
  ],
  referenceTemplates: [
    {
      key: 'list_documents',
      name: 'List Documents',
      description: 'List documents in a collection. Values use the Firestore typed encoding (fields.x.stringValue …). Page with page_token = the previous nextPageToken.',
      method: 'GET',
      pathTemplate: '/{{collection_path}}?pageSize={{page_size}}&pageToken={{page_token}}&orderBy={{order_by}}&mask.fieldPaths={{field_mask}}&showMissing={{show_missing}}',
      headers: { Accept: 'application/json' },
      inputs: [
        { name: 'collection_path', type: 'string', required: true, description: 'Collection path, e.g. users or companies/acme/orders' },
        { name: 'page_size', type: 'number', required: false, description: 'Maximum number of documents per page', defaultValue: '100' },
        { name: 'page_token', type: 'string', required: false, description: 'nextPageToken from the previous page' },
        { name: 'order_by', type: 'string', required: false, description: 'Order, e.g. updatedAt desc' },
        { name: 'field_mask', type: 'string', required: false, description: 'Return only this field path (one field)' },
        { name: 'show_missing', type: 'boolean', required: false, description: 'Include missing documents that have subcollections' },
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
        { name: 'field_mask', type: 'string', required: false, description: 'Return only this field path (one field)' },
      ],
      outputs: [
        { name: 'name', type: 'string' },
        { name: 'fields', type: 'object' },
        { name: 'createTime', type: 'string' },
        { name: 'updateTime', type: 'string' },
      ],
    },
    {
      key: 'create_document',
      name: 'Create Document',
      description: 'Create a document in a collection. document_json is a Firestore document: {"fields": {"name": {"stringValue": "Ada"}, "age": {"integerValue": "36"}}}. Fails with 409 if document_id exists.',
      method: 'POST',
      pathTemplate: '/{{collection_path}}?documentId={{document_id}}',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      bodyTemplate: '{{document_json}}',
      inputs: [
        { name: 'collection_path', type: 'string', required: true, description: 'Collection path to create into' },
        { name: 'document_id', type: 'string', required: false, description: 'Document ID (empty = generated)' },
        { name: 'document_json', type: 'object', required: true, description: 'Firestore document JSON ({"fields": {...}} with typed values)' },
      ],
      outputs: [
        { name: 'name', type: 'string' },
        { name: 'fields', type: 'object' },
        { name: 'createTime', type: 'string' },
      ],
    },
    {
      key: 'update_document',
      name: 'Update Document',
      description: 'Patch a document. Without update_mask the whole document is REPLACED (fields you do not send are removed); set update_mask to change one field only. Creates the document when it does not exist unless current_document_exists is true.',
      method: 'PATCH',
      pathTemplate: '/{{document_path}}?updateMask.fieldPaths={{update_mask}}&currentDocument.exists={{current_document_exists}}&currentDocument.updateTime={{current_update_time}}',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      bodyTemplate: '{{document_json}}',
      inputs: [
        { name: 'document_path', type: 'string', required: true, description: 'Document path to update' },
        { name: 'document_json', type: 'object', required: true, description: 'Firestore document JSON ({"fields": {...}} with typed values)' },
        { name: 'update_mask', type: 'string', required: false, description: 'The one field path to update (others are left untouched)' },
        { name: 'current_document_exists', type: 'boolean', required: false, description: 'true: fail if the document does not exist; false: fail if it does' },
        { name: 'current_update_time', type: 'string', required: false, description: 'Optimistic concurrency: fail unless the document was last updated at this time (updateTime from a read)' },
      ],
      outputs: [
        { name: 'name', type: 'string' },
        { name: 'fields', type: 'object' },
        { name: 'updateTime', type: 'string' },
      ],
    },
    {
      key: 'delete_document',
      name: 'Delete Document',
      description: 'Delete a Firestore document by path (subcollections are not deleted)',
      method: 'DELETE',
      pathTemplate: '/{{document_path}}?currentDocument.exists={{current_document_exists}}',
      headers: { Accept: 'application/json' },
      inputs: [
        { name: 'document_path', type: 'string', required: true, description: 'Document path to delete' },
        { name: 'current_document_exists', type: 'boolean', required: false, description: 'true: fail (404) if the document does not exist' },
      ],
      outputs: [],
    },
    {
      key: 'run_query',
      name: 'Run Query',
      description: 'Run a structured query on top-level collections. The response is an array of {document, readTime} items. Page with structuredQuery.limit plus startAt/offset.',
      method: 'POST',
      pathTemplate: ':runQuery',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      bodyTemplate: '{{query_json}}',
      inputs: [
        { name: 'query_json', type: 'object', required: true, description: 'Body with a structuredQuery, e.g. {"structuredQuery": {"from": [{"collectionId": "users"}], "limit": 50}}' },
      ],
      outputs: [],
    },
    {
      key: 'run_query_in_document',
      name: 'Run Query (subcollection)',
      description: 'Run a structured query on the subcollections of a document (e.g. parent_path companies/acme, from orders)',
      method: 'POST',
      pathTemplate: '/{{parent_path}}:runQuery',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      bodyTemplate: '{{query_json}}',
      inputs: [
        { name: 'parent_path', type: 'string', required: true, description: 'Parent document path, e.g. companies/acme' },
        { name: 'query_json', type: 'object', required: true, description: 'Body with a structuredQuery' },
      ],
      outputs: [],
    },
  ],
  /**
   * Integrations stored between Aug and Oct 2026 point at /v1/apps/… (a bulk
   * rename turned "projects" into "apps"); Firestore only serves /v1/projects/….
   */
  upgradeIntegrationConfig: (stored) => {
    const base = stored?.base_url
    if (typeof base !== 'string' || !base.startsWith('https://firestore.googleapis.com/v1/apps/')) return stored
    return { ...stored, base_url: base.replace('https://firestore.googleapis.com/v1/apps/', 'https://firestore.googleapis.com/v1/projects/') }
  },
  buildIntegrationConfig: (config, credentials) => {
    // Older rows stored the project as app_id.
    const projectId = String(config.project_id || config.app_id || serviceAccountProjectId(credentials.service_account_json) || '').trim()
    // (Empty project: calls answer 404 — preflight should flag it; see the audit notes.)
    return {
      base_url: firestoreBaseUrl(projectId, String(config.database_id || '(default)').trim()),
      auth_type: 'bearer',
      auth_config: {
        _executor: 'google_service_account',
        service_account_json: credentials.service_account_json,
        scopes: [FIRESTORE_SCOPE],
      },
    }
  },
}
