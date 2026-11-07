import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hash } from '@smithy/hash-node'
import { HttpRequest } from '@smithy/protocol-http'
import { SignatureV4 } from '@smithy/signature-v4'

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))
// Records the unmasked headers each connector request is sent with (the
// harness masks credentials), so Shared Key signatures can be verified.
const sentHeaders = vi.hoisted(() => [] as Record<string, string>[])
vi.mock('@/lib/integrations/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/integrations/http')>()
  return {
    ...actual,
    connectorFetch: (url: string, init: RequestInit = {}, options?: any) => {
      sentHeaders.push({ ...(init.headers as Record<string, string> ?? {}) })
      return actual.connectorFetch(url, init, options)
    },
  }
})

import { runConnectorTemplate, type RecordedRequest } from './helpers/connector-contract'
import { getConnectorDefinition } from '@/lib/connectors/registry'
import { encodeKey, executeS3Request, isValidBucketName, s3Endpoint } from '@/lib/aws-s3-executor'

/**
 * Contract tests for the Microsoft 365 / Azure / AWS storage connectors:
 * exchange_online, ms_teams, ms_dataverse, onedrive_business, sharepoint,
 * azure_blob, azure_openai, aws_s3 (+ lib/aws-s3-executor). Every template
 * is run through the real runtime with fetch replaced; the exact request is
 * asserted. All credentials are obviously fake.
 */

