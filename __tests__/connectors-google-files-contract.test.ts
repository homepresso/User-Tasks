import { describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))
const jwt = vi.hoisted(() => ({ calls: [] as any[] }))
vi.mock('google-auth-library', () => ({
  JWT: class {
    constructor(public opts: any) { jwt.calls.push(opts) }
    async authorize() { return { access_token: 'ya29.fake-google-token', expiry_date: Date.now() + 3_600_000 } }
  },
}))

import { getConnectorDefinition } from '@/lib/connectors/registry'
import { buildGmailRawMessage, buildMimeMessage, encodeHeaderText, GmailMimeError } from '@/lib/connectors/gmail-mime'
import { fromFirestoreDocument, fromFirestoreFields, toFirestoreFields } from '@/lib/connectors/firestore-values'
import { runConnectorTemplate, type RecordedRequest } from './helpers/connector-contract'

/**
 * Contract tests for the Google / Firebase / file-storage connectors: every
 * template's request as actually sent by the runtime (URL, method, key
 * headers, body), plus the tricky cases (escaping, paging, auth mints,
 * legacy stored configs, binary downloads).
 */

const FAKE_SA = JSON.stringify({
  type: 'service_account',
  project_id: 'demo-project',
  client_email: 'bot@demo-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
})
const GOOGLE_SA = new Set(['gmail', 'google_docs', 'google_drive', 'google_tasks', 'firebase'])

const SAMPLE: Record<string, unknown> = {
  path: '/Reports/Q3.pdf', content: 'hello', file_id: 'f1', message_id: 'm1', document_id: 'd1',
  collection_path: 'users', document_path: 'users/alice', parent_path: 'companies/acme',
  document_json: { fields: { n: { stringValue: 'a' } } },
  query_json: { structuredQuery: { from: [{ collectionId: 'users' }] } },
  requests_json: [{ insertText: { text: 'x', endOfSegmentLocation: {} } }],
  update_json: { title: 'x' },
}

function requiredInputs(connector: string, template: string): Record<string, unknown> {
  const t = getConnectorDefinition(connector)!.referenceTemplates.find((x) => x.key === template)!
  const out: Record<string, unknown> = {}
  for (const i of t.inputs) if (i.required) out[i.name] = SAMPLE[i.name] ?? `v-${i.name.replace(/_/g, '-')}`
  return out
}

function run(connector: string, template: string, opts: { inputs?: Record<string, unknown>; credentials?: Record<string, any>; config?: Record<string, any>; respond?: (r: RecordedRequest) => Response; mutateReference?: (ref: Record<string, any>) => void } = {}) {
  const credentials = {
    ...(GOOGLE_SA.has(connector) ? { service_account_json: FAKE_SA, impersonate_email: '' } : {}),
    ...(connector === 'box' ? { as_user_id: '', box_user_id: '' } : {}),
    ...(connector === 'dropbox' ? { team_member_id: '', refresh_token: '' } : {}),
    ...(opts.credentials ?? {}),
  }
  return runConnectorTemplate({
    connector, template, credentials, config: opts.config,
    inputs: { ...requiredInputs(connector, template), ...(opts.inputs ?? {}) },
    respond: opts.respond, mutateReference: opts.mutateReference,
  })
}

type Expect = [method: string, url: string, body?: unknown]
const FS = 'https://firestore.googleapis.com/v1/projects/fake-project-id/databases/(default)/documents'
const DRIVE_FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,parents,driveId,webViewLink'

