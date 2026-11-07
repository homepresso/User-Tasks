import type { ConnectorDefinition, ReferenceTemplate } from '../registry'

/**
 * Salesforce REST + Bulk API 2.0.
 *
 * Every path uses {{api_version}} — an input left empty is filled from the
 * connector's API Version setting (default below). Values are encoded by the
 * runtime, so SOQL text may contain quotes, '+', '&' etc.; SOQL itself is
 * still the author's responsibility (escape ' as \' in literals).
 */

export const SALESFORCE_DEFAULT_API_VERSION = 'v66.0'

const API_VERSION = { name: 'api_version', type: 'string', required: false, description: 'API version override (defaults to the connector setting)' }
const OBJECT_TYPE = { name: 'object_type', type: 'string', required: true, description: 'SObject API name (e.g. Account, Contact, Lead, Opportunity, My_Object__c)' }
const QUERY_OUT = [
  { name: 'totalSize', type: 'number' },
  { name: 'done', type: 'boolean' },
  { name: 'records', type: 'array' },
  { name: 'nextRecordsUrl', type: 'string' },
]

const referenceTemplates: ReferenceTemplate[] = [
  {
    key: 'soql_query',
    name: 'SOQL Query',
    description: 'Execute a SOQL query. When done is false, pass nextRecordsUrl to "SOQL Query: Next Page".',
    method: 'GET',
    pathTemplate: '/services/data/{{api_version}}/query/?q={{query}}',
    inputs: [
      { name: 'query', type: 'string', required: true, description: 'SOQL query (e.g. SELECT Id, Name FROM Account LIMIT 10)' },
      API_VERSION,
    ],
    outputs: QUERY_OUT,
  },
  {
    key: 'query_more',
    name: 'SOQL Query: Next Page',
    description: 'Fetch the next batch of a SOQL query using the nextRecordsUrl from the previous page',
    method: 'GET',
    pathTemplate: '/services/data/{{api_version}}/query/',
    inputs: [
      { name: 'next_link', type: 'string', required: true, description: 'nextRecordsUrl from the previous SOQL Query response' },
      API_VERSION,
    ],
    outputs: QUERY_OUT,
  },
  {
    key: 'list_records',
    name: 'List Records',
    description: 'List records from a Salesforce object with field selection and filtering',
    method: 'GET',
    pathTemplate: '/services/data/{{api_version}}/query/?q=SELECT {{fields}} FROM {{object_type}} {{where_clause}} ORDER BY {{order_by}} LIMIT {{limit}}',
    inputs: [
      OBJECT_TYPE,
      { name: 'fields', type: 'string', required: false, description: 'Comma-separated field names', defaultValue: 'Id, Name' },
      { name: 'where_clause', type: 'string', required: false, description: 'Optional WHERE clause, trusted SOQL (e.g. WHERE Industry = \'Technology\')', defaultValue: '' },
      { name: 'order_by', type: 'string', required: false, description: 'ORDER BY field', defaultValue: 'Id' },
      { name: 'limit', type: 'number', required: false, description: 'Max records to return', defaultValue: '100' },
      API_VERSION,
    ],
    outputs: QUERY_OUT,
  },
  {
    key: 'get_record',
    name: 'Get Record',
    description: 'Retrieve a single Salesforce record by ID',
    method: 'GET',
    pathTemplate: '/services/data/{{api_version}}/sobjects/{{object_type}}/{{record_id}}?fields={{fields}}',
    inputs: [
      OBJECT_TYPE,
      { name: 'record_id', type: 'string', required: true, description: 'Record ID (15 or 18 characters)' },
      { name: 'fields', type: 'string', required: false, description: 'Comma-separated fields to return (default: all)' },
      API_VERSION,
    ],
    outputs: [
      { name: 'Id', type: 'string' },
      { name: 'attributes', type: 'object' },
    ],
  },
  {
    key: 'create_record',
    name: 'Create Record',
    description: 'Create a new Salesforce record',
    method: 'POST',
    pathTemplate: '/services/data/{{api_version}}/sobjects/{{object_type}}/',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: '{{record_json}}',
    inputs: [
      OBJECT_TYPE,
      { name: 'record_json', type: 'object', required: true, description: 'JSON object with field values, e.g. {"Name":"Acme"}' },
      API_VERSION,
    ],
    outputs: [
      { name: 'id', type: 'string' },
      { name: 'success', type: 'boolean' },
      { name: 'errors', type: 'array' },
    ],
  },
  {
    key: 'update_record',
    name: 'Update Record',
    description: 'Update an existing Salesforce record (returns 204 No Content on success)',
    method: 'PATCH',
    pathTemplate: '/services/data/{{api_version}}/sobjects/{{object_type}}/{{record_id}}',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: '{{record_json}}',
    inputs: [
      OBJECT_TYPE,
      { name: 'record_id', type: 'string', required: true, description: 'Record ID to update' },
      { name: 'record_json', type: 'object', required: true, description: 'JSON object with fields to update' },
      API_VERSION,
    ],
    outputs: [
      { name: 'status', type: 'number' },
    ],
  },
  {
    key: 'upsert_record',
    name: 'Upsert Record (External ID)',
    description: 'Create or update a record matched on an external ID field — safe to retry (idempotent)',
    method: 'PATCH',
    pathTemplate: '/services/data/{{api_version}}/sobjects/{{object_type}}/{{external_id_field}}/{{external_id}}',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: '{{record_json}}',
    inputs: [
      OBJECT_TYPE,
      { name: 'external_id_field', type: 'string', required: true, description: 'External ID field API name (e.g. External_Id__c)' },
      { name: 'external_id', type: 'string', required: true, description: 'External ID value' },
      { name: 'record_json', type: 'object', required: true, description: 'JSON object with field values (without the external ID field)' },
      API_VERSION,
    ],
    outputs: [
      { name: 'id', type: 'string' },
      { name: 'created', type: 'boolean' },
      { name: 'success', type: 'boolean' },
    ],
  },
  {
    key: 'delete_record',
    name: 'Delete Record',
    description: 'Delete a Salesforce record by ID',
    method: 'DELETE',
    pathTemplate: '/services/data/{{api_version}}/sobjects/{{object_type}}/{{record_id}}',
    inputs: [
      OBJECT_TYPE,
      { name: 'record_id', type: 'string', required: true, description: 'Record ID to delete' },
      API_VERSION,
    ],
    outputs: [
      { name: 'status', type: 'number' },
    ],
  },
  {
    key: 'bulk_query',
    name: 'Bulk API Query (Create Job)',
    description: 'Submit a Bulk API 2.0 query job for large datasets; poll "Bulk API Query Status", then "Bulk API Query Results"',
    method: 'POST',
    pathTemplate: '/services/data/{{api_version}}/jobs/query',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: '{"operation":"{{operation}}","query":"{{query}}"}',
    inputs: [
      { name: 'query', type: 'string', required: true, description: 'SOQL query for bulk extraction' },
      { name: 'operation', type: 'string', required: false, description: 'query or queryAll (includes deleted/archived)', defaultValue: 'query' },
      API_VERSION,
    ],
    outputs: [
      { name: 'id', type: 'string' },
      { name: 'operation', type: 'string' },
      { name: 'state', type: 'string' },
    ],
  },
  {
    key: 'bulk_query_status',
    name: 'Bulk API Query Status',
    description: 'Check the status of a Bulk API 2.0 query job',
    method: 'GET',
    pathTemplate: '/services/data/{{api_version}}/jobs/query/{{job_id}}',
    inputs: [
      { name: 'job_id', type: 'string', required: true, description: 'Bulk query job ID' },
      API_VERSION,
    ],
    outputs: [
      { name: 'id', type: 'string' },
      { name: 'state', type: 'string' },
      { name: 'numberRecordsProcessed', type: 'number' },
    ],
  },
  {
    key: 'bulk_query_results',
    name: 'Bulk API Query Results',
    description: 'Download CSV results of a completed query job. For more pages, pass the Sforce-Locator response header as locator.',
    method: 'GET',
    pathTemplate: '/services/data/{{api_version}}/jobs/query/{{job_id}}/results?maxRecords={{max_records}}&locator={{locator}}',
    headers: { Accept: 'text/csv' },
    inputs: [
      { name: 'job_id', type: 'string', required: true, description: 'Bulk query job ID' },
      { name: 'max_records', type: 'number', required: false, description: 'Max rows in this page', defaultValue: '50000' },
      { name: 'locator', type: 'string', required: false, description: 'Sforce-Locator from the previous page (empty for the first page)' },
      API_VERSION,
    ],
    outputs: [
      { name: '_raw', type: 'string' },
    ],
  },
  {
    key: 'bulk_ingest',
    name: 'Bulk API Ingest (Create Job)',
    description: 'Create a Bulk API 2.0 ingest job for mass insert/update/upsert/delete',
    method: 'POST',
    pathTemplate: '/services/data/{{api_version}}/jobs/ingest',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: '{"object":"{{object_type}}","operation":"{{operation}}","contentType":"CSV","lineEnding":"{{line_ending}}","externalIdFieldName":{{external_id_field}}}',
    inputs: [
      OBJECT_TYPE,
      { name: 'operation', type: 'string', required: true, description: 'insert, update, upsert, delete or hardDelete' },
      { name: 'external_id_field', type: 'string', required: false, description: 'External ID field name (required for upsert)' },
      { name: 'line_ending', type: 'string', required: false, description: 'LF or CRLF (must match the uploaded CSV)', defaultValue: 'LF' },
      API_VERSION,
    ],
    outputs: [
      { name: 'id', type: 'string' },
      { name: 'state', type: 'string' },
      { name: 'operation', type: 'string' },
    ],
  },
  {
    key: 'bulk_upload_data',
    name: 'Bulk API Upload Data',
    description: 'Upload CSV data to a Bulk API 2.0 ingest job',
    method: 'PUT',
    pathTemplate: '/services/data/{{api_version}}/jobs/ingest/{{job_id}}/batches',
    headers: { 'Content-Type': 'text/csv' },
    bodyTemplate: '{{csv_data}}',
    inputs: [
      { name: 'job_id', type: 'string', required: true, description: 'Bulk ingest job ID from Create Job step' },
      { name: 'csv_data', type: 'string', required: true, description: 'CSV data with header row (e.g. Name,Industry\\nAcme,Tech)' },
      API_VERSION,
    ],
    outputs: [
      { name: 'status', type: 'number' },
    ],
  },
  {
    key: 'bulk_close_job',
    name: 'Bulk API Close Job',
    description: 'Close a Bulk API ingest job to begin processing (set state to UploadComplete)',
    method: 'PATCH',
    pathTemplate: '/services/data/{{api_version}}/jobs/ingest/{{job_id}}',
    headers: { 'Content-Type': 'application/json' },
    bodyTemplate: JSON.stringify({ state: 'UploadComplete' }),
    inputs: [
      { name: 'job_id', type: 'string', required: true, description: 'Bulk ingest job ID' },
      API_VERSION,
    ],
    outputs: [
      { name: 'id', type: 'string' },
      { name: 'state', type: 'string' },
    ],
  },
  {
    key: 'bulk_job_status',
    name: 'Bulk API Ingest Job Status',
    description: 'Check the status of a Bulk API 2.0 ingest job (use "Bulk API Query Status" for query jobs)',
    method: 'GET',
    pathTemplate: '/services/data/{{api_version}}/jobs/ingest/{{job_id}}',
    inputs: [
      { name: 'job_id', type: 'string', required: true, description: 'Bulk ingest job ID' },
      API_VERSION,
    ],
    outputs: [
      { name: 'id', type: 'string' },
      { name: 'state', type: 'string' },
      { name: 'numberRecordsProcessed', type: 'number' },
      { name: 'numberRecordsFailed', type: 'number' },
      { name: 'totalProcessingTime', type: 'number' },
    ],
  },
  {
    key: 'bulk_get_results',
    name: 'Bulk API Ingest Results',
    description: 'Download successful, failed or unprocessed records (CSV) from a completed ingest job',
    method: 'GET',
    pathTemplate: '/services/data/{{api_version}}/jobs/ingest/{{job_id}}/{{result_type}}/',
    headers: { Accept: 'text/csv' },
    inputs: [
      { name: 'job_id', type: 'string', required: true, description: 'Bulk job ID' },
      { name: 'result_type', type: 'string', required: true, description: 'successfulResults, failedResults or unprocessedrecords' },
      API_VERSION,
    ],
    outputs: [
      { name: '_raw', type: 'string' },
    ],
  },
]

