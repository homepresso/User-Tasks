import type { ConnectorDefinition } from '../registry'

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
    items: ['Application user in the Dataverse environment', 'Environment-level security role with table permissions', 'API access via app registration'],
    note: 'Dataverse usually needs both Entran app credentials and an application user inside the environment with the right security role.',
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
      description: 'Query rows from a Dataverse table using OData',
      method: 'GET',
      pathTemplate: '/api/data/v9.2/{{table_name}}?$select={{select}}&$filter={{filter}}&$top={{top}}',
      inputs: [
        { name: 'table_name', type: 'string', required: true, description: 'Logical table name (plural, e.g. accounts, contacts)' },
        { name: 'select', type: 'string', required: false, description: 'Comma-separated column names to return' },
        { name: 'filter', type: 'string', required: false, description: 'OData filter expression (e.g. name eq \'Contoso\')' },
        { name: 'top', type: 'number', required: false, description: 'Number of rows to return', defaultValue: '50' },
      ],
      outputs: [
        { name: 'value', type: 'array' },
        { name: '@odata.count', type: 'number' },
      ],
    },
    {
      key: 'get_row',
      name: 'Get Row',
      description: 'Retrieve a single row by ID',
      method: 'GET',
      pathTemplate: '/api/data/v9.2/{{table_name}}({{row_id}})',
      inputs: [
        { name: 'table_name', type: 'string', required: true, description: 'Logical table name (plural)' },
        { name: 'row_id', type: 'string', required: true, description: 'Row GUID' },
      ],
      outputs: [
        { name: '@odata.context', type: 'string' },
      ],
    },
    {
      key: 'create_row',
      name: 'Create Row',
      description: 'Create a new row in a Dataverse table',
      method: 'POST',
      pathTemplate: '/api/data/v9.2/{{table_name}}',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      bodyTemplate: '{{row_json}}',
      inputs: [
        { name: 'table_name', type: 'string', required: true, description: 'Logical table name (plural)' },
        { name: 'row_json', type: 'string', required: true, description: 'JSON object with column values' },
      ],
      outputs: [
        { name: '@odata.context', type: 'string' },
      ],
    },
    {
      key: 'update_row',
      name: 'Update Row',
      description: 'Update an existing row in a Dataverse table',
      method: 'PATCH',
      pathTemplate: '/api/data/v9.2/{{table_name}}({{row_id}})',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{{row_json}}',
      inputs: [
        { name: 'table_name', type: 'string', required: true, description: 'Logical table name (plural)' },
        { name: 'row_id', type: 'string', required: true, description: 'Row GUID to update' },
        { name: 'row_json', type: 'string', required: true, description: 'JSON object with columns to update' },
      ],
      outputs: [
        { name: 'status', type: 'number' },
      ],
    },
    {
      key: 'delete_row',
      name: 'Delete Row',
      description: 'Delete a row from a Dataverse table',
      method: 'DELETE',
      pathTemplate: '/api/data/v9.2/{{table_name}}({{row_id}})',
      inputs: [
        { name: 'table_name', type: 'string', required: true, description: 'Logical table name (plural)' },
        { name: 'row_id', type: 'string', required: true, description: 'Row GUID to delete' },
      ],
      outputs: [
        { name: 'status', type: 'number' },
      ],
    },
    {
      key: 'batch_request',
      name: 'Batch Request',
      description: 'Execute multiple operations in a single batch request',
      method: 'POST',
      pathTemplate: '/api/data/v9.2/$batch',
      headers: { 'Content-Type': 'multipart/mixed;boundary=batch_{{batch_id}}' },
      bodyTemplate: '{{batch_body}}',
      inputs: [
        { name: 'batch_id', type: 'string', required: true, description: 'Unique batch boundary ID' },
        { name: 'batch_body', type: 'string', required: true, description: 'Multipart batch body content' },
      ],
      outputs: [
        { name: 'responses', type: 'array' },
      ],
    },
  ],
  buildIntegrationConfig: (config, credentials) => ({
    base_url: config.environment_url || '',
    auth_type: 'bearer',
    auth_config: {
      token: '',
      _executor: 'ms_client_credentials',
      tenant_id: config.tenant_id,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      scope: `${config.environment_url}/.default`,
    },
  }),
}