/** Every template with only its required inputs (sample values). Body: parsed JSON, a string, or null. */
const EXPECTED: Record<string, Record<string, Expect>> = {
  gmail: {
    send_email: ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: 'v-raw-message' }],
    list_messages: ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25'],
    get_message: ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=full'],
    get_attachment: ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/attachments/v-attachment-id'],
    modify_labels: ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify', {}],
    trash_message: ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/trash'],
    untrash_message: ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/untrash'],
    list_labels: ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/labels'],
    create_label: ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/labels', { name: 'v-label-name', labelListVisibility: 'labelShow', messageListVisibility: 'show' }],
    create_draft: ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { message: { raw: 'v-raw-message' } }],
    send_draft: ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', { id: 'v-draft-id' }],
    get_profile: ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/profile'],
  },
  google_docs: {
    get_document: ['GET', 'https://docs.googleapis.com/v1/documents/d1'],
    create_document: ['POST', 'https://docs.googleapis.com/v1/documents', { title: 'v-title' }],
    batch_update: ['POST', 'https://docs.googleapis.com/v1/documents/d1:batchUpdate', { requests: [{ insertText: { text: 'x', endOfSegmentLocation: {} } }] }],
    insert_text: ['POST', 'https://docs.googleapis.com/v1/documents/d1:batchUpdate', { requests: [{ insertText: { location: { index: 1 }, text: 'v-text' } }] }],
    replace_text: ['POST', 'https://docs.googleapis.com/v1/documents/d1:batchUpdate', { requests: [{ replaceAllText: { containsText: { text: 'v-find', matchCase: true }, replaceText: 'v-replace' } }] }],
    append_text: ['POST', 'https://docs.googleapis.com/v1/documents/d1:batchUpdate', { requests: [{ insertText: { endOfSegmentLocation: { segmentId: '' }, text: 'v-text' } }] }],
  },
  google_drive: {
    list_files: ['GET', `https://www.googleapis.com/drive/v3/files?q=trashed%3Dfalse&pageSize=100&orderBy=modifiedTime%20desc&includeItemsFromAllDrives=true&supportsAllDrives=true&fields=nextPageToken,incompleteSearch,files(${DRIVE_FIELDS})`],
    get_file: ['GET', `https://www.googleapis.com/drive/v3/files/f1?supportsAllDrives=true&fields=${DRIVE_FIELDS},description,webContentLink,shared,owners,trashed`],
    download_file: ['GET', 'https://www.googleapis.com/drive/v3/files/f1?alt=media&supportsAllDrives=true'],
    upload_file: ['POST', `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${DRIVE_FIELDS}`],
    update_file: ['PATCH', `https://www.googleapis.com/drive/v3/files/f1?supportsAllDrives=true&fields=${DRIVE_FIELDS},description`, {}],
    delete_file: ['DELETE', 'https://www.googleapis.com/drive/v3/files/f1?supportsAllDrives=true'],
    trash_file: ['PATCH', 'https://www.googleapis.com/drive/v3/files/f1?supportsAllDrives=true&fields=id,name,trashed', { trashed: true }],
    copy_file: ['POST', `https://www.googleapis.com/drive/v3/files/f1/copy?supportsAllDrives=true&fields=${DRIVE_FIELDS}`, {}],
    create_folder: ['POST', `https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=${DRIVE_FIELDS}`, { name: 'v-folder-name', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] }],
    share_file: ['POST', 'https://www.googleapis.com/drive/v3/files/f1/permissions?supportsAllDrives=true', { type: 'v-share-type', role: 'v-role' }],
    export_file: ['GET', 'https://www.googleapis.com/drive/v3/files/f1/export?mimeType=v-export-mime-type'],
  },
  google_gemini: {
    generate_content: ['POST', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
      contents: [{ role: 'user', parts: [{ text: 'v-prompt' }] }],
      systemInstruction: { parts: [{ text: 'You are a helpful assistant.' }] },
      generationConfig: { maxOutputTokens: 8192 },
    }],
    generate_content_with_image: ['POST', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
      contents: [{ role: 'user', parts: [{ text: 'v-prompt' }, { inlineData: { mimeType: 'image/png', data: 'v-image-base64' } }] }],
      generationConfig: { maxOutputTokens: 8192 },
    }],
    embed_content: ['POST', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', { content: { parts: [{ text: 'v-text' }] }, taskType: 'RETRIEVAL_DOCUMENT' }],
    count_tokens: ['POST', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens', { contents: [{ role: 'user', parts: [{ text: 'v-text' }] }] }],
    list_models: ['GET', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100'],
  },
  google_tasks: {
    list_tasklists: ['GET', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100'],
    get_tasklist: ['GET', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists/v-tasklist-id'],
    create_tasklist: ['POST', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists', { title: 'v-title' }],
    delete_tasklist: ['DELETE', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists/v-tasklist-id'],
    list_tasks: ['GET', 'https://tasks.googleapis.com/tasks/v1/lists/v-tasklist-id/tasks?maxResults=100&showCompleted=true&showHidden=false'],
    get_task: ['GET', 'https://tasks.googleapis.com/tasks/v1/lists/v-tasklist-id/tasks/v-task-id'],
    create_task: ['POST', 'https://tasks.googleapis.com/tasks/v1/lists/v-tasklist-id/tasks', { title: 'v-title', status: 'needsAction' }],
    update_task: ['PATCH', 'https://tasks.googleapis.com/tasks/v1/lists/v-tasklist-id/tasks/v-task-id', { title: 'x' }],
    complete_task: ['PATCH', 'https://tasks.googleapis.com/tasks/v1/lists/v-tasklist-id/tasks/v-task-id', { status: 'completed' }],
    delete_task: ['DELETE', 'https://tasks.googleapis.com/tasks/v1/lists/v-tasklist-id/tasks/v-task-id'],
  },
  firebase: {
    list_documents: ['GET', `${FS}/users?pageSize=100`],
    get_document: ['GET', `${FS}/users/alice`],
    create_document: ['POST', `${FS}/users`, { fields: { n: { stringValue: 'a' } } }],
    update_document: ['PATCH', `${FS}/users/alice`, { fields: { n: { stringValue: 'a' } } }],
    delete_document: ['DELETE', `${FS}/users/alice`],
    run_query: ['POST', `${FS}:runQuery`, { structuredQuery: { from: [{ collectionId: 'users' }] } }],
    run_query_in_document: ['POST', `${FS}/companies/acme:runQuery`, { structuredQuery: { from: [{ collectionId: 'users' }] } }],
  },
  box: {
    get_file_info: ['GET', 'https://api.box.com/2.0/files/f1'],
    download_file: ['GET', 'https://api.box.com/2.0/files/f1/content'],
    upload_file: ['POST', 'https://upload.box.com/api/2.0/files/content'],
    upload_file_version: ['POST', 'https://upload.box.com/api/2.0/files/f1/content'],
    update_file: ['PUT', 'https://api.box.com/2.0/files/f1', { title: 'x' }],
    delete_file: ['DELETE', 'https://api.box.com/2.0/files/f1'],
    copy_file: ['POST', 'https://api.box.com/2.0/files/f1/copy', { parent: { id: 'v-target-folder-id' } }],
    create_shared_link: ['PUT', 'https://api.box.com/2.0/files/f1?fields=shared_link', { shared_link: { access: 'open' } }],
    list_folder: ['GET', 'https://api.box.com/2.0/folders/v-folder-id/items?fields=id,name,type,size,modified_at&limit=100&usemarker=true'],
    create_folder: ['POST', 'https://api.box.com/2.0/folders', { name: 'v-folder-name', parent: { id: '0' } }],
    delete_folder: ['DELETE', 'https://api.box.com/2.0/folders/v-folder-id?recursive=false'],
    search: ['GET', 'https://api.box.com/2.0/search?query=v-query&limit=30&offset=0'],
    get_current_user: ['GET', 'https://api.box.com/2.0/users/me'],
    add_collaborator: ['POST', 'https://api.box.com/2.0/collaborations', { item: { type: 'v-item-type', id: 'v-item-id' }, accessible_by: { type: 'user', login: 'v-email' }, role: 'editor' }],
  },
  dropbox: {
    list_folder: ['POST', 'https://api.dropboxapi.com/2/files/list_folder', { path: '', recursive: false, limit: 100, include_deleted: false }],
    list_folder_continue: ['POST', 'https://api.dropboxapi.com/2/files/list_folder/continue', { cursor: 'v-cursor' }],
    get_metadata: ['POST', 'https://api.dropboxapi.com/2/files/get_metadata', { path: '/Reports/Q3.pdf', include_media_info: true }],
    download: ['POST', 'https://content.dropboxapi.com/2/files/download', null],
    upload: ['POST', 'https://content.dropboxapi.com/2/files/upload', 'hello'],
    delete: ['POST', 'https://api.dropboxapi.com/2/files/delete_v2', { path: '/Reports/Q3.pdf' }],
    move: ['POST', 'https://api.dropboxapi.com/2/files/move_v2', { from_path: 'v-from-path', to_path: 'v-to-path', autorename: false }],
    copy: ['POST', 'https://api.dropboxapi.com/2/files/copy_v2', { from_path: 'v-from-path', to_path: 'v-to-path', autorename: false }],
    create_folder: ['POST', 'https://api.dropboxapi.com/2/files/create_folder_v2', { path: '/Reports/Q3.pdf', autorename: false }],
    search: ['POST', 'https://api.dropboxapi.com/2/files/search_v2', { query: 'v-query', options: { max_results: 20 } }],
    search_continue: ['POST', 'https://api.dropboxapi.com/2/files/search/continue_v2', { cursor: 'v-cursor' }],
    create_shared_link: ['POST', 'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', { path: '/Reports/Q3.pdf', settings: { requested_visibility: 'public' } }],
    list_shared_links: ['POST', 'https://api.dropboxapi.com/2/sharing/list_shared_links', { path: '/Reports/Q3.pdf', direct_only: true }],
    get_account: ['POST', 'https://api.dropboxapi.com/2/users/get_current_account', null],
  },
}

describe('every template of the Google / file connectors', () => {
  for (const [connector, templates] of Object.entries(EXPECTED)) {
    it(`${connector}: the table covers every template`, () => {
      expect(Object.keys(templates).sort()).toEqual(getConnectorDefinition(connector)!.referenceTemplates.map((t) => t.key).sort())
    })
    for (const [template, [method, url, body]] of Object.entries(templates)) {
      it(`${connector}.${template}`, async () => {
        const { call } = await run(connector, template)
        expect(call.method).toBe(method)
        expect(call.url).toBe(url)
        // No input name ever leaks into the query string as an extra parameter.
        const path = getConnectorDefinition(connector)!.referenceTemplates.find((t) => t.key === template)!.pathTemplate
        for (const name of Object.keys(requiredInputs(connector, template))) {
          if (path.includes(`${name}={{${name}}}`)) continue // the API's own parameter of that name
          expect(new URL(call.url).searchParams.has(name)).toBe(false)
        }
        expect(call.url).not.toContain('{{')
        expect(JSON.stringify(call.headers)).not.toContain('{{')
        if (connector === 'google_gemini') {
          expect(call.headers['x-goog-api-key']).toBe('***')
          expect(call.headers.authorization).toBeUndefined()
        } else {
          expect(call.headers.authorization).toBe('Bearer ***')
        }
        if (body !== undefined) {
          if (body === null) expect(call.body === null || call.body === 'null').toBe(true)
          else if (typeof body === 'string') expect(call.body).toBe(body)
          else expect(JSON.parse(call.body!)).toEqual(body)
        }
      })
    }
  }
})

describe('Google service-account auth', () => {
  it('mints with the connector scope and the delegation subject', async () => {
    jwt.calls.length = 0
    await run('gmail', 'get_profile', { credentials: { impersonate_email: 'ops@example.com' } })
    expect(jwt.calls.at(-1)).toMatchObject({ email: 'bot@demo-project.iam.gserviceaccount.com', scopes: ['https://www.googleapis.com/auth/gmail.modify'], subject: 'ops@example.com' })
    await run('google_drive', 'get_file')
    expect(jwt.calls.at(-1)).toMatchObject({ scopes: ['https://www.googleapis.com/auth/drive'], subject: undefined })
    await run('google_drive', 'get_file', { credentials: { impersonate_email: 'ada@example.com' } })
    expect(jwt.calls.at(-1)).toMatchObject({ subject: 'ada@example.com' })
    await run('firebase', 'get_document')
    expect(jwt.calls.at(-1)).toMatchObject({ scopes: ['https://www.googleapis.com/auth/datastore'] })
  })

  it('reports invalid service account JSON without echoing it', async () => {
    await expect(run('google_docs', 'get_document', { credentials: { service_account_json: '{"private_key":"SECRET-PART' } }))
      .rejects.toThrow(/^Service account JSON is not valid JSON$/)
  })
})

describe('Gmail', () => {
  it('pages and filters list_messages with encoded query values', async () => {
    const { call } = await run('gmail', 'list_messages', { inputs: { query: 'from:a+b@example.com subject:"Q3 & Q4"', page_token: 'tok/1', label_id: 'INBOX', include_spam_trash: true } })
    const u = new URL(call.url)
    expect(u.searchParams.get('q')).toBe('from:a+b@example.com subject:"Q3 & Q4"')
    expect(u.searchParams.get('pageToken')).toBe('tok/1')
    expect(u.searchParams.get('labelIds')).toBe('INBOX')
    expect(u.searchParams.get('includeSpamTrash')).toBe('true')
  })

  it('sends label arrays as arrays and thread IDs only when given', async () => {
    const { call } = await run('gmail', 'modify_labels', { inputs: { add_labels: '["STARRED"]', remove_labels: ['UNREAD', 'INBOX'] } })
    expect(JSON.parse(call.body!)).toEqual({ addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD', 'INBOX'] })
    const send = await run('gmail', 'send_email', { inputs: { raw_message: 'abc_-', thread_id: '12345' } })
    expect(JSON.parse(send.call.body!)).toEqual({ raw: 'abc_-', threadId: '12345' })
  })

  it('has no permanent delete (it needs the full mail.google.com scope)', () => {
    expect(getConnectorDefinition('gmail')!.referenceTemplates.some((t) => t.key === 'delete_message')).toBe(false)
  })
})

describe('Gmail MIME builder', () => {
  const date = new Date('2026-10-30T12:00:00Z')

  it('builds a base64url RFC 2822 message', () => {
    const mime = buildMimeMessage({ to: 'Ada Lovelace <ada@example.com>, bob@example.com', subject: 'Hello', text: 'Hi there' }, { date })
    expect(mime).toContain('To: "Ada Lovelace" <ada@example.com>, bob@example.com\r\n')
    expect(mime).toContain('Subject: Hello\r\n')
    expect(mime).toContain('MIME-Version: 1.0\r\n')
    expect(mime).toContain(`Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from('Hi there').toString('base64')}`)
    const raw = buildGmailRawMessage({ to: 'bob@example.com', subject: 'x', text: 'y' }, { date })
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(raw, 'base64url').toString('utf8')).toContain('To: bob@example.com')
  })

  it('rejects CR/LF header injection in any header field', () => {
    expect(() => buildMimeMessage({ to: 'a@example.com\r\nBcc: evil@example.com', subject: 's' })).toThrow(GmailMimeError)
    expect(() => buildMimeMessage({ to: 'a@example.com', subject: 'Hi\r\nBcc: evil@example.com' })).toThrow(/line breaks/)
    expect(() => buildMimeMessage({ to: 'a@example.com', from: 'x@example.com\nX: y' })).toThrow(GmailMimeError)
    expect(() => buildMimeMessage({ to: 'not an address' })).toThrow(/invalid address/)
    expect(() => buildMimeMessage({ to: '' })).toThrow(/to is required/)
    expect(() => buildMimeMessage({ to: 'a@example.com', in_reply_to: 'nope' })).toThrow(/message-id/)
  })

  it('RFC 2047-encodes non-ASCII subjects and names', () => {
    expect(encodeHeaderText('Résumé — Q3')).toBe(`=?UTF-8?B?${Buffer.from('Résumé — Q3').toString('base64')}?=`)
    const mime = buildMimeMessage({ to: 'José <jose@example.com>', subject: 'Olá', html: '<p>hi</p>', text: 'hi' }, { date, boundary: 'b1' })
    expect(mime).toContain(`To: =?UTF-8?B?${Buffer.from('José').toString('base64')}?= <jose@example.com>`)
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="b1"')
    expect(mime).toContain('--b1--')
  })
})

describe('Google Docs', () => {
  it('escapes text and keeps typed literals', async () => {
    const text = 'Line 1\nHe said "hi", "x": true'
    const { call } = await run('google_docs', 'insert_text', { inputs: { text, index: '5' } })
    expect(JSON.parse(call.body!)).toEqual({ requests: [{ insertText: { location: { index: 5 }, text } }] })
    const replace = await run('google_docs', 'replace_text', { inputs: { find: 'a"b', match_case: false } })
    expect(JSON.parse(replace.call.body!).requests[0].replaceAllText.containsText).toEqual({ text: 'a"b', matchCase: false })
  })
})

describe('Google Drive', () => {
  it('pages list_files and encodes the q value', async () => {
    const { call } = await run('google_drive', 'list_files', { inputs: { query: "name contains 'Q3 & Q4' and trashed=false", page_token: 'NEXT', corpora: 'drive', drive_id: 'sd1' } })
    const u = new URL(call.url)
    expect(u.searchParams.get('q')).toBe("name contains 'Q3 & Q4' and trashed=false")
    expect(u.searchParams.get('pageToken')).toBe('NEXT')
    expect(u.searchParams.get('corpora')).toBe('drive')
    expect(u.searchParams.get('driveId')).toBe('sd1')
    expect(u.searchParams.get('fields')).toMatch(/^nextPageToken,/)
  })

  it('refuses path traversal in IDs', async () => {
    await expect(run('google_drive', 'get_file', { inputs: { file_id: '../../about' } })).rejects.toThrow(/relative path segment/)
  })

  it('only sends the metadata fields that were set', async () => {
    const { call } = await run('google_drive', 'update_file', { inputs: { new_name: 'Q3 "final".pdf', add_parents: 'folderB', remove_parents: 'folderA' } })
    expect(JSON.parse(call.body!)).toEqual({ name: 'Q3 "final".pdf' })
    expect(new URL(call.url).searchParams.get('addParents')).toBe('folderB')
    const copy = await run('google_drive', 'copy_file', { inputs: { new_name: 'Copy', parent_ids: '["folderC"]' } })
    expect(JSON.parse(copy.call.body!)).toEqual({ name: 'Copy', parents: ['folderC'] })
    const share = await run('google_drive', 'share_file', { inputs: { share_type: 'user', role: 'reader', email: 'ada@example.com', notify: false } })
    expect(JSON.parse(share.call.body!)).toEqual({ type: 'user', role: 'reader', emailAddress: 'ada@example.com' })
    expect(new URL(share.call.url).searchParams.get('sendNotificationEmail')).toBe('false')
  })

  it('stores binary downloads as a file instead of mangled text', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0x01])
    const { result } = await run('google_drive', 'download_file', {
      respond: () => new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } }),
    })
    const data = result.data as any
    expect(data._file === true || typeof data._binary !== 'undefined' || typeof data.base64 === 'string').toBe(true)
    expect(JSON.stringify(data)).not.toContain('_raw')
  })
})

