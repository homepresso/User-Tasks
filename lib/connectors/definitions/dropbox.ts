import type { ConnectorDefinition } from '../registry'

/** Upload / download endpoints live on the content host. */
const DROPBOX_CONTENT_BASE = 'https://content.dropboxapi.com'
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'

export const dropboxConnector: ConnectorDefinition = {
  key: 'dropbox',
  name: 'Dropbox',
  description: 'Upload, download, search, share files, and manage folders in Dropbox',
  category: 'cloud',
  icon: 'Inbox',
  color: '#0061FF',
  docsUrl: 'https://www.dropbox.com/developers/documentation/http/documentation',
  fields: [],
  credentialFields: [
    {
      key: 'access_token',
      label: 'Access Token',
      type: 'password',
      required: true,
      helpText: 'OAuth2 access token from the Dropbox App Console. New tokens expire after 4 hours — add the refresh token, app key and app secret so the connector renews them.',
    },
    {
      key: 'refresh_token',
      label: 'Refresh Token (optional)',
      type: 'password',
      helpText: 'For automatic token refresh with short-lived tokens',
    },
    {
      key: 'app_key',
      label: 'App Key (optional)',
      type: 'text',
      visibleWhen: { field: 'refresh_token', notEquals: '' },
      requiredWhen: { field: 'refresh_token', notEquals: '' },
      helpText: 'Required for token refresh',
    },
    {
      key: 'app_secret',
      label: 'App Secret (optional)',
      type: 'password',
      visibleWhen: { field: 'refresh_token', notEquals: '' },
      requiredWhen: { field: 'refresh_token', notEquals: '' },
      helpText: 'Required for token refresh',
    },
    {
      key: 'team_member_id',
      label: 'Team Member ID (optional)',
      type: 'text',
      helpText: 'Team (business) apps: act as this member (Dropbox-API-Select-User)',
    },
  ],
  oauth: {
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    defaultScopes: ['files.content.read', 'files.content.write', 'sharing.write', 'account_info.read'],
    // Dropbox returns a refresh token only when offline access is requested.
    extraAuthorizeParams: { token_access_type: 'offline' },
  },
  referenceTemplates: [
    {
      key: 'list_folder',
      name: 'List Folder',
      description: 'List files and folders in a path ("" = root). While has_more is true, call List Folder Continue with cursor.',
      method: 'POST',
      pathTemplate: '/2/files/list_folder',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"path": "{{path}}", "recursive": {{recursive}}, "limit": {{limit}}, "include_deleted": false}',
      inputs: [
        { name: 'path', type: 'string', required: false, description: 'Folder path (e.g. /Documents; empty for the root)' },
        { name: 'recursive', type: 'boolean', required: false, description: 'Include all subfolders', defaultValue: 'false' },
        { name: 'limit', type: 'number', required: false, description: 'Approximate max entries per page (1-2000)', defaultValue: '100' },
      ],
      outputs: [{ name: 'entries', type: 'array' }, { name: 'has_more', type: 'boolean' }, { name: 'cursor', type: 'string' }],
    },
    {
      key: 'list_folder_continue',
      name: 'List Folder Continue',
      description: 'Next page of a folder listing (cursor from List Folder or the previous page)',
      method: 'POST',
      pathTemplate: '/2/files/list_folder/continue',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"cursor": "{{cursor}}"}',
      inputs: [
        { name: 'cursor', type: 'string', required: true, description: 'Cursor from the previous response' },
      ],
      outputs: [{ name: 'entries', type: 'array' }, { name: 'has_more', type: 'boolean' }, { name: 'cursor', type: 'string' }],
    },
    {
      key: 'get_metadata',
      name: 'Get File/Folder Metadata',
      description: 'Get metadata for a file or folder',
      method: 'POST',
      pathTemplate: '/2/files/get_metadata',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"path": "{{path}}", "include_media_info": true}',
      inputs: [
        { name: 'path', type: 'string', required: true, description: 'File or folder path, or id:… / rev:…' },
      ],
      outputs: [{ name: '.tag', type: 'string' }, { name: 'id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'path_display', type: 'string' }, { name: 'size', type: 'number' }, { name: 'rev', type: 'string' }],
    },
    {
      key: 'download',
      name: 'Download File',
      description: 'Download a file as a workflow file',
      method: 'POST',
      baseUrl: DROPBOX_CONTENT_BASE,
      pathTemplate: '/2/files/download',
      // Content endpoints refuse application/json; the argument travels in Dropbox-API-Arg.
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Dropbox-API-Arg': '{"path": "{{path}}"}' },
      inputs: [
        { name: 'path', type: 'string', required: true, description: 'File path (e.g. /Documents/report.pdf) or id:…', location: 'header' },
      ],
      outputs: [{ name: 'name', type: 'string' }, { name: 'url', type: 'string' }, { name: 'size', type: 'number' }, { name: 'content_type', type: 'string' }],
    },
    {
      key: 'upload',
      name: 'Upload File',
      description: 'Upload a file (up to 50 MB through workflows). mode add + autorename false fails (409) instead of overwriting.',
      method: 'POST',
      baseUrl: DROPBOX_CONTENT_BASE,
      pathTemplate: '/2/files/upload',
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': '{"path": "{{path}}", "mode": "{{mode}}", "autorename": {{autorename}}, "mute": false}' },
      bodyTemplate: '{{content}}',
      inputs: [
        { name: 'path', type: 'string', required: true, description: 'Destination path (e.g. /Documents/report.pdf)', location: 'header' },
        { name: 'content', type: 'string', required: true, description: 'File content: an attachment from a form or a previous step, a file URL, base64, or text', location: 'body' },
        { name: 'mode', type: 'string', required: false, description: 'add (never overwrite) or overwrite', defaultValue: 'add', location: 'header' },
        { name: 'autorename', type: 'boolean', required: false, description: 'On a name conflict (mode add) save as "name (1)" instead of failing', defaultValue: 'false', location: 'header' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'path_display', type: 'string' }, { name: 'rev', type: 'string' }, { name: 'size', type: 'number' }],
    },
    {
      key: 'delete',
      name: 'Delete File/Folder',
      description: 'Delete a file or folder (recoverable for the account\'s version-history period)',
      method: 'POST',
      pathTemplate: '/2/files/delete_v2',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"path": "{{path}}", "parent_rev": {{parent_rev}}}',
      inputs: [
        { name: 'path', type: 'string', required: true, description: 'Path to delete' },
        { name: 'parent_rev', type: 'string', required: false, description: 'Only delete if the file is still at this rev' },
      ],
      outputs: [{ name: 'metadata', type: 'object' }],
    },
    {
      key: 'move',
      name: 'Move File/Folder',
      description: 'Move or rename a file or folder',
      method: 'POST',
      pathTemplate: '/2/files/move_v2',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"from_path": "{{from_path}}", "to_path": "{{to_path}}", "autorename": {{autorename}}}',
      inputs: [
        { name: 'from_path', type: 'string', required: true, description: 'Source path' },
        { name: 'to_path', type: 'string', required: true, description: 'Destination path' },
        { name: 'autorename', type: 'boolean', required: false, description: 'Rename instead of failing on a conflict', defaultValue: 'false' },
      ],
      outputs: [{ name: 'metadata', type: 'object' }],
    },
    {
      key: 'copy',
      name: 'Copy File/Folder',
      description: 'Copy a file or folder',
      method: 'POST',
      pathTemplate: '/2/files/copy_v2',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"from_path": "{{from_path}}", "to_path": "{{to_path}}", "autorename": {{autorename}}}',
      inputs: [
        { name: 'from_path', type: 'string', required: true, description: 'Source path' },
        { name: 'to_path', type: 'string', required: true, description: 'Destination path' },
        { name: 'autorename', type: 'boolean', required: false, description: 'Rename instead of failing on a conflict', defaultValue: 'false' },
      ],
      outputs: [{ name: 'metadata', type: 'object' }],
    },
    {
      key: 'create_folder',
      name: 'Create Folder',
      description: 'Create a new folder (409 path/conflict if it exists)',
      method: 'POST',
      pathTemplate: '/2/files/create_folder_v2',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"path": "{{path}}", "autorename": false}',
      inputs: [
        { name: 'path', type: 'string', required: true, description: 'Folder path to create' },
      ],
      outputs: [{ name: 'metadata', type: 'object' }],
    },
    {
      key: 'search',
      name: 'Search Files',
      description: 'Search for files and folders. While has_more is true, call Search Continue with cursor.',
      method: 'POST',
      pathTemplate: '/2/files/search_v2',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"query": "{{query}}", "options": {"path": {{search_path}}, "max_results": {{max_results}}, "file_extensions": {{extensions}}}}',
      inputs: [
        { name: 'query', type: 'string', required: true, description: 'Search query' },
        { name: 'search_path', type: 'string', required: false, description: 'Limit search to this folder path' },
        { name: 'extensions', type: 'array', required: false, description: 'JSON array of extensions (e.g. ["pdf","docx"])' },
        { name: 'max_results', type: 'number', required: false, description: 'Max results per page (1-1000)', defaultValue: '20' },
      ],
      outputs: [{ name: 'matches', type: 'array' }, { name: 'has_more', type: 'boolean' }, { name: 'cursor', type: 'string' }],
    },
    {
      key: 'search_continue',
      name: 'Search Continue',
      description: 'Next page of search results',
      method: 'POST',
      pathTemplate: '/2/files/search/continue_v2',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"cursor": "{{cursor}}"}',
      inputs: [
        { name: 'cursor', type: 'string', required: true, description: 'Cursor from the previous search response' },
      ],
      outputs: [{ name: 'matches', type: 'array' }, { name: 'has_more', type: 'boolean' }, { name: 'cursor', type: 'string' }],
    },
    {
      key: 'create_shared_link',
      name: 'Create Shared Link',
      description: 'Create a shared link for a file or folder (409 shared_link_already_exists if one exists — use List Shared Links)',
      method: 'POST',
      pathTemplate: '/2/sharing/create_shared_link_with_settings',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"path": "{{path}}", "settings": {"requested_visibility": {{visibility}}, "expires": {{expires}}}}',
      inputs: [
        { name: 'path', type: 'string', required: true, description: 'File or folder path' },
        { name: 'visibility', type: 'string', required: false, description: 'public or team_only (team accounts)', defaultValue: 'public' },
        { name: 'expires', type: 'string', required: false, description: 'Optional expiry (e.g. 2026-12-31T00:00:00Z; paid accounts)' },
      ],
      outputs: [{ name: 'url', type: 'string' }, { name: 'name', type: 'string' }, { name: 'path_lower', type: 'string' }],
    },
    {
      key: 'list_shared_links',
      name: 'List Shared Links',
      description: 'Existing shared links for a path (direct_only)',
      method: 'POST',
      pathTemplate: '/2/sharing/list_shared_links',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"path": "{{path}}", "direct_only": true}',
      inputs: [
        { name: 'path', type: 'string', required: true, description: 'File or folder path' },
      ],
      outputs: [{ name: 'links', type: 'array' }, { name: 'has_more', type: 'boolean' }, { name: 'cursor', type: 'string' }],
    },
    {
      key: 'get_account',
      name: 'Get Current Account',
      description: 'Get info about the authenticated user',
      method: 'POST',
      pathTemplate: '/2/users/get_current_account',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: 'null',
      inputs: [],
      outputs: [{ name: 'account_id', type: 'string' }, { name: 'name', type: 'object' }, { name: 'email', type: 'string' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => {
    const refreshToken = String(credentials.refresh_token ?? '').trim()
    const appKey = String(credentials.app_key ?? '').trim()
    const appSecret = String(credentials.app_secret ?? '')
    const teamMember = String(credentials.team_member_id ?? '').trim()
    const headers = teamMember ? { 'Dropbox-API-Select-User': teamMember } : undefined
    if (refreshToken && appKey && appSecret) {
      // Short-lived tokens (4 h) are refreshed from the stored refresh token.
      return {
        base_url: 'https://api.dropboxapi.com',
        auth_type: 'bearer',
        auth_config: {
          token: credentials.access_token || '',
          _executor: 'oauth_refresh',
          token_url: DROPBOX_TOKEN_URL,
          refresh_token: refreshToken,
          client_id: appKey,
          client_secret: appSecret,
        },
        ...(headers ? { headers } : {}),
      }
    }
    return {
      base_url: 'https://api.dropboxapi.com',
      auth_type: 'bearer',
      auth_config: { token: credentials.access_token || '' },
      ...(headers ? { headers } : {}),
    }
  },
}
