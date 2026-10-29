import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams, looseObject } from './common'

/**
 * Uploads for Attachments fields from API / MCP / CLI callers. A file is
 * uploaded into a context — a task's form, a reusable form (submit), or a
 * workflow's start form — and its id is then passed as the field's value in
 * POST /tasks/{id}/action, POST /forms/{id}/submit or POST /workflows/start
 * (the server rebuilds the value from its upload records; client-sent file
 * objects are never trusted).
 */

const tags = ['Files']

const fileObject = z.looseObject({
  id: z.string(), name: z.string(), size: z.number().int(), mime_type: z.string(), url: z.string(), storage_ref: z.string(),
  uploaded_by: z.string().nullable(), uploaded_at: z.string(), checksum_sha256: z.string(),
})

export const fileUploadBody = z.object({
  task_id: z.string().optional().describe('Upload into this open task\'s form (you must be able to act on it)'),
  form_id: z.string().optional().describe('Upload for a submission of this reusable form (forms.submit)'),
  workflow_id: z.string().optional().describe('Upload for this workflow\'s start-form attachments input (workflows.activate)'),
  field_key: z.string().min(1).max(64).describe('The Attachments field (or start-form input) key'),
  name: z.string().min(1).max(1000).describe('File name (its extension must be an allowed type)'),
  size: z.number().int().positive().optional().describe('Size in bytes: without content_base64, starts a direct upload to storage'),
  content_base64: z.string().optional().describe('The file itself, base64 (small files; the request body limit applies). Omit to get a signed upload URL'),
})

export const uploadFileEndpoint = defineEndpoint({
  method: 'POST', path: '/files/uploads', operationId: 'uploadFile', tags,
  summary: 'Upload a file for an Attachments field (or start a direct upload)', permission: null,
  description: 'With content_base64: the file is checked (size, type by content, blocked types, SVG sanitising, optional virus scan) and stored; returns `{ mode: "uploaded", file }`. With size only: returns `{ mode: "direct", file_id, upload: { url, method, headers }, expires_at }` — PUT the bytes to the URL with exactly those headers, then POST /files/uploads/{file_id}/complete — or `{ mode: "server", max_bytes }` when the storage can\'t sign uploads (send content_base64 instead). The file is pending until its id is used in a task completion, form submission or workflow start by the same user; unused uploads are deleted after 24 hours. Needs a user-bound credential.',
  body: fileUploadBody, successStatus: 201,
  multipart: { files: { file: { name: 'name', content: 'content_base64' } } },
  response: z.looseObject({ mode: z.enum(['uploaded', 'direct', 'server']), file: fileObject.optional(), file_id: z.string().optional(), upload: looseObject.optional(), expires_at: z.string().optional(), max_bytes: z.number().int().optional() }),
  cli: { resource: 'files', verb: 'upload-init' },
})

export const completeFileUploadEndpoint = defineEndpoint({
  method: 'POST', path: '/files/uploads/{id}/complete', operationId: 'completeFileUpload', tags,
  summary: 'Finish a direct upload (the server verifies the stored file)', permission: null,
  description: 'The uploader only, within the upload window (15 minutes by default). The object is read back and verified; a file that fails (wrong type or size, blocked content) is deleted and the reason returned.',
  params: idParams, successStatus: 201,
  response: z.looseObject({ file: fileObject }),
  cli: { resource: 'files', verb: 'upload-complete', positional: ['id'] },
})

export const fileEndpoints = [uploadFileEndpoint, completeFileUploadEndpoint]