describe('Google Gemini', () => {
  it('sends the key in x-goog-api-key, never in the URL', async () => {
    const { call, requests } = await run('google_gemini', 'generate_content', { credentials: { api_key: 'AIzaFAKE-KEY' }, inputs: { prompt: 'Say "hi"\nnow', temperature: 0.2 } })
    for (const r of requests) expect(r.url).not.toContain('AIzaFAKE-KEY')
    expect(new URL(call.url).search).toBe('')
    expect(JSON.parse(call.body!).contents[0].parts[0].text).toBe('Say "hi"\nnow')
    expect(JSON.parse(call.body!).generationConfig).toEqual({ temperature: 0.2, maxOutputTokens: 8192 })
  })

  it('uses the connector default model, or the one given', async () => {
    const dflt = await run('google_gemini', 'count_tokens', { config: { default_model: 'gemini-3.5-flash-lite' } })
    expect(dflt.call.url).toContain('/models/gemini-3.5-flash-lite:countTokens')
    const given = await run('google_gemini', 'count_tokens', { inputs: { model: 'gemini-4-argon' } })
    expect(given.call.url).toContain('/models/gemini-4-argon:countTokens')
  })

  it('upgrades integrations stored with ?key= auth and default_model', async () => {
    const def = getConnectorDefinition('google_gemini')!
    const legacy = { base_url: 'https://generativelanguage.googleapis.com', auth_type: 'api_key', auth_config: { key_name: 'key', key_value: 'AIzaFAKE-KEY', add_to: 'query' }, template_vars: { default_model: 'gemini-2.5-pro' } }
    const upgraded = def.upgradeIntegrationConfig!(legacy)
    expect(upgraded.auth_config).toEqual({ key_name: 'x-goog-api-key', key_value: 'AIzaFAKE-KEY', add_to: 'header' })
    expect(upgraded.template_vars.model).toBe('gemini-2.5-pro')
    expect(def.upgradeIntegrationConfig!(upgraded)).toEqual(upgraded)

    // A reference stored by the old definition (?key={{api_key}}) still works and leaks nothing.
    const { call } = await run('google_gemini', 'list_models', {
      mutateReference: (ref) => {
        ref.request_config.path_template = '/v1beta/models?key={{api_key}}'
        ref.inputs = [{ name: 'api_key', type: 'string', required: false, default_value: '', location: 'query' }]
        ref.integration.config = { ...legacy }
      },
    })
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(call.headers['x-goog-api-key']).toBe('***')
  })
})

