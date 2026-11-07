import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams, looseObject } from './common'

/**
 * Task attachments (lib/services/task-attachments.ts): files on a task's
 * Attachments tab, with a name, a type and a description. Readers of the
 * task list and download them; people who can work on the open task add
 * them; the uploader or tasks.delete deletes them (soft delete; never while
 * the task's form is on legal hold). Adds, deletes and downloads are written
 * to the audit log.
 */

const tags = ['Tasks']

const attachmentParams = z.object({
  id: z.string().describe('Task id'),
  attachmentId: z.string().describe('Attachment id'),
})

export const taskAttachmentObject = z.looseObject({
  id: z.string(),
  task_id: z.string(),
  name: z.string(),
  type: z.string().describe('Free text; suggested: Contract, Invoice, Receipt, Evidence, Image, Other'),
  description: z.string(),
  file_name: z.string(),
  mime: z.string(),
  mime_type: z.string().describe('Same as mime (what file steps read)'),
  size: z.number().int(),
  url: z.string().describe('Authorised link /attachments/<id> (signed-in people who can see the task)'),
  storage_ref: z.string().describe('storage://form-files/… — what workflow file steps read'),
  checksum_sha256: z.string(),
  uploaded_by: z.string().nullable().describe('null when a workflow step attached it'),
  uploaded_by_name: z.string().nullable().optional(),
  created_at: z.string(),
})

export const addTaskAttachmentBody = z.object({
  file_name: z.string().min(1).max(1000).describe('File name (its extension must be an allowed type)'),
  name: z.string().max(200).optional().describe('Display name (default: the file name without its extension)'),
  type: z.string().max(60).optional().describe('Type, free text (default Other). Suggested: Contract, Invoice, Receipt, Evidence, Image, Other'),
  description: z.string().max(2000).optional().describe('Description'),
  size: z.number().int().positive().optional().describe('Size in bytes: without content_base64, starts a direct upload to storage'),
  content_base64: z.string().optional().describe('The file itself, base64 (small files; the request body limit applies). Omit to get a signed upload URL'),
})

export const listTaskAttachmentsEndpoint = defineEndpoint({
  method: 'GET', path: '/tasks/{id}/attachments', operationId: 'listTaskAttachments', tags,
  summary: 'List a task\'s attachments', permission: 'tasks.view_own',
  description: 'The files on the task\'s Attachments tab, oldest first, with `can_add` (you can work on the open task), per-attachment `can_delete`, `legal_hold` (the task\'s form is held: nothing can be deleted), `type_suggestions` and `max_file_bytes`. Visible to the assignee, collaborators, team members, managers of an assignee, the assigner and holders of tasks.view_all / tasks.manage_queue; anyone else gets 404.',
  params: idParams,
  response: z.looseObject({
    task_id: z.string(),
    attachments: z.array(taskAttachmentObject.extend({ can_delete: z.boolean() })),
    can_add: z.boolean(), legal_hold: z.boolean(), type_suggestions: z.array(z.string()), max_file_bytes: z.number().int(),
  }),
  listKey: 'attachments',
  cli: { resource: 'tasks', verb: 'attachments', positional: ['id'] },
})

export const addTaskAttachmentEndpoint = defineEndpoint({
  method: 'POST', path: '/tasks/{id}/attachments', operationId: 'addTaskAttachment', tags,
  summary: 'Attach a file to a task (or start a direct upload)', permission: 'tasks.complete',
  description: 'You must be able to work on the open task (assignee, collaborator, team member, a manager of an assignee, tasks.complete_any, or tasks.manage_queue on a non-workflow task); needs a user-bound credential. With content_base64: the file is checked (size, type by content, blocked types, SVG sanitising, optional virus scan) and attached; returns `{ mode: "uploaded", attachment }`. With size only: `{ mode: "direct", attachment_id, upload: { url, method, headers }, expires_at }` — PUT the bytes to the URL with exactly those headers, then POST /tasks/{id}/attachments/{attachment_id}/complete — or `{ mode: "server", max_bytes }` when the storage can\'t sign uploads (send content_base64 instead).',
  params: idParams, body: addTaskAttachmentBody, successStatus: 201,
  multipart: { files: { file: { name: 'file_name', content: 'content_base64' } } },
  response: z.looseObject({
    mode: z.enum(['uploaded', 'direct', 'server']), attachment: taskAttachmentObject.optional(), attachment_id: z.string().optional(),
    upload: looseObject.optional(), expires_at: z.string().optional(), max_bytes: z.number().int().optional(),
  }),
  cli: { resource: 'tasks', verb: 'attachment-add', positional: ['id'] },
})

export const completeTaskAttachmentEndpoint = defineEndpoint({
  method: 'POST', path: '/tasks/{id}/attachments/{attachmentId}/complete', operationId: 'completeTaskAttachment', tags,
  summary: 'Finish a direct upload of a task attachment', permission: 'tasks.complete',
  description: 'The uploader only, within the upload window (15 minutes by default), while they can still work on the task. The object is read back and verified; a file that fails is deleted and the reason returned.',
  params: attachmentParams, successStatus: 201,
  response: z.looseObject({ attachment: taskAttachmentObject }),
  cli: { resource: 'tasks', verb: 'attachment-complete', positional: ['id', 'attachmentId'] },
})

export const deleteTaskAttachmentEndpoint = defineEndpoint({
  method: 'DELETE', path: '/tasks/{id}/attachments/{attachmentId}', operationId: 'deleteTaskAttachment', tags,
  summary: 'Delete a task attachment', permission: 'tasks.view_own',
  description: 'The uploader (while they can see the task) or a holder of tasks.delete. Refused (409) while the task\'s form is on legal hold. The attachment disappears at once; the stored file is purged after TASK_ATTACHMENT_DELETED_RETENTION_DAYS (default 30).',
  params: attachmentParams,
  response: z.looseObject({ deleted: z.literal(true), id: z.string() }),
  cli: { resource: 'tasks', verb: 'attachment-delete', positional: ['id', 'attachmentId'] },
})

export const taskAttachmentDownloadEndpoint = defineEndpoint({
  method: 'GET', path: '/tasks/{id}/attachments/{attachmentId}/download', operationId: 'getTaskAttachmentDownloadUrl', tags,
  summary: 'A short-lived download link for a task attachment', permission: 'tasks.view_own',
  description: 'Returns `{ url, expires_at, attachment }`: a signed link valid for 5 minutes that needs no session (or the plain /attachments/<id> link, which needs a signed-in session, when the instance has no signing key). Every call is written to the audit log.',
  params: attachmentParams,
  response: z.looseObject({ url: z.string(), expires_at: z.string().nullable(), attachment: taskAttachmentObject }),
  cli: { resource: 'tasks', verb: 'attachment-download', positional: ['id', 'attachmentId'] },
})

export const taskAttachmentEndpoints = [
  listTaskAttachmentsEndpoint, addTaskAttachmentEndpoint, completeTaskAttachmentEndpoint, deleteTaskAttachmentEndpoint, taskAttachmentDownloadEndpoint,
]