function trimUrl(value: unknown): string {
  return String(value ?? '').trim().replace(/\/+$/, '')
}

export const salesforceConnector: ConnectorDefinition = {
  key: 'salesforce',
  name: 'Salesforce',
  description: 'CRM operations, SOQL queries, and Bulk API for large data loads',
  category: 'productivity',
  icon: 'CloudCog',
  color: '#00A1E0',
  docsUrl: 'https://developer.salesforce.com/docs/apis',
  recommendedPermissions: {
    title: 'Recommended Salesforce Connected App Access',
    items: ['OAuth scopes: api and refresh_token (offline_access)', 'Integration user with object and field permissions for the records you plan to read or update', '"API Enabled" system permission'],
    note: 'For production, add the Connected App consumer key, consumer secret and a refresh token so access tokens are renewed automatically — a pasted session token expires (2 hours by default).',
  },
  fields: [
    {
      key: 'instance_url',
      label: 'Instance URL',
      type: 'text',
      placeholder: 'https://yourorg.my.salesforce.com',
      required: true,
      validation: { type: 'url' },
      helpText: 'Your Salesforce My Domain URL (e.g. https://yourorg.my.salesforce.com). Sandboxes: https://yourorg--sandbox.sandbox.my.salesforce.com',
      exampleText: 'https://acme.my.salesforce.com',
    },
    {
      key: 'api_version',
      label: 'API Version',
      type: 'text',
      placeholder: SALESFORCE_DEFAULT_API_VERSION,
      defaultValue: SALESFORCE_DEFAULT_API_VERSION,
      helpText: 'Salesforce REST API version used by every action (e.g. v66.0)',
    },
  ],
  credentialFields: [
    {
      key: 'access_token',
      label: 'Access Token',
      type: 'password',
      required: true,
      placeholder: '00D...',
      helpText: 'OAuth access token or Salesforce session ID. Used as-is unless the refresh-token fields below are filled.',
      setupHint: 'For durable production access, also provide the Connected App consumer key, consumer secret, and refresh token.',
    },
    {
      key: 'client_id',
      label: 'Consumer Key (optional)',
      type: 'text',
      placeholder: '3MVG9...',
      helpText: 'Connected App consumer key used when refreshing OAuth access tokens.',
      exampleText: '3MVG9AbCdEfGhIjKlMnOpQrStUvWxYz',
    },
    {
      key: 'client_secret',
      label: 'Consumer Secret (optional)',
      type: 'password',
      placeholder: '',
      helpText: 'Connected App consumer secret paired with the consumer key.',
    },
    {
      key: 'refresh_token',
      label: 'Refresh Token (optional)',
      type: 'password',
      placeholder: '',
      helpText: 'OAuth refresh token used to renew the access token automatically.',
    },
  ],
  oauth: {
    authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    defaultScopes: ['api', 'refresh_token', 'offline_access'],
  },
  referenceTemplates,
  buildIntegrationConfig: (config, credentials) => {
    const instanceUrl = trimUrl(config.instance_url)
    const canRefresh = Boolean(credentials.refresh_token && credentials.client_id && instanceUrl)
    if (canRefresh) {
      return {
        base_url: instanceUrl,
        auth_type: 'bearer',
        auth_config: {
          _executor: 'oauth_refresh',
          token: credentials.access_token || '',
          refresh_token: credentials.refresh_token,
          client_id: credentials.client_id,
          client_secret: credentials.client_secret || '',
          // The org's own My Domain token endpoint works for production and sandboxes.
          token_url: `${instanceUrl}/services/oauth2/token`,
        },
      }
    }
    return {
      base_url: instanceUrl,
      auth_type: 'bearer',
      auth_config: { token: credentials.access_token },
    }
  },
}