const GRAPH = 'https://graph.microsoft.com'
const WEBHOOK = 'https://prod-00.westus.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=FAKE_SIG_value'
const S3_CREDS = { access_key_id: 'AKIDEXAMPLE', secret_access_key: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', session_token: '' }
const AZ_KEY = Buffer.from('fake-azure-storage-account-key').toString('base64')

const CONFIG: Record<string, { config?: Record<string, any>; credentials?: Record<string, any> }> = {
  exchange_online: { config: { tenant_id: '11111111-2222-3333-4444-555555555555' }, credentials: { client_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', client_secret: 'fake-client-secret' } },
  onedrive_business: { config: { tenant_id: '11111111-2222-3333-4444-555555555555' } },
  sharepoint: { config: { tenant_id: '11111111-2222-3333-4444-555555555555', site_id: 'contoso.sharepoint.com:/sites/Ops:' } },
  ms_dataverse: { config: { environment_url: 'https://contoso.crm.dynamics.com/', tenant_id: '11111111-2222-3333-4444-555555555555' } },
  ms_teams: { credentials: { webhook_url: WEBHOOK } },
  azure_blob: { config: { account_name: 'contosostore', container: 'docs' }, credentials: { sas_token: '', account_key: AZ_KEY } },
  azure_openai: { config: { resource_name: 'contoso-ai', deployment_name: 'gpt-4o-prod' }, credentials: { api_key: 'fake-azure-openai-key' } },
  aws_s3: { config: { region: 'eu-west-1', bucket: 'example-bucket' }, credentials: S3_CREDS },
}

function run(connector: string, template: string, inputs: Record<string, any> = {}, extra: Partial<Parameters<typeof runConnectorTemplate>[0]> = {}) {
  const base = CONFIG[connector] ?? {}
  return runConnectorTemplate({
    connector,
    template,
    inputs,
    config: { ...(base.config ?? {}), ...(extra.config ?? {}) },
    credentials: { ...(base.credentials ?? {}), ...(extra.credentials ?? {}) },
    respond: extra.respond,
    mutateReference: extra.mutateReference,
  })
}

const S3_LIST_XML = '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>example-bucket</Name><Prefix>in/</Prefix><KeyCount>1</KeyCount><IsTruncated>true</IsTruncated><NextContinuationToken>tok+/=next</NextContinuationToken><Contents><Key>in/a &amp; b.txt</Key><Size>3</Size><ETag>"abc"</ETag><StorageClass>STANDARD</StorageClass></Contents><CommonPrefixes><Prefix>in/sub/</Prefix></CommonPrefixes></ListBucketResult>'

// ─── Every template: method + URL ───

type Case = { connector: string; template: string; inputs: Record<string, any>; method: string; url: string; body?: unknown; headers?: Record<string, string> }

const CASES: Case[] = [
  // Exchange Online
  { connector: 'exchange_online', template: 'send_mail', inputs: { from_email: 'ops@example.com', to_email: 'a@example.com', subject: 'Hi', body: '<p>x</p>' }, method: 'POST', url: `${GRAPH}/v1.0/users/ops@example.com/sendMail`,
    body: { message: { subject: 'Hi', body: { contentType: 'HTML', content: '<p>x</p>' }, toRecipients: [{ emailAddress: { address: 'a@example.com' } }] }, saveToSentItems: true } },
  { connector: 'exchange_online', template: 'list_messages', inputs: { email: 'ops@example.com' }, method: 'GET', url: `${GRAPH}/v1.0/users/ops@example.com/mailFolders/inbox/messages?$select=subject,from,receivedDateTime,isRead,bodyPreview&$top=25` },
  { connector: 'exchange_online', template: 'get_message', inputs: { email: 'ops@example.com', message_id: 'AAMk=' }, method: 'GET', url: `${GRAPH}/v1.0/users/ops@example.com/messages/AAMk=` },
  { connector: 'exchange_online', template: 'reply_to_message', inputs: { email: 'ops@example.com', message_id: 'm1', reply_body: 'Thanks' }, method: 'POST', url: `${GRAPH}/v1.0/users/ops@example.com/messages/m1/reply`, body: { message: { body: { contentType: 'HTML', content: 'Thanks' } } } },
  { connector: 'exchange_online', template: 'delete_message', inputs: { email: 'ops@example.com', message_id: 'm1' }, method: 'DELETE', url: `${GRAPH}/v1.0/users/ops@example.com/messages/m1` },
  { connector: 'exchange_online', template: 'list_events', inputs: { email: 'ops@example.com', start: '2026-11-01T00:00:00+13:00', end: '2026-11-02T00:00:00Z' }, method: 'GET',
    url: `${GRAPH}/v1.0/users/ops@example.com/calendarView?startDateTime=2026-11-01T00:00:00%2B13:00&endDateTime=2026-11-02T00:00:00Z&$select=subject,start,end,organizer,location,isAllDay&$top=50&$orderby=start/dateTime`,
    headers: { prefer: 'outlook.timezone="UTC"' } },
  { connector: 'exchange_online', template: 'create_event', inputs: { email: 'ops@example.com', subject: 'Sync', start_time: '2026-11-01T09:00:00', end_time: '2026-11-01T10:00:00', attendees: [{ emailAddress: { address: 'b@example.com' }, type: 'required' }], is_online_meeting: true }, method: 'POST', url: `${GRAPH}/v1.0/users/ops@example.com/events`,
    body: { subject: 'Sync', body: { contentType: 'HTML', content: '' }, start: { dateTime: '2026-11-01T09:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-11-01T10:00:00', timeZone: 'UTC' }, location: { displayName: '' }, attendees: [{ emailAddress: { address: 'b@example.com' }, type: 'required' }], isOnlineMeeting: true } },
  { connector: 'exchange_online', template: 'delete_event', inputs: { email: 'ops@example.com', event_id: 'e1' }, method: 'DELETE', url: `${GRAPH}/v1.0/users/ops@example.com/events/e1` },
  { connector: 'exchange_online', template: 'list_contacts', inputs: { email: 'ops@example.com' }, method: 'GET', url: `${GRAPH}/v1.0/users/ops@example.com/contacts?$select=displayName,emailAddresses,businessPhones,companyName&$top=50` },
  { connector: 'exchange_online', template: 'create_contact', inputs: { email: 'ops@example.com', contact_json: '{"givenName":"Ana"}' }, method: 'POST', url: `${GRAPH}/v1.0/users/ops@example.com/contacts`, body: { givenName: 'Ana' } },
  // Teams
  { connector: 'ms_teams', template: 'send_message', inputs: { title: 'Build', message: 'Done' }, method: 'POST', url: WEBHOOK },
  { connector: 'ms_teams', template: 'send_adaptive_card', inputs: { card_json: '{"type":"AdaptiveCard","version":"1.4","body":[]}' }, method: 'POST', url: WEBHOOK,
    body: { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: { type: 'AdaptiveCard', version: '1.4', body: [] } }] } },
  // Dataverse
  { connector: 'ms_dataverse', template: 'query_table', inputs: { table_name: 'accounts', filter: "name eq 'O''Brien & Co'" }, method: 'GET',
    url: "https://contoso.crm.dynamics.com/api/data/v9.2/accounts?$filter=name%20eq%20'O''Brien%20%26%20Co'",
    headers: { prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=500', 'odata-maxversion': '4.0', 'odata-version': '4.0', accept: 'application/json' } },
  { connector: 'ms_dataverse', template: 'get_row', inputs: { table_name: 'accounts', row_id: '00000000-0000-0000-0000-000000000001' }, method: 'GET', url: 'https://contoso.crm.dynamics.com/api/data/v9.2/accounts(00000000-0000-0000-0000-000000000001)' },
  { connector: 'ms_dataverse', template: 'create_row', inputs: { table_name: 'accounts', row_json: { name: 'Contoso' } }, method: 'POST', url: 'https://contoso.crm.dynamics.com/api/data/v9.2/accounts', body: { name: 'Contoso' }, headers: { prefer: 'return=representation' } },
  { connector: 'ms_dataverse', template: 'update_row', inputs: { table_name: 'accounts', row_id: 'r1', row_json: { name: 'C2' } }, method: 'PATCH', url: 'https://contoso.crm.dynamics.com/api/data/v9.2/accounts(r1)', body: { name: 'C2' }, headers: { 'if-match': '*' } },
  { connector: 'ms_dataverse', template: 'delete_row', inputs: { table_name: 'accounts', row_id: 'r1' }, method: 'DELETE', url: 'https://contoso.crm.dynamics.com/api/data/v9.2/accounts(r1)' },
  { connector: 'ms_dataverse', template: 'batch_request', inputs: { batch_id: 'b1', batch_body: '--batch_b1\r\n--batch_b1--' }, method: 'POST', url: 'https://contoso.crm.dynamics.com/api/data/v9.2/$batch', headers: { 'content-type': 'multipart/mixed;boundary=batch_b1' } },
  // OneDrive
  { connector: 'onedrive_business', template: 'list_files', inputs: { user: 'u@example.com', path: '/Documents/Q4 Reports' }, method: 'GET', url: `${GRAPH}/v1.0/users/u@example.com/drive/root:/Documents/Q4%20Reports:/children?$select=id,name,size,webUrl,createdDateTime,lastModifiedDateTime,file,folder&$top=100` },
  { connector: 'onedrive_business', template: 'list_folder', inputs: { user: 'u@example.com' }, method: 'GET', url: `${GRAPH}/v1.0/users/u@example.com/drive/items/root/children?$select=id,name,size,webUrl,createdDateTime,lastModifiedDateTime,file,folder&$top=100` },
  { connector: 'onedrive_business', template: 'get_item', inputs: { user: 'u@example.com', item_id: 'I1' }, method: 'GET', url: `${GRAPH}/v1.0/users/u@example.com/drive/items/I1?$select=id,name,size,webUrl,createdDateTime,lastModifiedDateTime,file,folder,parentReference` },
  { connector: 'onedrive_business', template: 'download_file', inputs: { user: 'u@example.com', item_id: 'I1' }, method: 'GET', url: `${GRAPH}/v1.0/users/u@example.com/drive/items/I1/content` },
  { connector: 'onedrive_business', template: 'upload_file', inputs: { user: 'u@example.com', file_path: '/Docs/a.txt', content: 'hello', content_type: 'text/plain' }, method: 'PUT', url: `${GRAPH}/v1.0/users/u@example.com/drive/root:/Docs/a.txt:/content`, body: 'hello', headers: { 'content-type': 'text/plain' } },
  { connector: 'onedrive_business', template: 'create_upload_session', inputs: { user: 'u@example.com', file_path: '/Docs/big.zip' }, method: 'POST', url: `${GRAPH}/v1.0/users/u@example.com/drive/root:/Docs/big.zip:/createUploadSession`, body: { item: { '@microsoft.graph.conflictBehavior': 'rename' } } },
  { connector: 'onedrive_business', template: 'delete_item', inputs: { user: 'u@example.com', item_id: 'I1' }, method: 'DELETE', url: `${GRAPH}/v1.0/users/u@example.com/drive/items/I1` },
  { connector: 'onedrive_business', template: 'move_item', inputs: { user: 'u@example.com', item_id: 'I1', target_folder_id: 'F2' }, method: 'PATCH', url: `${GRAPH}/v1.0/users/u@example.com/drive/items/I1`, body: { parentReference: { id: 'F2' } } },
  { connector: 'onedrive_business', template: 'rename_item', inputs: { user: 'u@example.com', item_id: 'I1', new_name: 'b "final".txt' }, method: 'PATCH', url: `${GRAPH}/v1.0/users/u@example.com/drive/items/I1`, body: { name: 'b "final".txt' } },
  { connector: 'onedrive_business', template: 'copy_item', inputs: { user: 'u@example.com', item_id: 'I1', target_folder_id: 'F2', new_name: '2024' }, method: 'POST', url: `${GRAPH}/v1.0/users/u@example.com/drive/items/I1/copy`, body: { parentReference: { id: 'F2' }, name: '2024' } },
  { connector: 'onedrive_business', template: 'create_folder', inputs: { user: 'u@example.com', folder_name: 'New' }, method: 'POST', url: `${GRAPH}/v1.0/users/u@example.com/drive/items/root/children`, body: { name: 'New', folder: {}, '@microsoft.graph.conflictBehavior': 'rename' } },
  { connector: 'onedrive_business', template: 'search', inputs: { user: 'u@example.com', query: 'budget 2026' }, method: 'GET', url: `${GRAPH}/v1.0/users/u@example.com/drive/root/search(q='budget%202026')?$top=25&$select=id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference` },
  { connector: 'onedrive_business', template: 'share_link', inputs: { user: 'u@example.com', item_id: 'I1' }, method: 'POST', url: `${GRAPH}/v1.0/users/u@example.com/drive/items/I1/createLink`, body: { type: 'view', scope: 'organization' } },
  // SharePoint (site_id from the connector's Default Site ID)
  { connector: 'sharepoint', template: 'get_site', inputs: {}, method: 'GET', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:` },
  { connector: 'sharepoint', template: 'list_drives', inputs: {}, method: 'GET', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/drives?$select=id,name,webUrl,driveType` },
  { connector: 'sharepoint', template: 'list_files', inputs: { drive_id: 'D1', folder_path: '/Reports' }, method: 'GET', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/drives/D1/root:/Reports:/children?$select=id,name,size,webUrl,createdDateTime,lastModifiedDateTime,file,folder&$top=100` },
  { connector: 'sharepoint', template: 'list_folder', inputs: { site_id: 'S9', drive_id: 'D1' }, method: 'GET', url: `${GRAPH}/v1.0/sites/S9/drives/D1/items/root/children?$select=id,name,size,webUrl,createdDateTime,lastModifiedDateTime,file,folder&$top=100` },
  { connector: 'sharepoint', template: 'upload_file', inputs: { drive_id: 'D1', file_path: '/r.csv', content: 'a,b', content_type: 'text/csv', conflict: 'fail' }, method: 'PUT', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/drives/D1/root:/r.csv:/content?@microsoft.graph.conflictBehavior=fail`, body: 'a,b', headers: { 'content-type': 'text/csv' } },
  { connector: 'sharepoint', template: 'get_file', inputs: { drive_id: 'D1', item_id: 'I1' }, method: 'GET', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/drives/D1/items/I1?$select=id,name,size,webUrl,createdDateTime,lastModifiedDateTime,file,createdBy,lastModifiedBy` },
  { connector: 'sharepoint', template: 'download_file', inputs: { drive_id: 'D1', item_id: 'I1' }, method: 'GET', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/drives/D1/items/I1/content` },
  { connector: 'sharepoint', template: 'get_list_items', inputs: { list_id: 'Tasks', filter: "fields/Status eq 'Open'" }, method: 'GET', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/lists/Tasks/items?$expand=fields&$filter=fields/Status%20eq%20'Open'&$top=100`, headers: { prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } },
  { connector: 'sharepoint', template: 'create_list_item', inputs: { list_id: 'Tasks', fields_json: '{"Title":"New \\"quoted\\" item"}' }, method: 'POST', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/lists/Tasks/items`, body: { fields: { Title: 'New "quoted" item' } } },
  { connector: 'sharepoint', template: 'update_list_item', inputs: { list_id: 'Tasks', item_id: '7', fields_json: { Status: 'Done' } }, method: 'PATCH', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/lists/Tasks/items/7/fields`, body: { Status: 'Done' } },
  { connector: 'sharepoint', template: 'delete_list_item', inputs: { list_id: 'Tasks', item_id: '7' }, method: 'DELETE', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/lists/Tasks/items/7` },
  { connector: 'sharepoint', template: 'delete_file', inputs: { drive_id: 'D1', item_id: 'I1' }, method: 'DELETE', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/drives/D1/items/I1` },
  { connector: 'sharepoint', template: 'create_folder', inputs: { drive_id: 'D1', folder_name: 'Q4', parent_folder_id: 'F1' }, method: 'POST', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/drives/D1/items/F1/children`, body: { name: 'Q4', folder: {}, '@microsoft.graph.conflictBehavior': 'rename' } },
  { connector: 'sharepoint', template: 'move_file', inputs: { drive_id: 'D1', item_id: 'I1', target_folder_id: 'F2', new_name: 'x.pdf' }, method: 'PATCH', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/drives/D1/items/I1`, body: { parentReference: { id: 'F2' }, name: 'x.pdf' } },
  { connector: 'sharepoint', template: 'rename_file', inputs: { drive_id: 'D1', item_id: 'I1', new_name: 'y.pdf' }, method: 'PATCH', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/drives/D1/items/I1`, body: { name: 'y.pdf' } },
  { connector: 'sharepoint', template: 'search', inputs: { query: 'plan' }, method: 'GET', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/drive/root/search(q='plan')?$top=25` },
  { connector: 'sharepoint', template: 'list_lists', inputs: {}, method: 'GET', url: `${GRAPH}/v1.0/sites/contoso.sharepoint.com:/sites/Ops:/lists?$select=id,displayName,list,webUrl&$top=50` },
  // Azure Blob (container from the connector default)
  { connector: 'azure_blob', template: 'put_blob', inputs: { blob_name: 'in/a b.txt', content: 'hello', content_type: 'text/plain' }, method: 'PUT', url: 'https://contosostore.blob.core.windows.net/docs/in/a%20b.txt', body: 'hello', headers: { 'content-type': 'text/plain', 'x-ms-blob-type': 'BlockBlob' } },
  { connector: 'azure_blob', template: 'get_blob', inputs: { blob_name: 'in/a.txt' }, method: 'GET', url: 'https://contosostore.blob.core.windows.net/docs/in/a.txt' },
  { connector: 'azure_blob', template: 'list_blobs', inputs: { prefix: 'in/', marker: 'M&1' }, method: 'GET', url: 'https://contosostore.blob.core.windows.net/docs?restype=container&comp=list&prefix=in/&maxresults=100&marker=M%261' },
  { connector: 'azure_blob', template: 'delete_blob', inputs: { container: 'other', blob_name: 'x.txt' }, method: 'DELETE', url: 'https://contosostore.blob.core.windows.net/other/x.txt', headers: { 'x-ms-delete-snapshots': 'include' } },
  // Azure OpenAI
  { connector: 'azure_openai', template: 'chat_completion', inputs: { user_message: 'Say "hi"', max_tokens: 50, temperature: 0.2 }, method: 'POST', url: 'https://contoso-ai.openai.azure.com/openai/v1/chat/completions',
    body: { model: 'gpt-4o-prod', messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'Say "hi"' }], max_completion_tokens: 50, temperature: 0.2 }, headers: { 'api-key': '***' } },
  { connector: 'azure_openai', template: 'create_embedding', inputs: { text: 'hello', embedding_deployment: 'embed-small' }, method: 'POST', url: 'https://contoso-ai.openai.azure.com/openai/v1/embeddings', body: { model: 'embed-small', input: 'hello' } },
  // AWS S3
  { connector: 'aws_s3', template: 'put_object', inputs: { key: 'in/a b+c.txt', content: 'hello', content_type: 'text/plain' }, method: 'PUT', url: 'https://example-bucket.s3.eu-west-1.amazonaws.com/in/a%20b%2Bc.txt', body: 'hello', headers: { 'content-type': 'text/plain' } },
  { connector: 'aws_s3', template: 'get_object', inputs: { key: 'in/ü.txt' }, method: 'GET', url: 'https://example-bucket.s3.eu-west-1.amazonaws.com/in/%C3%BC.txt' },
  { connector: 'aws_s3', template: 'list_objects', inputs: { prefix: 'in/', continuation_token: 'tok+/=next', delimiter: '/' }, method: 'GET', url: 'https://example-bucket.s3.eu-west-1.amazonaws.com/?continuation-token=tok%2B%2F%3Dnext&delimiter=%2F&list-type=2&max-keys=100&prefix=in%2F' },
  { connector: 'aws_s3', template: 'delete_object', inputs: { key: 'in/a.txt' }, method: 'DELETE', url: 'https://example-bucket.s3.eu-west-1.amazonaws.com/in/a.txt' },
  { connector: 'aws_s3', template: 'head_object', inputs: { key: 'in/a.txt' }, method: 'HEAD', url: 'https://example-bucket.s3.eu-west-1.amazonaws.com/in/a.txt' },
  { connector: 'aws_s3', template: 'copy_object', inputs: { destination_key: 'out/b.txt', source_key: 'in/a b.txt', source_bucket: 'src.bucket' }, method: 'PUT', url: 'https://example-bucket.s3.eu-west-1.amazonaws.com/out/b.txt', headers: { 'x-amz-copy-source': '/src.bucket/in/a%20b.txt' } },
]

describe('every Microsoft / Azure / AWS template produces the documented request', () => {
  it('covers every template of the family', () => {
    const covered = new Set(CASES.map((c) => `${c.connector}.${c.template}`))
    covered.add('aws_s3.presign_url') // no request: see the presign test
    const all = Object.keys(CONFIG).flatMap((k) => getConnectorDefinition(k)!.referenceTemplates.map((t) => `${k}.${t.key}`))
    expect(all.filter((k) => !covered.has(k))).toEqual([])
  })

  for (const c of CASES) {
    it(`${c.connector}.${c.template}`, async () => {
      const { call } = await run(c.connector, c.template, c.inputs, {
        respond: (req) => (req.method === 'POST' && /\/oauth2\/v2\.0\/token$/.test(req.url))
          ? Response.json({ access_token: 'minted-access-token', expires_in: 3600 })
          : Response.json({ ok: true }),
      })
      expect(call.method).toBe(c.method)
      expect(call.url).toBe(c.url)
      if (c.body !== undefined) {
        expect(typeof c.body === 'string' ? call.body : JSON.parse(call.body ?? 'null')).toEqual(c.body)
      }
      for (const [k, v] of Object.entries(c.headers ?? {})) expect(call.headers[k]).toBe(v)
    })
  }
})

// ─── Microsoft Graph ───

describe('Microsoft Graph connectors', () => {
  it('mint an app-only token for the tenant and send it as a bearer token', async () => {
    const { requests, call } = await run('exchange_online', 'get_message', { email: 'ops@example.com', message_id: 'm1' })
    const mint = requests.find((r) => r.url.includes('login.microsoftonline.com'))!
    expect(mint.url).toBe('https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token')
    expect(mint.body).toContain('grant_type=client_credentials')
    expect(mint.body).toContain(encodeURIComponent('https://graph.microsoft.com/.default'))
    expect(call.headers.authorization).toBe('Bearer ***')
  })

  it('escapes quotes in mail fields instead of letting them add JSON members (no Bcc injection)', async () => {
    const subject = 'x","bccRecipients":[{"emailAddress":{"address":"evil@example.com"}}],"y":"'
    const { call } = await run('exchange_online', 'send_mail', { from_email: 'ops@example.com', to_email: 'a@example.com', subject, body: 'line1\nline2' })
    const body = JSON.parse(call.body!)
    expect(body.message.subject).toBe(subject)
    expect(body.message.body.content).toBe('line1\nline2')
    expect(body.message.bccRecipients).toBeUndefined()
    expect(body.message.ccRecipients).toBeUndefined()
  })

  it('sends CC / BCC arrays as JSON arrays and save_to_sent as a boolean', async () => {
    const cc = [{ emailAddress: { address: 'c@example.com' } }]
    const { call } = await run('exchange_online', 'send_mail', { from_email: 'ops@example.com', to_email: 'a@example.com', subject: 's', body: 'b', cc_recipients: JSON.stringify(cc), save_to_sent: 'false' })
    const body = JSON.parse(call.body!)
    expect(body.message.ccRecipients).toEqual(cc)
    expect(body.saveToSentItems).toBe(false)
  })

  it('encodes OData $filter values and drops empty $ options', async () => {
    const { call } = await run('exchange_online', 'list_messages', { email: 'ops@example.com', filter: "subject eq 'A&B #1'" })
    expect(call.url).toBe(`${GRAPH}/v1.0/users/ops@example.com/mailFolders/inbox/messages?$select=subject,from,receivedDateTime,isRead,bodyPreview&$filter=subject%20eq%20'A%26B%20%231'&$top=25`)
    expect(call.url).not.toMatch(/\$select=&|\$orderby=/)
  })

  it('refuses path traversal in mailbox / item inputs', async () => {
    await expect(run('exchange_online', 'get_message', { email: '../../groups', message_id: 'x' })).rejects.toThrow(/relative path segment/)
    await expect(run('onedrive_business', 'list_files', { user: 'u@example.com', path: '/a/../../b' })).rejects.toThrow(/relative path segment/)
  })

  it('follows @odata.nextLink through next_link on the same host only', async () => {
    const next = `${GRAPH}/v1.0/users/ops@example.com/mailFolders/inbox/messages?$skiptoken=abc`
    const { call } = await run('exchange_online', 'list_messages', { email: 'ops@example.com', next_link: next })
    expect(call.url).toBe(next)
    await expect(run('exchange_online', 'list_messages', { email: 'ops@example.com', next_link: 'https://evil.example.com/steal' })).rejects.toThrow(/own host/)
  })

  it('stores a binary download as a file instead of truncating it to text', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 1, 2, 255])
    const { result } = await run('onedrive_business', 'download_file', { user: 'u@example.com', item_id: 'I1' }, {
      respond: (req) => req.url.includes('login.microsoftonline.com')
        ? Response.json({ access_token: 't', expires_in: 3600 })
        : new Response(bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="r.pdf"' } }),
    })
    const data = result.data as any
    expect(data._file || data._binary).toBe(true)
    expect(data.size).toBe(8)
    if (data._binary) expect(Buffer.from(data.base64, 'base64')).toEqual(Buffer.from(bytes))
  })

  it('SharePoint: an explicit site_id overrides the connector default', async () => {
    const { call } = await run('sharepoint', 'list_drives', { site_id: 'contoso.sharepoint.com,1111,2222' })
    expect(call.url).toBe(`${GRAPH}/v1.0/sites/contoso.sharepoint.com,1111,2222/drives?$select=id,name,webUrl,driveType`)
  })

  it('declares no dead OAuth preset and minimal permissions', () => {
    expect(getConnectorDefinition('onedrive_business')!.oauth).toBeUndefined()
    expect(getConnectorDefinition('onedrive_business')!.recommendedPermissions!.items.join(' ')).not.toMatch(/User\.Read\.All/)
    expect(getConnectorDefinition('sharepoint')!.recommendedPermissions!.items[0]).toMatch(/Sites\.Selected/)
  })
})

// ─── Teams ───

describe('Microsoft Teams (Workflows webhook)', () => {
  it('keeps the webhook URL (and its sig) intact, out of base_url, with no inputs added to the query', async () => {
    const def = getConnectorDefinition('ms_teams')!
    const built = def.buildIntegrationConfig({}, { webhook_url: WEBHOOK })
    expect(built.base_url).toBe('')
    expect(built.auth_config.webhook_url).toBe(WEBHOOK)
    const { call } = await run('ms_teams', 'send_message', { title: 'Deploy "prod"', message: 'All **green**', subtitle: 'v2' })
    expect(call.url).toBe(WEBHOOK)
    const card = JSON.parse(call.body!).attachments[0]
    expect(card.contentType).toBe('application/vnd.microsoft.card.adaptive')
    expect(card.content.body.map((b: any) => b.text)).toEqual(['Deploy "prod"', 'v2', 'All **green**'])
  })

  it('upgrades rows that stored the webhook in base_url', async () => {
    const def = getConnectorDefinition('ms_teams')!
    const legacy = { base_url: WEBHOOK, auth_type: 'none', auth_config: {}, headers: {} }
    const upgraded = def.upgradeIntegrationConfig!(legacy)
    expect(upgraded).toMatchObject({ base_url: '', auth_type: 'none', auth_config: { webhook_url: WEBHOOK } })
    expect(def.upgradeIntegrationConfig!(upgraded)).toEqual(upgraded)

    const { call } = await run('ms_teams', 'send_message', { title: 't', message: 'm' }, {
      mutateReference: (ref) => { ref.integration.config = { ...legacy } },
    })
    expect(call.url).toBe(WEBHOOK)
  })
})

// ─── Dataverse ───

describe('Dataverse', () => {
  it('trims the environment URL and sends a valid token scope', async () => {
    const { requests } = await run('ms_dataverse', 'delete_row', { table_name: 'accounts', row_id: 'r1' })
    const mint = requests.find((r) => r.url.includes('login.microsoftonline.com'))!
    expect(mint.body).toContain(`scope=${encodeURIComponent('https://contoso.crm.dynamics.com/.default')}`)
  })

  it('upgrades stored configs (trailing slash, OData headers)', () => {
    const def = getConnectorDefinition('ms_dataverse')!
    const upgraded = def.upgradeIntegrationConfig!({ base_url: 'https://contoso.crm.dynamics.com/', auth_type: 'bearer', auth_config: { _executor: 'ms_client_credentials', scope: 'https://contoso.crm.dynamics.com//.default', client_secret: 'fake' } })
    expect(upgraded.base_url).toBe('https://contoso.crm.dynamics.com')
    expect(upgraded.auth_config.scope).toBe('https://contoso.crm.dynamics.com/.default')
    expect(upgraded.auth_config.client_secret).toBe('fake')
    expect(upgraded.headers['OData-MaxVersion']).toBe('4.0')
    expect(def.upgradeIntegrationConfig!(upgraded)).toEqual(upgraded)
  })

  it('query_table paging: count, page size and next_link', async () => {
    const { call } = await run('ms_dataverse', 'query_table', { table_name: 'contacts', include_count: true, page_size: 100, max_rows: 10 })
    expect(call.url).toBe('https://contoso.crm.dynamics.com/api/data/v9.2/contacts?$top=10&$count=true')
    expect(call.headers.prefer).toContain('odata.maxpagesize=100')
    const next = 'https://contoso.crm.dynamics.com/api/data/v9.2/contacts?$skiptoken=%3Ccookie%3E'
    const paged = await run('ms_dataverse', 'query_table', { table_name: 'contacts', next_link: next })
    expect(paged.call.url).toBe(next)
  })
})

// ─── Azure Blob ───

function sharedKeySignature(req: RecordedRequest, account: string, key: string, contentLength: number) {
  const url = new URL(req.url)
  const h = req.headers
  const msHeaders = Object.keys(h).filter((k) => k.startsWith('x-ms-')).sort().map((k) => `${k}:${h[k]}`).join('\n')
  const grouped = new Map<string, string[]>()
  for (const [k, v] of url.searchParams.entries()) grouped.set(k.toLowerCase(), [...(grouped.get(k.toLowerCase()) ?? []), v])
  const query = [...grouped.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, vs]) => `\n${k}:${vs.sort().join(',')}`).join('')
  const toSign = [req.method, '', '', contentLength ? String(contentLength) : '', '', h['content-type'] ?? '', '', '', '', '', '', '', msHeaders, `/${account}${url.pathname}${query}`].join('\n')
  return createHmac('sha256', Buffer.from(key, 'base64')).update(toSign, 'utf8').digest('base64')
}

describe('Azure Blob Storage', () => {
  it('signs Shared Key requests with the UTF-8 byte length (non-ASCII content)', async () => {
    sentHeaders.length = 0
    const { call } = await run('azure_blob', 'put_blob', { blob_name: 'notes/café.txt', content: 'héllo wörld', content_type: 'text/plain; charset=utf-8' }, {
      respond: () => new Response(null, { status: 201, headers: { etag: '"0x1"' } }),
    })
    expect(call.url).toBe('https://contosostore.blob.core.windows.net/docs/notes/caf%C3%A9.txt')
    const sent = sentHeaders[sentHeaders.length - 1]
    expect(sent.Authorization).toBe(`SharedKey contosostore:${sharedKeySignature(call, 'contosostore', AZ_KEY, Buffer.byteLength('héllo wörld'))}`)
  })

  it('signs list requests over the canonicalised query', async () => {
    sentHeaders.length = 0
    const { call } = await run('azure_blob', 'list_blobs', { prefix: 'in/', marker: 'M 1' }, {
      respond: () => new Response('<EnumerationResults><Blobs></Blobs></EnumerationResults>', { headers: { 'content-type': 'application/xml' } }),
    })
    expect(sentHeaders[sentHeaders.length - 1].Authorization).toBe(`SharedKey contosostore:${sharedKeySignature(call, 'contosostore', AZ_KEY, 0)}`)
  })

  it('returns next_marker and prefixes from a list response', async () => {
    const xml = '<?xml version="1.0" encoding="utf-8"?><EnumerationResults><Blobs><Blob><Name>in/a &amp; b.txt</Name><Properties><Content-Length>3</Content-Length><Content-Type>text/plain</Content-Type><Etag>"0x1"</Etag></Properties></Blob><BlobPrefix><Name>in/sub/</Name></BlobPrefix></Blobs><NextMarker>2!72!MDAw</NextMarker></EnumerationResults>'
    const { result } = await run('azure_blob', 'list_blobs', { prefix: 'in/', delimiter: '/' }, {
      respond: () => new Response(xml, { headers: { 'content-type': 'application/xml' } }),
    })
    expect(result.data).toMatchObject({ blobs: [{ name: 'in/a & b.txt', size: 3 }], prefixes: ['in/sub/'], next_marker: '2!72!MDAw', count: 1 })
  })

  it('appends a SAS token without logging its signature', async () => {
    const { call, result } = await run('azure_blob', 'get_blob', { blob_name: 'a.json' }, {
      credentials: { sas_token: '?sv=2022-11-02&sp=r&se=2030-01-01&sig=FAKE%2Bsig', account_key: '' },
      respond: () => Response.json({ ok: 1 }),
    })
    expect(call.url).toBe('https://contosostore.blob.core.windows.net/docs/a.json?sv=2022-11-02&sp=r&se=2030-01-01&sig=FAKE%2Bsig')
    expect(result.log?.url).not.toContain('FAKE')
  })
})

// ─── Azure OpenAI ───

describe('Azure OpenAI', () => {
  it('uses the v1 API with the configured deployment and typed numbers; drops an empty temperature', async () => {
    const { call } = await run('azure_openai', 'chat_completion', { user_message: 'hi' })
    expect(call.url).toBe('https://contoso-ai.openai.azure.com/openai/v1/chat/completions')
    expect(call.url).not.toContain('api-version')
    const body = JSON.parse(call.body!)
    expect(body.model).toBe('gpt-4o-prod')
    expect(body.max_completion_tokens).toBe(1024)
    expect('temperature' in body).toBe(false)
  })

  it('legacy deployment-path references get the deployment and api-version from the connector', async () => {
    const { call } = await run('azure_openai', 'chat_completion', { user_message: 'hi' }, {
      config: { api_version: '2024-10-21' },
      mutateReference: (ref) => {
        ref.request_config.path_template = '/openai/deployments/{{deployment_name}}/chat/completions?api-version={{api_version}}'
        ref.inputs = ref.inputs.filter((i: any) => i.name !== 'deployment_name').concat([
          { id: 'd', name: 'deployment_name', type: 'string', required: false, default_value: '', location: 'query', source: 'variable' },
          { id: 'v', name: 'api_version', type: 'string', required: false, default_value: '', location: 'query', source: 'variable' },
        ])
      },
    })
    expect(call.url).toBe('https://contoso-ai.openai.azure.com/openai/deployments/gpt-4o-prod/chat/completions?api-version=2024-10-21')
  })
})

// ─── AWS S3 ───

function sdkSigner(region: string) {
  return new SignatureV4({ service: 's3', region, credentials: { accessKeyId: S3_CREDS.access_key_id, secretAccessKey: S3_CREDS.secret_access_key }, sha256: Hash.bind(null, 'sha256'), uriEscapePath: false, applyChecksum: true })
}

async function captureS3(opts: Partial<Parameters<typeof executeS3Request>[0]> & { objectKey: string }, respond: (url: string, init: any) => Response = () => new Response(null, { status: 200, headers: { 'content-length': '0' } })) {
  const calls: { url: string; init: any }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => { calls.push({ url: String(url), init }); return respond(String(url), init) }))
  try {
    const result = await executeS3Request({
      accessKeyId: S3_CREDS.access_key_id, secretAccessKey: S3_CREDS.secret_access_key,
      region: 'eu-west-1', bucket: 'example-bucket', method: 'GET', ...opts,
    })
    return { calls, result }
  } finally { vi.unstubAllGlobals() }
}

async function expectSdkSignature(call: { url: string; init: any }, region: string, body?: string) {
  const u = new URL(call.url)
  const headers: Record<string, string> = { ...call.init.headers, host: u.host }
  const got = headers.Authorization
  delete headers.Authorization
  const amz = headers['x-amz-date']
  const date = new Date(Date.UTC(+amz.slice(0, 4), +amz.slice(4, 6) - 1, +amz.slice(6, 8), +amz.slice(9, 11), +amz.slice(11, 13), +amz.slice(13, 15)))
  const query: Record<string, string> = {}
  for (const [k, v] of u.searchParams.entries()) query[k] = v
  const signed = await sdkSigner(region).sign(new HttpRequest({ method: call.init.method, protocol: 'https:', hostname: u.hostname, path: u.pathname, query, headers, body }), { signingDate: date })
  expect(got).toBe(signed.headers.authorization)
}

describe('AWS S3 executor', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['plain/file.txt'],
    ['spaces and+plus/file (1).txt'],
    ['a=b&c?d#e.txt'],
    ['unicode/ü-日本.txt'],
    ['emoji/😀.txt'],
    ["quote's*!.txt"],
  ])('SigV4 matches the AWS SDK signer for key %s (encoded once, UTF-8)', async (key) => {
    const { calls } = await captureS3({ method: 'PUT', objectKey: key, body: 'héllo', contentType: 'text/plain' })
    expect(calls[0].url).toBe(`https://example-bucket.s3.eu-west-1.amazonaws.com/${encodeKey(key)}`)
    await expectSdkSignature(calls[0], 'eu-west-1', 'héllo')
  })

  it('SigV4 matches the SDK for a ListObjectsV2 query and temporary credentials', async () => {
    const { calls } = await captureS3({ objectKey: '', queryParams: { 'list-type': '2', prefix: 'a b/', 'continuation-token': 'x+/=' }, sessionToken: 'FAKE-SESSION-TOKEN' })
    expect(calls[0].init.headers['x-amz-security-token']).toBe('FAKE-SESSION-TOKEN')
    const u = new URL(calls[0].url)
    const signer = new SignatureV4({ service: 's3', region: 'eu-west-1', credentials: { accessKeyId: S3_CREDS.access_key_id, secretAccessKey: S3_CREDS.secret_access_key, sessionToken: 'FAKE-SESSION-TOKEN' }, sha256: Hash.bind(null, 'sha256'), uriEscapePath: false, applyChecksum: true })
    const headers: Record<string, string> = { ...calls[0].init.headers, host: u.host }
    const got = headers.Authorization
    delete headers.Authorization
    const amz = headers['x-amz-date']
    const query: Record<string, string> = {}
    for (const [k, v] of u.searchParams.entries()) query[k] = v
    const signed = await signer.sign(new HttpRequest({ method: 'GET', protocol: 'https:', hostname: u.hostname, path: u.pathname, query, headers }), { signingDate: new Date(Date.UTC(+amz.slice(0, 4), +amz.slice(4, 6) - 1, +amz.slice(6, 8), +amz.slice(9, 11), +amz.slice(11, 13), +amz.slice(13, 15))) })
    expect(got).toBe(signed.headers.authorization)
  })

  it('uses path-style addressing for dotted bucket names and rejects invalid buckets', async () => {
    expect(s3Endpoint('my.dotted.bucket', 'us-east-1', 'k 1')).toEqual({ host: 's3.us-east-1.amazonaws.com', path: '/my.dotted.bucket/k%201', virtualHosted: false })
    const { calls } = await captureS3({ bucket: 'my.dotted.bucket', objectKey: 'k 1' })
    expect(calls[0].url).toBe('https://s3.us-east-1.amazonaws.com/my.dotted.bucket/k%201'.replace('us-east-1', 'eu-west-1'))
    await expectSdkSignature(calls[0], 'eu-west-1')
    for (const bad of ['attacker.example/', 'a', '127.0.0.1', 'x..y', 'b@d']) expect(isValidBucketName(bad)).toBe(false)
    await expect(run('aws_s3', 'get_object', { key: 'a', bucket: 'evil.example.com/x' })).rejects.toThrow(/Invalid S3 bucket/)
  })

  it('re-signs for the bucket region on a 301 and never follows a redirect off AWS', async () => {
    let n = 0
    const { calls, result } = await captureS3({ objectKey: 'a.txt' }, () => {
      n++
      if (n === 1) return new Response('<Error><Code>PermanentRedirect</Code></Error>', { status: 301, headers: { 'x-amz-bucket-region': 'ap-southeast-2', 'content-type': 'application/xml' } })
      return new Response('hello', { headers: { 'content-type': 'text/plain' } })
    })
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['example-bucket.s3.eu-west-1.amazonaws.com', 'example-bucket.s3.ap-southeast-2.amazonaws.com'])
    expect(calls[1].init.headers.Authorization).toContain('/ap-southeast-2/s3/aws4_request')
    expect(result.data).toMatchObject({ body: 'hello', content_type: 'text/plain' })

    const off = await captureS3({ objectKey: 'a.txt' }, (url) => url.includes('evil')
      ? new Response('stolen')
      : new Response(null, { status: 307, headers: { location: 'https://evil.example.com/a.txt' } }))
    expect(off.calls.every((c) => !c.url.includes('evil'))).toBe(true)
  })

  it('refuses to fetch an upload-from-URL body from a private address (SSRF)', async () => {
    await expect(run('aws_s3', 'put_object', { key: 'x.bin', content: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/role' })).rejects.toThrow(/not allowed|blocked/i)
  })

  it('normalises ListObjectsV2 with continuation token and common prefixes', async () => {
    const { result } = await run('aws_s3', 'list_objects', { prefix: 'in/', delimiter: '/' }, {
      respond: () => new Response(S3_LIST_XML, { headers: { 'content-type': 'application/xml' } }),
    })
    expect(result.data).toEqual({
      contents: [{ key: 'in/a & b.txt', size: 3, last_modified: undefined, etag: 'abc', storage_class: 'STANDARD' }],
      common_prefixes: ['in/sub/'],
      key_count: 1,
      is_truncated: true,
      prefix: 'in/',
      next_continuation_token: 'tok+/=next',
    })
  })

  it('stores binary GetObject responses as a file (no text truncation)', async () => {
    const bytes = new Uint8Array(2048).map((_, i) => i % 256)
    const { result } = await run('aws_s3', 'get_object', { key: 'img/p.png' }, {
      respond: () => new Response(bytes, { headers: { 'content-type': 'image/png' } }),
    })
    const data = result.data as any
    expect(data._file || data._binary).toBe(true)
    expect(data.size).toBe(2048)
    if (data._binary) expect(Buffer.from(data.base64, 'base64')).toEqual(Buffer.from(bytes))
  })

  it('copy_object defaults the source bucket to the destination bucket', async () => {
    const { call } = await run('aws_s3', 'copy_object', { destination_key: 'b.txt', source_key: 'dir/ä.txt' }, {
      respond: () => new Response('<CopyObjectResult><ETag>"e1"</ETag><LastModified>2026-10-30T00:00:00Z</LastModified></CopyObjectResult>', { headers: { 'content-type': 'application/xml' } }),
    })
    expect(call.headers['x-amz-copy-source']).toBe('/example-bucket/dir/%C3%A4.txt')
    expect(call.url).toBe('https://example-bucket.s3.eu-west-1.amazonaws.com/b.txt')
  })

  it('presign_url returns a URL without calling S3', async () => {
    const { requests, result } = await run('aws_s3', 'presign_url', { key: 'reports/q 4.pdf', expires_in: 600 })
    expect(requests).toEqual([])
    const data = result.data as any
    const u = new URL(data.url)
    expect(u.host).toBe('example-bucket.s3.eu-west-1.amazonaws.com')
    expect(u.pathname).toBe('/reports/q%204.pdf')
    expect(u.searchParams.get('X-Amz-Expires')).toBe('600')
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(data.method).toBe('GET')
    await expect(run('aws_s3', 'presign_url', { key: 'a', expires_in: 999999 })).rejects.toThrow(/expires_in/)
  })

  it('does not put the secret key or session token in any URL', async () => {
    const { requests } = await run('aws_s3', 'list_objects', {}, { credentials: { session_token: 'FAKE-SESSION-TOKEN' } })
    for (const r of requests) {
      expect(r.url).not.toContain(S3_CREDS.secret_access_key)
      expect(r.url).not.toContain('FAKE-SESSION-TOKEN')
    }
  })
})