describe('Google Tasks', () => {
  it('pages and drops empty optional filters', async () => {
    const { call } = await run('google_tasks', 'list_tasks', { inputs: { page_token: 'P2', due_min: '', updated_min: '2026-10-01T00:00:00Z' } })
    const u = new URL(call.url)
    expect(u.searchParams.get('pageToken')).toBe('P2')
    expect(u.searchParams.has('dueMin')).toBe(false)
    expect(u.searchParams.get('updatedMin')).toBe('2026-10-01T00:00:00Z')
  })

  it('creates tasks with only the fields given', async () => {
    const { call } = await run('google_tasks', 'create_task', { inputs: { title: 'Call "Ada"', due_date: '2026-11-01T00:00:00.000Z', parent_task_id: 'p1' } })
    expect(JSON.parse(call.body!)).toEqual({ title: 'Call "Ada"', due: '2026-11-01T00:00:00.000Z', status: 'needsAction' })
    expect(new URL(call.url).searchParams.get('parent')).toBe('p1')
  })
})

describe('Firebase', () => {
  it('builds the /v1/projects/ base URL (project field, legacy app_id, or the service account project)', () => {
    const def = getConnectorDefinition('firebase')!
    expect(def.buildIntegrationConfig({ project_id: 'p1', database_id: '(default)' }, { service_account_json: FAKE_SA }).base_url)
      .toBe('https://firestore.googleapis.com/v1/projects/p1/databases/(default)/documents')
    expect(def.buildIntegrationConfig({ app_id: 'legacy-proj', database_id: 'named-db' }, { service_account_json: FAKE_SA }).base_url)
      .toBe('https://firestore.googleapis.com/v1/projects/legacy-proj/databases/named-db/documents')
    expect(def.buildIntegrationConfig({ database_id: '' }, { service_account_json: FAKE_SA }).base_url)
      .toBe('https://firestore.googleapis.com/v1/projects/demo-project/databases/(default)/documents')
  })

  it('repairs integrations stored with the /v1/apps/ URL', async () => {
    const def = getConnectorDefinition('firebase')!
    const stored = { base_url: 'https://firestore.googleapis.com/v1/apps/my-proj/databases/(default)/documents', auth_type: 'bearer', auth_config: { _executor: 'google_service_account', service_account_json: FAKE_SA, scopes: ['https://www.googleapis.com/auth/datastore'] } }
    const upgraded = def.upgradeIntegrationConfig!(stored)
    expect(upgraded.base_url).toBe('https://firestore.googleapis.com/v1/projects/my-proj/databases/(default)/documents')
    expect(def.upgradeIntegrationConfig!(upgraded)).toEqual(upgraded)
    const { call } = await run('firebase', 'get_document', { mutateReference: (ref) => { ref.integration.config = stored } })
    expect(call.url).toBe('https://firestore.googleapis.com/v1/projects/my-proj/databases/(default)/documents/users/alice')
  })

  it('keeps multi-segment paths, encodes segments and refuses traversal', async () => {
    const { call } = await run('firebase', 'get_document', { inputs: { document_path: 'companies/acme co/orders/o#1' } })
    expect(call.url).toBe(`${FS}/companies/acme%20co/orders/o%231`)
    await expect(run('firebase', 'delete_document', { inputs: { document_path: 'users/../../other-db' } })).rejects.toThrow(/relative path segment/)
  })

  it('passes update mask and preconditions only when set', async () => {
    const { call } = await run('firebase', 'update_document', { inputs: { update_mask: 'status', current_document_exists: true } })
    const u = new URL(call.url)
    expect(u.searchParams.get('updateMask.fieldPaths')).toBe('status')
    expect(u.searchParams.get('currentDocument.exists')).toBe('true')
    expect(u.searchParams.has('currentDocument.updateTime')).toBe(false)
  })
})

