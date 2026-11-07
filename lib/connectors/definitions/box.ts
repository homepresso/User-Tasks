import type { ConnectorDefinition } from '../registry'

/** Box serves uploads from a separate host. */
const BOX_UPLOAD_BASE = 'https://upload.box.com/api'

export const boxConnector: ConnectorDefinition = {
  key: 'box',
  name: 'Box',
  description: 'Cloud content management — upload, download, search, share files, and manage folders in Box',
  category: 'cloud',
  icon: 'Archive',
  color: '#0061D5',
  docsUrl: 'https://developer.box.com/reference/',
  recommendedPermissions: {
    title: 'Box app setup',
    items: ['Server Authentication (Client Credentials Grant)', 'Read and write all files and folders', 'Manage users (only for As-User)'],
    note: 'Authorise the app in the Box Admin Console. The token acts as the app\'s Service Account unless Box User ID is set (then as that managed or app user). As-User additionally needs the "Make API calls using the as-user header" advanced feature.',
  },
  fields: [],
  credentialFields: [
    {
      key: 'auth_type',
      label: 'Authentication Type',
      type: 'select',
      options: [
        { value: 'developer_token', label: 'Developer Token (testing only — expires after 60 minutes)' },
        { value: 'client_credentials', label: 'Client Credentials (server-to-server)' },
      ],
      required: true,
      defaultValue: 'developer_token',
    },
    {
      key: 'access_token',
      label: 'Developer Token / Access Token',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'developer_token' },
      requiredWhen: { field: 'auth_type', equals: 'developer_token' },
      helpText: 'Developer token from the Box Developer Console (valid 60 minutes) — use Client Credentials for anything long-lived',
    },
    {
      key: 'client_id',
      label: 'Client ID',
      type: 'text',
      visibleWhen: { field: 'auth_type', equals: 'client_credentials' },
      requiredWhen: { field: 'auth_type', equals: 'client_credentials' },
      helpText: 'For Client Credentials auth',
    },
    {
      key: 'client_secret',
      label: 'Client Secret',
      type: 'password',
      visibleWhen: { field: 'auth_type', equals: 'client_credentials' },
      requiredWhen: { field: 'auth_type', equals: 'client_credentials' },
      helpText: 'For Client Credentials auth',
    },
    {
      key: 'enterprise_id',
      label: 'Enterprise ID',
      type: 'text',
      visibleWhen: { field: 'auth_type', equals: 'client_credentials' },
      requiredWhen: { field: 'auth_type', equals: 'client_credentials' },
      helpText: 'Required for Client Credentials (server-to-server) auth',
    },
    {
      key: 'box_user_id',
      label: 'Box User ID (optional)',
      type: 'text',
      visibleWhen: { field: 'auth_type', equals: 'client_credentials' },
      helpText: 'Mint tokens for this managed or app user instead of the app\'s Service Account',
    },
    {
      key: 'as_user_id',
      label: 'As-User ID (optional)',
      type: 'text',
      helpText: 'Send every call with the As-User header (act on behalf of this user; needs admin-approved As-User permission)',
    },
  ],
  referenceTemplates: [
    // ─── Files ───
    {
      key: 'get_file_info',
      name: 'Get File Info',
      description: 'Retrieve metadata for a file by ID',
      method: 'GET',
      pathTemplate: '/2.0/files/{{file_id}}?fields={{fields}}',
      inputs: [
        { name: 'file_id', type: 'string', required: true, description: 'Box file ID' },
        { name: 'fields', type: 'string', required: false, description: 'Comma-separated fields (e.g. id,name,size,modified_at,shared_link)' },
      ],
      outputs: [
        { name: 'id', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'size', type: 'number' },
        { name: 'modified_at', type: 'string' },
      ],
    },
    {
      key: 'download_file',
      name: 'Download File',
      description: 'Download a file as a workflow file',
      method: 'GET',
      pathTemplate: '/2.0/files/{{file_id}}/content',
      inputs: [
        { name: 'file_id', type: 'string', required: true, description: 'Box file ID' },
      ],
      outputs: [
        { name: 'name', type: 'string' },
        { name: 'url', type: 'string' },
        { name: 'size', type: 'number' },
        { name: 'content_type', type: 'string' },
      ],
    },
    {
      key: 'upload_file',
      name: 'Upload File',
      description: 'Upload a workflow file (a form attachment, up to 50 MB) as a new file in a folder. Fails with 409 item_name_in_use if the name exists — use Upload New Version.',
      method: 'POST',
      baseUrl: BOX_UPLOAD_BASE,
      pathTemplate: '/2.0/files/content',
      headers: { 'Content-Type': 'multipart/form-data' },
      // attributes before file (Box requires that order; the multipart builder keeps it).
      bodyTemplate: '{"attributes": {"name": "{{file_name}}", "parent": {"id": "{{folder_id}}"}}, "file": "{{content}}"}',
      inputs: [
        { name: 'content', type: 'string', required: true, description: 'The file to upload (an attachment from a form or a previous step)' },
        { name: 'file_name', type: 'string', required: true, description: 'Name for the uploaded file' },
        { name: 'folder_id', type: 'string', required: false, description: 'Parent folder ID (0 = root)', defaultValue: '0' },
      ],
      outputs: [
        { name: 'entries', type: 'array' },
        { name: 'total_count', type: 'number' },
      ],
    },
    {
      key: 'upload_file_version',
      name: 'Upload New Version',
      description: 'Upload a workflow file (up to 50 MB) as a new version of an existing file',
      method: 'POST',
      baseUrl: BOX_UPLOAD_BASE,
      pathTemplate: '/2.0/files/{{file_id}}/content',
      headers: { 'Content-Type': 'multipart/form-data' },
      bodyTemplate: '{"attributes": {}, "file": "{{content}}"}',
      inputs: [
        { name: 'file_id', type: 'string', required: true, description: 'Box file ID' },
        { name: 'content', type: 'string', required: true, description: 'The new file contents (an attachment from a form or a previous step)' },
      ],
      outputs: [
        { name: 'entries', type: 'array' },
        { name: 'total_count', type: 'number' },
      ],
    },
    {
      key: 'update_file',
      name: 'Update File Info',
      description: 'Update file metadata (rename, move, description, tags)',
      method: 'PUT',
      pathTemplate: '/2.0/files/{{file_id}}',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{{update_json}}',
      inputs: [
        { name: 'file_id', type: 'string', required: true, description: 'Box file ID' },
        { name: 'update_json', type: 'object', required: true, description: 'JSON with fields to update (e.g. {"name":"new.pdf","description":"Updated"} or {"parent":{"id":"123"}} to move)' },
      ],
      outputs: [
        { name: 'id', type: 'string' },
        { name: 'name', type: 'string' },
      ],
    },
    {
      key: 'delete_file',
      name: 'Delete File',
      description: 'Move a file to trash',
      method: 'DELETE',
      pathTemplate: '/2.0/files/{{file_id}}',
      inputs: [
        { name: 'file_id', type: 'string', required: true, description: 'Box file ID' },
      ],
      outputs: [],
    },
    {
      key: 'copy_file',
      name: 'Copy File',
      description: 'Copy a file to another folder',
      method: 'POST',
      pathTemplate: '/2.0/files/{{file_id}}/copy',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"parent": {"id": "{{target_folder_id}}"}, "name": {{new_name}}}',
      inputs: [
        { name: 'file_id', type: 'string', required: true, description: 'Source file ID' },
        { name: 'target_folder_id', type: 'string', required: true, description: 'Destination folder ID' },
        { name: 'new_name', type: 'string', required: false, description: 'Optional new filename' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }],
    },
    {
      key: 'create_shared_link',
      name: 'Create Shared Link',
      description: 'Create or update a shared link for a file',
      method: 'PUT',
      pathTemplate: '/2.0/files/{{file_id}}?fields=shared_link',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"shared_link": {"access": "{{access}}", "password": {{password}}, "unshared_at": {{expires_at}}}}',
      inputs: [
        { name: 'file_id', type: 'string', required: true, description: 'Box file ID' },
        { name: 'access', type: 'string', required: false, description: 'Access level: open, company, collaborators', defaultValue: 'open' },
        { name: 'password', type: 'string', required: false, description: 'Optional password (open links only)' },
        { name: 'expires_at', type: 'string', required: false, description: 'Optional expiry (ISO 8601; paid accounts)' },
      ],
      outputs: [{ name: 'shared_link', type: 'object' }],
    },
    // ─── Folders ───
    {
      key: 'list_folder',
      name: 'List Folder Items',
      description: 'List files and subfolders in a folder (marker paging: pass marker = the previous next_marker until it is empty)',
      method: 'GET',
      pathTemplate: '/2.0/folders/{{folder_id}}/items?fields={{fields}}&limit={{limit}}&usemarker=true&marker={{marker}}',
      inputs: [
        { name: 'folder_id', type: 'string', required: true, description: 'Folder ID (0 = root)' },
        { name: 'fields', type: 'string', required: false, description: 'Fields to return', defaultValue: 'id,name,type,size,modified_at' },
        { name: 'limit', type: 'number', required: false, description: 'Items per page (max 1000)', defaultValue: '100' },
        { name: 'marker', type: 'string', required: false, description: 'next_marker from the previous page' },
      ],
      outputs: [
        { name: 'entries', type: 'array' },
        { name: 'next_marker', type: 'string' },
        { name: 'limit', type: 'number' },
      ],
    },
    {
      key: 'create_folder',
      name: 'Create Folder',
      description: 'Create a new folder',
      method: 'POST',
      pathTemplate: '/2.0/folders',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"name": "{{folder_name}}", "parent": {"id": "{{parent_id}}"}}',
      inputs: [
        { name: 'folder_name', type: 'string', required: true, description: 'Folder name' },
        { name: 'parent_id', type: 'string', required: false, description: 'Parent folder ID', defaultValue: '0' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'name', type: 'string' }],
    },
    {
      key: 'delete_folder',
      name: 'Delete Folder',
      description: 'Move a folder to trash (a non-empty folder needs recursive = true)',
      method: 'DELETE',
      pathTemplate: '/2.0/folders/{{folder_id}}?recursive={{recursive}}',
      inputs: [
        { name: 'folder_id', type: 'string', required: true, description: 'Folder ID' },
        { name: 'recursive', type: 'boolean', required: false, description: 'Also trash the contents', defaultValue: 'false' },
      ],
      outputs: [],
    },
    // ─── Search ───
    {
      key: 'search',
      name: 'Search Content',
      description: 'Search for files and folders across Box (offset paging: offset + limit, up to total_count)',
      method: 'GET',
      pathTemplate: '/2.0/search?query={{query}}&type={{type}}&file_extensions={{extensions}}&ancestor_folder_ids={{folder_ids}}&limit={{limit}}&offset={{offset}}',
      inputs: [
        { name: 'query', type: 'string', required: true, description: 'Search query' },
        { name: 'type', type: 'string', required: false, description: 'Filter by type: file, folder, web_link' },
        { name: 'extensions', type: 'string', required: false, description: 'Comma-separated file extensions (e.g. pdf,docx)' },
        { name: 'folder_ids', type: 'string', required: false, description: 'Limit to specific folder IDs (comma-separated)' },
        { name: 'limit', type: 'number', required: false, description: 'Max results', defaultValue: '30' },
        { name: 'offset', type: 'number', required: false, description: 'Offset', defaultValue: '0' },
      ],
      outputs: [
        { name: 'entries', type: 'array' },
        { name: 'total_count', type: 'number' },
        { name: 'offset', type: 'number' },
      ],
    },
    // ─── Users ───
    {
      key: 'get_current_user',
      name: 'Get Current User',
      description: 'Get info about the authenticated user',
      method: 'GET',
      pathTemplate: '/2.0/users/me',
      inputs: [],
      outputs: [
        { name: 'id', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'login', type: 'string' },
      ],
    },
    // ─── Collaborations ───
    {
      key: 'add_collaborator',
      name: 'Add Collaborator',
      description: 'Invite a user to collaborate on a file or folder',
      method: 'POST',
      pathTemplate: '/2.0/collaborations',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"item": {"type": "{{item_type}}", "id": "{{item_id}}"}, "accessible_by": {"type": "user", "login": "{{email}}"}, "role": "{{role}}"}',
      inputs: [
        { name: 'item_type', type: 'string', required: true, description: 'Item type: file or folder' },
        { name: 'item_id', type: 'string', required: true, description: 'File or folder ID' },
        { name: 'email', type: 'string', required: true, description: 'Collaborator email' },
        { name: 'role', type: 'string', required: false, description: 'editor, viewer, previewer, uploader, previewer uploader, viewer uploader, or co-owner', defaultValue: 'editor' },
      ],
      outputs: [{ name: 'id', type: 'string' }, { name: 'role', type: 'string' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => {
    const ccg = credentials.auth_type === 'client_credentials'
    const asUser = String(credentials.as_user_id ?? '').trim()
    const boxUser = String(credentials.box_user_id ?? '').trim()
    return {
      base_url: 'https://api.box.com',
      auth_type: 'bearer',
      auth_config: {
        token: ccg ? '' : credentials.access_token || '',
        _executor: ccg ? 'box_ccg' : undefined,
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        enterprise_id: credentials.enterprise_id,
        ...(ccg && boxUser ? { box_subject_type: 'user', box_subject_id: boxUser } : {}),
      },
      ...(asUser ? { headers: { 'As-User': asUser } } : {}),
    }
  },
}
