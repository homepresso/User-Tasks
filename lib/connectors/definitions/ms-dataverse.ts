import type { ConnectorDefinition } from '../registry'

const DATAVERSE_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'OData-MaxVersion': '4.0',
  'OData-Version': '4.0',
}

export const msDataverseConnector: ConnectorDefinition = {
  key: 'ms_dataverse',
  name: 'Microsoft Dataverse',
  description: 'Query, create, and manage data in Microsoft Dataverse (Power Platform)',
  category: 'productivity',
  icon: 'Database',
  color: '#742774',
  docsUrl: 'https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview',
  recommendedPermissions: {
    title: 'Recommended Dataverse Access',
    items: ['Entra ID app registration with a client secret', 'Application user for that app in the Dataverse environment (Power Platform admin center > Environment > Settings > Application users)', 'A security role on the application user granting only the tables this connector uses'],
    note: 'App-only Dataverse access needs no Microsoft Graph or Dynamics API permission; access is controlled by the application user\'s security role.',
  },
  fields: [
    {
      key: 'environment_url',
      label: 'Environment URL',
      type: 'text',
      placeholder: 'https://yourorg.crm.dynamics.com',
      required: true,
      validation: { type: 'url' },
      helpText: 'Dataverse environment URL (e.g. https://yourorg.crm.dynamics.com)',
    },
    {
      key: 'tenant_id',
      label: 'Azure Tenant ID',
      type: 'text',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      required: true,
      validation: { type: 'uuid' },
      helpText: 'Azure AD / Entra ID Tenant ID',
    },
  ],
  credentialFields: [
    {
      key: 'client_id',
      label: 'Application (Client) ID',
      type: 'text',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      required: true,
      validation: { type: 'uuid' },
      helpText: 'Azure AD App Registration with Dataverse permissions',
    },
    {
      key: 'client_secret',
      label: 'Client Secret',
      type: 'password',
      required: true,
      helpText: 'Azure AD App Registration Client Secret',
    },
  ],
  referenceTemplates: [
    {
      key: 'query_table',
      name: 'Query Table',
      description: 'Query rows from a Dataverse table using OData. Pass @odata.nextLink back as next_link for the next page.',
      method: 'GET',
      pathTemplate: '/api/data/v9.2/{{table_name}}?$select={{select}}&$filter={{filter}}&$orderby={{orderby}}&$top={{max_rows}}&$count={{include_count}}',
      headers: { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize={{page_size}}' },
      inputs: [
        { name: 'table_name', type: 'string', required: true, description: 'Entity set name (plural, e.g. accounts, contacts)' },
        { name: 'select', type: 'string', required: false, description: 'Comma-separated column names to return' },
        { name: 'filter', type: 'string', required: false, description: 'OData filter expression (e.g. name eq \'Contoso\'; double any single quote inside a value)' },
        { name: 'orderby', type: 'string', required: false, description: 'Sort (e.g. createdon desc)' },
        { name: 'max_rows', type: 'number', required: false, description: 'Maximum rows in total ($top; disables paging). Leave empty to page with page_size.' },
        { name: 'page_size', type: 'number', required: false, description: 'Rows per page (max 5000)', defaultValue: '500' },
        { name: 'include_count', type: 'boolean', required: false, description: 'true to return @odata.count' },
        { name: 'next_link', type: 'string', required: false, description: '@odata.nextLink from the previous page' },
      ],
      outputs: [
        { name: 'value', type: 'array' },
        { name: '@odata.nextLink', type: 'string' },
        { name: '@odata.count', type: 'number' },
      ],
    },
    {
      key: 'get_row',
      name: 'Get Row',
      description: 'Retrieve a single row by ID (or alternate key, e.g. accountnumber=\'A100\')',
      method: 'GET',
      pathTemplate: '/api/data/v9.2/{{table_name}}({{row_id}})?$select={{select}}',
      headers: { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' },
      inputs: [
        { name: 'table_name', type: 'string', required: true, description: 'Entity set name (plural)' },
        { name: 'row_id', type: 'string', required: true, description: 'Row GUID' },
        { name: 'select', type: 'string', required: false, description: 'Comma-separated column names to return' },
      ],
      outputs: [
        { name: '@odata.context', type: 'string' },
        { name: '@odata.etag', type: 'string' },
      ],
    },
    {
      key: 'create_row',
      name: 'Create Row',
      description: 'Create a new row in a Dataverse table (returns the created row)',
      method: 'POST',
      pathTemplate: '/api/data/v9.2/{{table_name}}',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      bodyTemplate: '{{row_json}}',
      inputs: [
        { name: 'table_name', type: 'string', required: true, description: 'Entity set name (plural)' },
        { name: 'row_json', type: 'object', required: true, description: 'JSON object with column values' },
      ],
      outputs: [
        { name: '@odata.context', type: 'string' },
        { name: '@odata.etag', type: 'string' },
      ],
    },
    {
      key: 'update_row',
      name: 'Update Row',
      description: 'Update an existing row (fails with 404 if the row does not exist; never creates one)',
      method: 'PATCH',
      pathTemplate: '/api/data/v9.2/{{table_name}}({{row_id}})',
      headers: { 'Content-Type': 'application/json', 'If-Match': '*' },
      bodyTemplate: '{{row_json}}',
      inputs: [
        { name: 'table_name', type: 'string', required: true, description: 'Entity set name (plural)' },
        { name: 'row_id', type: 'string', required: true, description: 'Row GUID to update' },
        { name: 'row_json', type: 'object', required: true, description: 'JSON object with columns to update' },
      ],
      outputs: [
        { name: 'success', type: 'boolean' },
      ],
    },
    {
      key: 'delete_row',
      name: 'Delete Row',
      description: 'Delete a row from a Dataverse table',
      method: 'DELETE',
      pathTemplate: '/api/data/v9.2/{{table_name}}({{row_id}})',
      inputs: [
        { name: 'table_name', type: 'string', required: true, description: 'Entity set name (plural)' },
        { name: 'row_id', type: 'string', required: true, description: 'Row GUID to delete' },
      ],
      outputs: [
        { name: 'success', type: 'boolean' },
      ],
    },
    {
      key: 'batch_request',
      name: 'Batch Request',
      description: 'Execute multiple operations in one $batch request (multipart/mixed body with CRLF line endings)',
      method: 'POST',
      pathTemplate: '/api/data/v9.2/$batch',
      headers: { 'Content-Type': 'multipart/mixed;boundary=batch_{{batch_id}}' },
      bodyTemplate: '{{batch_body}}',
      inputs: [
        { name: 'batch_id', type: 'string', required: true, description: 'Batch boundary ID (the body uses --batch_<id>)' },
        { name: 'batch_body', type: 'string', required: true, description: 'Multipart batch body content' },
      ],
      outputs: [
        { name: '_raw', type: 'string' },
      ],
    },
  ],
  buildIntegrationConfig: (config, credentials) => {
    const environmentUrl = String(config.environment_url ?? '').trim().replace(/\/+$/, '')
    return {
      base_url: environmentUrl,
      auth_type: 'bearer',
      auth_config: {
        token: '',
        _executor: 'ms_client_credentials',
        tenant_id: config.tenant_id,
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        scope: `${environmentUrl}/.default`,
      },
      headers: DATAVERSE_HEADERS,
    }
  },
  // Older rows: no OData headers, and a trailing slash in the environment URL
  // produced //api/data paths and an invalid token scope.
  upgradeIntegrationConfig: (stored) => {
    const baseUrl = typeof stored?.base_url === 'string' ? stored.base_url.trim().replace(/\/+$/, '') : stored?.base_url
    const authConfig = stored?.auth_config && typeof stored.auth_config === 'object' ? { ...stored.auth_config } : stored?.auth_config
    if (authConfig && typeof authConfig.scope === 'string') authConfig.scope = authConfig.scope.replace(/\/+\.default$/, '/.default')
    return { ...stored, base_url: baseUrl, auth_config: authConfig, headers: { ...DATAVERSE_HEADERS, ...(stored?.headers ?? {}) } }
  },
}