describe('Firestore value helpers', () => {
  it('round-trips plain JSON through typed values', () => {
    const plain = { name: 'Ada', age: 36, ratio: 0.5, admin: false, nothing: null, tags: ['a', 1], address: { city: 'London' } }
    const fields = toFirestoreFields(plain)
    expect(fields.age).toEqual({ integerValue: '36' })
    expect(fields.ratio).toEqual({ doubleValue: 0.5 })
    expect(fields.tags).toEqual({ arrayValue: { values: [{ stringValue: 'a' }, { integerValue: '1' }] } })
    expect(fields.address).toEqual({ mapValue: { fields: { city: { stringValue: 'London' } } } })
    expect(fromFirestoreFields(fields)).toEqual(plain)
    expect(toFirestoreFields({ at: '2026-10-30T00:00:00Z' }, { timestamps: true }).at).toEqual({ timestampValue: '2026-10-30T00:00:00Z' })
    expect(fromFirestoreDocument({ name: 'projects/p/databases/(default)/documents/users/alice', fields: { n: { stringValue: 'a' } } }))
      .toMatchObject({ id: 'alice', path: 'users/alice', data: { n: 'a' } })
  })
})

describe('Box', () => {
  it('mints a Client Credentials token for the enterprise or a user', async () => {
    const creds = { auth_type: 'client_credentials', client_id: 'cid-fake', client_secret: 'csecret-fake', enterprise_id: 'ent-1' }
    const { requests, call } = await run('box', 'get_current_user', { credentials: creds })
    const token = requests.find((r) => r.url === 'https://api.box.com/oauth2/token')!
    expect(new URLSearchParams(token.body!).get('box_subject_type')).toBe('enterprise')
    expect(new URLSearchParams(token.body!).get('box_subject_id')).toBe('ent-1')
    expect(call.headers.authorization).toBe('Bearer ***')

    const asUser = await run('box', 'get_current_user', { credentials: { ...creds, box_user_id: 'u-42' } })
    const t2 = asUser.requests.find((r) => r.url === 'https://api.box.com/oauth2/token')!
    expect(new URLSearchParams(t2.body!).get('box_subject_type')).toBe('user')
    expect(new URLSearchParams(t2.body!).get('box_subject_id')).toBe('u-42')
  })

  it('sends As-User when configured and pages folders with markers', async () => {
    const { call } = await run('box', 'list_folder', { credentials: { as_user_id: '777' }, inputs: { marker: 'MRK' } })
    expect(call.headers['as-user']).toBe('777')
    expect(new URL(call.url).searchParams.get('marker')).toBe('MRK')
    expect(new URL(call.url).searchParams.get('usemarker')).toBe('true')
  })

  it('escapes JSON values in shared links and collaborations', async () => {
    const { call } = await run('box', 'create_shared_link', { inputs: { access: 'open', password: 'p"w' } })
    expect(JSON.parse(call.body!)).toEqual({ shared_link: { access: 'open', password: 'p"w' } })
  })
})

