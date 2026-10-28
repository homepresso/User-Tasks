import type { ConnectorDefinition } from '../registry'

export const sapOdataConnector: ConnectorDefinition = {
  key: 'sap_odata',
  name: 'SAP OData',
  description: 'Connect to SAP S/4HANA, SAP BTP, or SAP Business Suite OData services — full CRUD, batch, and function imports',
  category: 'productivity',
  icon: 'Layers',
  color: '#0FAAFF',
  docsUrl: 'https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/68bf513362174d54b58cddec28794093/2b2f8d27eb084e74a2a555b5a13b9de5.html',
  fields: [
    {
      key: 'base_url',
      label: 'SAP OData Service URL',
      type: 'text',
      placeholder: 'https://my-sap.example.com/sap/opu/odata/sap/API_BUSINESS_PARTNER',
      required: true,
      validation: { type: 'url' },
      helpText: 'Full base URL to the SAP OData service (e.g. /sap/opu/odata/sap/API_BUSINESS_PARTNER for S/4HANA)',
    },
    {
      key: 'sap_client',
      label: 'SAP Client (optional)',
      type: 'text',
      placeholder: '100',
      helpText: 'SAP client number — sent as sap-client header',
    },
    {
      key: 'odata_version',
      label: 'OData Version',
      type: 'select',
      options: [
        { value: '2', label: 'OData v2 (SAP Gateway / ECC)' },
        { value: '4', label: 'OData v4 (S/4HANA Cloud / BTP)' },
      ],
      defaultValue: '2',
      helpText: 'SAP ECC/Gateway uses v2, S/4HANA Cloud and BTP services use v4',
    },
    {
      key: 'csrf',
      label: 'CSRF Token Handling',
      type: 'select',
      options: [
        { value: 'enabled', label: 'Enabled (required for write operations)' },
        { value: 'disabled', label: 'Disabled' },
      ],
      defaultValue: 'enabled',
      helpText: 'SAP OData services require CSRF tokens for POST/PUT/PATCH/DELETE',
    },
  ],
  credentialFields: [
    {
      key: 'auth_type',
      label: 'Authentication Type',
      type: 'select',
      options: [
        { value: 'basic', label: 'Basic Auth (SAP user/password)' },
        { value: 'bearer', label: 'OAuth2 Bearer Token' },
        { value: 'client_cert', label: 'Client Certificate (via SAP BTP)' },
      ],
      required: true,
      defaultValue: 'basic',
    },
    {
      key: 'username',
      label: 'Username',
      type: 'text',
      visibleWhen: { field: 'auth_type', equals: 'basic' },
      requiredWhen: { field: 'auth_type', equals: 'basic' },
      helpText: 'SAP system username (for Basic Auth)',
    },
    {
      key: 'password',
      label: 'Password',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'basic' },
      requiredWhen: { field: 'auth_type', equals: 'basic' },
      helpText: 'SAP system password (for Basic Auth)',
    },
    {
      key: 'token',
      label: 'OAuth2 Bearer Token',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'bearer' },
      requiredWhen: { field: 'auth_type', equals: 'bearer' },
      helpText: 'For OAuth2 auth (e.g. from SAP BTP destination service)',
    },
  ],
  referenceTemplates: [
    // ─── Discovery ───
    {
      key: 'get_metadata',
      name: 'Get Service Metadata',
      description: 'Retrieve the $metadata document describing all entity sets, types, and associations',
      method: 'GET',
      pathTemplate: '/$metadata',
      headers: { 'Accept': 'application/xml' },
      inputs: [],
      outputs: [{ name: 'content', type: 'string' }],
    },
    {
      key: 'get_service_document',
      name: 'Get Entity Sets',
      description: 'List all available entity sets in the service',
      method: 'GET',
      pathTemplate: '/',
      headers: { 'Accept': 'application/json' },
      inputs: [],
      outputs: [{ name: 'd', type: 'object' }],
    },
    // ─── Read ───
    {
      key: 'query_entity_set',
      name: 'Query Entity Set',
      description: 'Query an entity set with SAP OData query options ($filter, $select, $expand, $orderby, $top, $skip, $inlinecount)',
      method: 'GET',
      pathTemplate: '/{{entity_set}}?$filter={{filter}}&$select={{select}}&$expand={{expand}}&$orderby={{orderby}}&$top={{top}}&$skip={{skip}}&$inlinecount={{inlinecount}}&$format=json',
      inputs: [
        { name: 'entity_set', type: 'string', required: true, description: "Entity set name (e.g. A_BusinessPartner, PurchaseOrder, SalesOrder)" },
        { name: 'filter', type: 'string', required: false, description: "$filter expression (e.g. BusinessPartnerCategory eq '1' and Country eq 'US')" },
        { name: 'select', type: 'string', required: false, description: 'Comma-separated properties (e.g. BusinessPartner,BusinessPartnerName)' },
        { name: 'expand', type: 'string', required: false, description: 'Navigation properties to expand (e.g. to_BusinessPartnerAddress)' },
        { name: 'orderby', type: 'string', required: false, description: 'Sort expression (e.g. BusinessPartnerName asc)' },
        { name: 'top', type: 'number', required: false, description: 'Max records', defaultValue: '100' },
        { name: 'skip', type: 'number', required: false, description: 'Records to skip', defaultValue: '0' },
        { name: 'inlinecount', type: 'string', required: false, description: 'allpages to include total count (v2), or use $count=true for v4', defaultValue: 'allpages' },
      ],
      outputs: [{ name: 'd', type: 'object' }],
    },
    {
      key: 'get_entity',
      name: 'Get Entity by Key',
      description: "Retrieve a single entity by its key (e.g. A_BusinessPartner('1000001'))",
      method: 'GET',
      pathTemplate: "/{{entity_set}}({{key}})?$select={{select}}&$expand={{expand}}&$format=json",
      inputs: [
        { name: 'entity_set', type: 'string', required: true, description: 'Entity set name' },
        { name: 'key', type: 'string', required: true, description: "Key value(s) (e.g. '1000001' or BusinessPartner='1000001',BPType='1')" },
        { name: 'select', type: 'string', required: false, description: 'Properties to return' },
        { name: 'expand', type: 'string', required: false, description: 'Navigation properties to expand' },
      ],
      outputs: [{ name: 'd', type: 'object' }],
    },
    {
      key: 'count_entities',
      name: 'Count Entities',
      description: 'Get the count of entities in a set',
      method: 'GET',
      pathTemplate: '/{{entity_set}}/$count?$filter={{filter}}',
      inputs: [
        { name: 'entity_set', type: 'string', required: true, description: 'Entity set name' },
        { name: 'filter', type: 'string', required: false, description: '$filter expression' },
      ],
      outputs: [{ name: 'count', type: 'number' }],
    },
    {
      key: 'query_navigation',
      name: 'Query Navigation Property',
      description: 'Query related entities through a navigation property',
      method: 'GET',
      pathTemplate: "/{{entity_set}}({{key}})/{{navigation}}?$filter={{filter}}&$select={{select}}&$top={{top}}&$format=json",
      inputs: [
        { name: 'entity_set', type: 'string', required: true, description: 'Parent entity set' },
        { name: 'key', type: 'string', required: true, description: 'Parent entity key' },
        { name: 'navigation', type: 'string', required: true, description: 'Navigation property (e.g. to_BusinessPartnerAddress)' },
        { name: 'filter', type: 'string', required: false, description: 'Filter on related entities' },
        { name: 'select', type: 'string', required: false, description: 'Fields to return' },
        { name: 'top', type: 'number', required: false, description: 'Max results', defaultValue: '100' },
      ],
      outputs: [{ name: 'd', type: 'object' }],
    },
    // ─── Create ───
    {
      key: 'create_entity',
      name: 'Create Entity',
      description: 'Create a new entity (POST). CSRF token fetched automatically if enabled.',
      method: 'POST',
      pathTemplate: '/{{entity_set}}',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      bodyTemplate: '{{entity_json}}',
      inputs: [
        { name: 'entity_set', type: 'string', required: true, description: 'Entity set name' },
        { name: 'entity_json', type: 'string', required: true, description: 'JSON object with entity properties' },
      ],
      outputs: [{ name: 'd', type: 'object' }],
    },
    {
      key: 'deep_insert',
      name: 'Deep Insert',
      description: 'Create an entity with nested related entities in a single request',
      method: 'POST',
      pathTemplate: '/{{entity_set}}',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      bodyTemplate: '{{entity_json}}',
      inputs: [
        { name: 'entity_set', type: 'string', required: true, description: 'Parent entity set' },
        { name: 'entity_json', type: 'string', required: true, description: 'JSON with nested navigation properties (e.g. {"Name":"Order","to_Items":[...]})' },
      ],
      outputs: [{ name: 'd', type: 'object' }],
    },
    // ─── Update ───
    {
      key: 'update_entity',
      name: 'Update Entity (PATCH)',
      description: 'Partially update an entity — only specified properties are modified (merge semantics)',
      method: 'PATCH',
      pathTemplate: "/{{entity_set}}({{key}})",
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'If-Match': '{{etag}}' },
      bodyTemplate: '{{entity_json}}',
      inputs: [
        { name: 'entity_set', type: 'string', required: true, description: 'Entity set name' },
        { name: 'key', type: 'string', required: true, description: 'Entity key' },
        { name: 'entity_json', type: 'string', required: true, description: 'JSON with properties to update' },
        { name: 'etag', type: 'string', required: false, description: 'ETag for optimistic concurrency (use * to force)', defaultValue: '*' },
      ],
      outputs: [{ name: 'status', type: 'number' }],
    },
    {
      key: 'replace_entity',
      name: 'Replace Entity (PUT)',
      description: 'Fully replace an entity — all properties overwritten',
      method: 'PUT',
      pathTemplate: "/{{entity_set}}({{key}})",
      headers: { 'Content-Type': 'application/json', 'If-Match': '{{etag}}' },
      bodyTemplate: '{{entity_json}}',
      inputs: [
        { name: 'entity_set', type: 'string', required: true, description: 'Entity set name' },
        { name: 'key', type: 'string', required: true, description: 'Entity key' },
        { name: 'entity_json', type: 'string', required: true, description: 'Complete JSON entity' },
        { name: 'etag', type: 'string', required: false, description: 'ETag', defaultValue: '*' },
      ],
      outputs: [{ name: 'status', type: 'number' }],
    },
    // ─── Delete ───
    {
      key: 'delete_entity',
      name: 'Delete Entity',
      description: 'Delete an entity by key',
      method: 'DELETE',
      pathTemplate: "/{{entity_set}}({{key}})",
      headers: { 'If-Match': '{{etag}}' },
      inputs: [
        { name: 'entity_set', type: 'string', required: true, description: 'Entity set name' },
        { name: 'key', type: 'string', required: true, description: 'Entity key' },
        { name: 'etag', type: 'string', required: false, description: 'ETag', defaultValue: '*' },
      ],
      outputs: [{ name: 'status', type: 'number' }],
    },
    // ─── Function Imports ───
    {
      key: 'call_function_import',
      name: 'Call Function Import (GET)',
      description: 'Invoke a SAP function import (side-effect free, GET)',
      method: 'GET',
      pathTemplate: '/{{function_name}}?{{parameters}}&$format=json',
      inputs: [
        { name: 'function_name', type: 'string', required: true, description: 'Function import name (e.g. GetBusinessPartnerByName)' },
        { name: 'parameters', type: 'string', required: false, description: "URL parameters (e.g. Name='Acme'&Country='US')" },
      ],
      outputs: [{ name: 'd', type: 'object' }],
    },
    {
      key: 'call_action_import',
      name: 'Call Action Import (POST)',
      description: 'Invoke a SAP function import with side effects (POST)',
      method: 'POST',
      pathTemplate: '/{{function_name}}',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      bodyTemplate: '{{parameters_json}}',
      inputs: [
        { name: 'function_name', type: 'string', required: true, description: 'Function/action import name' },
        { name: 'parameters_json', type: 'string', required: false, description: 'JSON parameters', defaultValue: '{}' },
      ],
      outputs: [{ name: 'd', type: 'object' }],
    },
    // ─── Batch ───
    {
      key: 'batch_request',
      name: 'Batch Request',
      description: 'Execute multiple operations in a single $batch request',
      method: 'POST',
      pathTemplate: '/$batch',
      headers: { 'Content-Type': 'multipart/mixed;boundary=batch_{{batch_id}}' },
      bodyTemplate: '{{batch_body}}',
      inputs: [
        { name: 'batch_id', type: 'string', required: true, description: 'Unique batch boundary ID' },
        { name: 'batch_body', type: 'string', required: true, description: 'Multipart batch body (with changeset boundaries for write operations)' },
      ],
      outputs: [{ name: 'responses', type: 'array' }],
    },
    // ─── Raw ───
    {
      key: 'raw_request',
      name: 'Raw OData Request',
      description: 'Send a custom request to any path on the SAP OData service',
      method: 'GET',
      pathTemplate: '{{path}}',
      headers: { 'Accept': 'application/json' },
      bodyTemplate: '{{body}}',
      inputs: [
        { name: 'path', type: 'string', required: true, description: 'Request path' },
        { name: 'method', type: 'string', required: false, description: 'HTTP method', defaultValue: 'GET' },
        { name: 'body', type: 'string', required: false, description: 'Request body (JSON)' },
      ],
      outputs: [{ name: 'status', type: 'number' }, { name: 'body', type: 'string' }],
    },
  ],
  buildIntegrationConfig: (config, credentials) => {
    const headers: Record<string, string> = {}
    if (config.sap_client) headers['sap-client'] = config.sap_client
    if (config.csrf === 'enabled') headers['x-csrf-token'] = 'fetch'

    let authType = credentials.auth_type || 'basic'
    const authConfig: Record<string, any> = {}

    if (authType === 'basic') {
      authConfig.username = credentials.username || ''
      authConfig.password = credentials.password || ''
    } else if (authType === 'bearer') {
      authType = 'bearer'
      authConfig.token = credentials.token || ''
    }

    return {
      base_url: config.base_url || '',
      auth_type: authType,
      auth_config: authConfig,
      headers,
    }
  },
}
