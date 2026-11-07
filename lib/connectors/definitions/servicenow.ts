import type { ConnectorDefinition } from '../registry'

/** Instance name ("acme") → https://acme.service-now.com; a full host or URL is kept (custom domains). */
export function servicenowBaseUrl(instance: unknown): string {
  const raw = String(instance ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  if (!raw) return ''
  if (raw.includes('.')) return `https://${raw}`
  return `https://${raw}.service-now.com`
}

export const servicenowConnector: ConnectorDefinition = {
  key: 'servicenow',
  name: 'ServiceNow',
  description: 'IT service management — manage incidents, requests, changes, users, and query any table via the Table API',
  category: 'productivity',
  icon: 'Cog',
  color: '#81B5A1',
  docsUrl: 'https://developer.servicenow.com/dev.do#!/reference/api/latest/rest/',
  fields: [
    {
      key: 'instance',
      label: 'Instance Name',
      type: 'text',
      placeholder: 'your-instance',
      required: true,
      helpText: 'ServiceNow instance name (your-instance for your-instance.service-now.com), or the full host / URL for custom domains',
    },
  ],
  credentialFields: [
    {
      key: 'auth_type',
      label: 'Authentication Type',
      type: 'select',
      options: [
        { value: 'basic', label: 'Basic Auth (username/password)' },
        { value: 'bearer', label: 'OAuth2 Bearer Token' },
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
      helpText: 'For Basic Auth',
    },
    {
      key: 'password',
      label: 'Password',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'basic' },
      requiredWhen: { field: 'auth_type', equals: 'basic' },
      helpText: 'For Basic Auth',
    },
    {
      key: 'token',
      label: 'OAuth2 Bearer Token',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'bearer' },
      requiredWhen: { field: 'auth_type', equals: 'bearer' },
      helpText: 'OAuth access token (expires — add the client and refresh token below for automatic renewal)',
    },
    {
      key: 'client_id',
      label: 'OAuth Client ID (optional)',
      type: 'text',
      visibleWhen: { field: 'auth_type', equals: 'bearer' },
      helpText: 'Application Registry client ID, used with the refresh token to renew access tokens',
    },
    {
      key: 'client_secret',
      label: 'OAuth Client Secret (optional)',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'bearer' },
    },
    {
      key: 'refresh_token',
      label: 'Refresh Token (optional)',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'bearer' },
      helpText: 'Refresh token from /oauth_token.do',
    },
  ],
  referenceTemplates: [
    // ─── Generic Table API ───
    {
      key: 'query_table',
      name: 'Query Table',
      description: 'Query any ServiceNow table with filters, ordering, and pagination',
      method: 'GET',
      pathTemplate: '/api/now/table/{{table}}?sysparm_query={{query}}&sysparm_fields={{fields}}&sysparm_limit={{limit}}&sysparm_offset={{offset}}&sysparm_display_value={{display_value}}&sysparm_exclude_reference_link={{exclude_reference_link}}',
      inputs: [
        { name: 'table', type: 'string', required: true, description: 'Table name (e.g. incident, sc_request, sys_user, cmdb_ci)' },
        { name: 'query', type: 'string', required: false, description: 'Encoded query, trusted text (e.g. active=true^priority=1^ORDERBYDESCsys_created_on). Order with ORDERBY<field> / ORDERBYDESC<field>. When inserting workflow values, escape ^ as ^^.' },
        { name: 'fields', type: 'string', required: false, description: 'Comma-separated fields to return' },
        { name: 'limit', type: 'number', required: false, description: 'Max records (page size)', defaultValue: '100' },
        { name: 'offset', type: 'number', required: false, description: 'Records to skip (next page = offset + limit; stop when fewer than limit are returned)', defaultValue: '0' },
        { name: 'display_value', type: 'string', required: false, description: 'true = display values, false = raw values/sys_ids (use for write-back), all = both', defaultValue: 'true' },
        { name: 'exclude_reference_link', type: 'string', required: false, description: 'true to omit reference link URLs', defaultValue: 'true' },
      ],
      outputs: [{ name: 'result', type: 'array' }],
    },
    {
      key: 'get_record',
      name: 'Get Record',
      description: 'Get a single record by sys_id from any table',
      method: 'GET',
      pathTemplate: '/api/now/table/{{table}}/{{sys_id}}?sysparm_fields={{fields}}&sysparm_display_value={{display_value}}',
      inputs: [
        { name: 'table', type: 'string', required: true, description: 'Table name' },
        { name: 'sys_id', type: 'string', required: true, description: 'Record sys_id' },
        { name: 'fields', type: 'string', required: false, description: 'Fields to return' },
        { name: 'display_value', type: 'string', required: false, description: 'true/false/all', defaultValue: 'true' },
      ],
      outputs: [{ name: 'result', type: 'object' }],
    },
    {
      key: 'create_record',
      name: 'Create Record',
      description: 'Create a new record in any table',
      method: 'POST',
      pathTemplate: '/api/now/table/{{table}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{{record_json}}',
      inputs: [
        { name: 'table', type: 'string', required: true, description: 'Table name' },
        { name: 'record_json', type: 'object', required: true, description: 'JSON object with field values' },
      ],
      outputs: [{ name: 'result', type: 'object' }],
    },
    {
      key: 'update_record',
      name: 'Update Record',
      description: 'Update an existing record (PATCH — only specified fields)',
      method: 'PATCH',
      pathTemplate: '/api/now/table/{{table}}/{{sys_id}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{{record_json}}',
      inputs: [
        { name: 'table', type: 'string', required: true, description: 'Table name' },
        { name: 'sys_id', type: 'string', required: true, description: 'Record sys_id' },
        { name: 'record_json', type: 'object', required: true, description: 'JSON with fields to update' },
      ],
      outputs: [{ name: 'result', type: 'object' }],
    },
    {
      key: 'delete_record',
      name: 'Delete Record',
      description: 'Delete a record by sys_id',
      method: 'DELETE',
      pathTemplate: '/api/now/table/{{table}}/{{sys_id}}',
      inputs: [
        { name: 'table', type: 'string', required: true, description: 'Table name' },
        { name: 'sys_id', type: 'string', required: true, description: 'Record sys_id' },
      ],
      outputs: [{ name: 'status', type: 'number' }],
    },
    // ─── Incident shortcuts ───
    {
      key: 'create_incident',
      name: 'Create Incident',
      description: 'Create a new incident',
      method: 'POST',
      pathTemplate: '/api/now/table/incident',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"short_description":"{{short_description}}","description":{{description}},"urgency":{{urgency}},"impact":{{impact}},"category":{{category}},"assignment_group":{{assignment_group}},"assigned_to":{{assigned_to}},"caller_id":{{caller_id}}}',
      inputs: [
        { name: 'short_description', type: 'string', required: true, description: 'Incident title' },
        { name: 'description', type: 'string', required: false, description: 'Detailed description' },
        { name: 'urgency', type: 'number', required: false, description: '1=High, 2=Medium, 3=Low', defaultValue: '2' },
        { name: 'impact', type: 'number', required: false, description: '1=High, 2=Medium, 3=Low', defaultValue: '2' },
        { name: 'category', type: 'string', required: false, description: 'Category' },
        { name: 'assignment_group', type: 'string', required: false, description: 'Assignment group sys_id or name' },
        { name: 'assigned_to', type: 'string', required: false, description: 'Assigned user sys_id' },
        { name: 'caller_id', type: 'string', required: false, description: 'Caller user sys_id' },
      ],
      outputs: [{ name: 'result', type: 'object' }],
    },
    {
      key: 'resolve_incident',
      name: 'Resolve Incident',
      description: 'Resolve an incident with resolution notes',
      method: 'PATCH',
      pathTemplate: '/api/now/table/incident/{{sys_id}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"state":"6","close_code":"{{close_code}}","close_notes":"{{close_notes}}"}',
      inputs: [
        { name: 'sys_id', type: 'string', required: true, description: 'Incident sys_id' },
        { name: 'close_code', type: 'string', required: false, description: 'Resolution code (e.g. Solved (Permanently))', defaultValue: 'Solved (Permanently)' },
        { name: 'close_notes', type: 'string', required: true, description: 'Resolution notes' },
      ],
      outputs: [{ name: 'result', type: 'object' }],
    },
    {
      key: 'add_work_note',
      name: 'Add Work Note',
      description: 'Add an internal work note to a record (use Add Comment for customer-visible comments)',
      method: 'PATCH',
      pathTemplate: '/api/now/table/{{table}}/{{sys_id}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"work_notes":"{{note}}"}',
      inputs: [
        { name: 'table', type: 'string', required: false, description: 'Table name', defaultValue: 'incident' },
        { name: 'sys_id', type: 'string', required: true, description: 'Record sys_id' },
        { name: 'note', type: 'string', required: true, description: 'Work note text' },
      ],
      outputs: [{ name: 'result', type: 'object' }],
    },
    {
      key: 'add_comment',
      name: 'Add Comment',
      description: 'Add a customer-visible comment (additional comments) to a record',
      method: 'PATCH',
      pathTemplate: '/api/now/table/{{table}}/{{sys_id}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"comments":"{{comment}}"}',
      inputs: [
        { name: 'table', type: 'string', required: false, description: 'Table name', defaultValue: 'incident' },
        { name: 'sys_id', type: 'string', required: true, description: 'Record sys_id' },
        { name: 'comment', type: 'string', required: true, description: 'Comment text' },
      ],
      outputs: [{ name: 'result', type: 'object' }],
    },
    // ─── Attachment ───
    {
      key: 'upload_attachment',
      name: 'Upload Attachment',
      description: 'Attach a file to a record',
      method: 'POST',
      pathTemplate: '/api/now/attachment/file?table_name={{table}}&table_sys_id={{sys_id}}&file_name={{file_name}}',
      headers: { 'Content-Type': '{{content_type}}' },
      bodyTemplate: '{{content}}',
      inputs: [
        { name: 'table', type: 'string', required: true, description: 'Table name (e.g. incident)' },
        { name: 'sys_id', type: 'string', required: true, description: 'Record sys_id' },
        { name: 'file_name', type: 'string', required: true, description: 'Attachment filename' },
        { name: 'content', type: 'string', required: true, description: 'File content: a form attachment, a file URL, base64 or plain text' },
        { name: 'content_type', type: 'string', required: false, description: 'MIME type', defaultValue: 'application/octet-stream' },
      ],
      outputs: [{ name: 'result', type: 'object' }],
    },
    // ─── Aggregate ───
    {
      key: 'aggregate',
      name: 'Aggregate Query',
      description: 'Run aggregate queries (COUNT, SUM, AVG, MIN, MAX) on a table',
      method: 'GET',
      pathTemplate: '/api/now/stats/{{table}}?sysparm_query={{query}}&sysparm_count=true&sysparm_group_by={{group_by}}&sysparm_avg_fields={{avg_fields}}&sysparm_sum_fields={{sum_fields}}&sysparm_min_fields={{min_fields}}&sysparm_max_fields={{max_fields}}',
      inputs: [
        { name: 'table', type: 'string', required: true, description: 'Table name' },
        { name: 'query', type: 'string', required: false, description: 'Filter query' },
        { name: 'group_by', type: 'string', required: false, description: 'Group by field' },
        { name: 'avg_fields', type: 'string', required: false, description: 'Fields to average' },
        { name: 'sum_fields', type: 'string', required: false, description: 'Fields to sum' },
        { name: 'min_fields', type: 'string', required: false, description: 'Fields to take the minimum of' },
        { name: 'max_fields', type: 'string', required: false, description: 'Fields to take the maximum of' },
      ],
      outputs: [{ name: 'result', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (config, credentials) => {
    const baseUrl = servicenowBaseUrl(config.instance)
    if (credentials.auth_type === 'bearer') {
      if (credentials.refresh_token && credentials.client_id) {
        return {
          base_url: baseUrl,
          auth_type: 'bearer',
          auth_config: {
            _executor: 'oauth_refresh',
            token: credentials.token || '',
            refresh_token: credentials.refresh_token,
            client_id: credentials.client_id,
            client_secret: credentials.client_secret || '',
            token_url: `${baseUrl}/oauth_token.do`,
          },
        }
      }
      return {
        base_url: baseUrl,
        auth_type: 'bearer',
        auth_config: { token: credentials.token || '' },
      }
    }
    return {
      base_url: baseUrl,
      auth_type: 'basic',
      auth_config: {
        username: credentials.username || '',
        password: credentials.password || '',
      },
    }
  },
}