describe('Dropbox', () => {
  it('refreshes short-lived tokens from the stored refresh token', async () => {
    const { requests, call } = await run('dropbox', 'get_account', { credentials: { access_token: 'sl.stale-fake', refresh_token: 'rt-fake', app_key: 'appkey-fake', app_secret: 'appsecret-fake' } })
    const token = requests.find((r) => r.url === 'https://api.dropboxapi.com/oauth2/token')!
    const form = new URLSearchParams(token.body!)
    expect(form.get('grant_type')).toBe('refresh_token')
    expect(form.get('refresh_token')).toBe('rt-fake')
    expect(form.get('client_id')).toBe('appkey-fake')
    expect(call.headers.authorization).toBe('Bearer ***')
  })

  it('keeps the static token when no refresh credentials are stored', async () => {
    const { requests } = await run('dropbox', 'get_account', { credentials: { access_token: 'sl.fake' } })
    expect(requests).toHaveLength(1)
  })

  it('uses the content host with the argument in Dropbox-API-Arg', async () => {
    const dl = await run('dropbox', 'download')
    expect(dl.call.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(JSON.parse(dl.call.headers['dropbox-api-arg'])).toEqual({ path: '/Reports/Q3.pdf' })
    const up = await run('dropbox', 'upload', { inputs: { mode: 'overwrite', autorename: true } })
    expect(JSON.parse(up.call.headers['dropbox-api-arg'])).toEqual({ path: '/Reports/Q3.pdf', mode: 'overwrite', autorename: true, mute: false })
    expect(up.call.headers['content-type']).toBe('application/octet-stream')
  })

  it('sends typed numbers/booleans and drops empty search options', async () => {
    const { call } = await run('dropbox', 'search', { inputs: { query: 'q "x"', extensions: '["pdf"]', max_results: 5 } })
    expect(JSON.parse(call.body!)).toEqual({ query: 'q "x"', options: { max_results: 5, file_extensions: ['pdf'] } })
  })

  // Needs the runtime to render JSON header templates (Dropbox-API-Arg) as
  // JSON with non-ASCII escaped as \uXXXX — see the audit notes. Flip to it()
  // once the header-template hook lands.
  it('escapes quotes and non-ASCII in Dropbox-API-Arg', async () => {
    const { call } = await run('dropbox', 'download', { inputs: { path: '/Résumé "final" 简历.pdf' } })
    expect(call.headers['dropbox-api-arg']).toMatch(/^[\x20-\x7e]+$/)
    expect(JSON.parse(call.headers['dropbox-api-arg'])).toEqual({ path: '/Résumé "final" 简历.pdf' })
  })
})
