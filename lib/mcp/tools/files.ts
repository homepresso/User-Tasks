import type { McpToolServer } from '../server'
import type { McpContext } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext } from '@/lib/services/context'
import { messageOf } from './_util'

/*
 * Attachments uploads for agents: a file goes into a context (an open task,
 * a reusable form's submission, a workflow's start form), then its id is the
 * field's value in tasks_complete / forms_submit / workflows_start (the
 * server rebuilds the value from its records). Small files in the call
 * (base64, at most MCP_UPLOAD_MAX_BYTES); larger ones through a direct
 * upload (signed URL, then files_upload_complete). lib/services/form-files
 * checks permissions per context, sizes, types by content and blocked types.
 */

/** Largest file files_upload takes inline (base64 in the tool call). */
export const MCP_UPLOAD_MAX_BYTES = 5 * 1024 * 1024

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const context = {
  task_id: z.string().optional().describe('Upload into this open task\'s form (you must be able to act on it)'),
  form_id: z.string().optional().describe('Upload for a submission of this reusable form'),
  workflow_id: z.string().optional().describe('Upload for this workflow\'s start-form attachments input'),
  field_key: z.string().describe('The Attachments field (or start-form input) key'),
  name: z.string().describe('File name with its extension (e.g. receipt.pdf)'),
}

export function registerFileTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('files_upload', `Upload a small file (base64, at most ${MCP_UPLOAD_MAX_BYTES / 1024 / 1024} MB) for an Attachments field: pass exactly one of task_id, form_id or workflow_id. The server checks the size, the type by its content and blocked types. Returns the file object; put its id in the field's value list for tasks_complete / forms_submit / workflows_start (same user). Unused uploads are deleted after 24 hours.`, {
    ...context,
    content_base64: z.string().describe('The file, base64-encoded'),
  }, async (args) => run(async () => {
    const approx = Math.floor(args.content_base64.replace(/\s+/g, '').length * 3 / 4)
    if (approx > MCP_UPLOAD_MAX_BYTES) throw new Error(`The file is larger than ${MCP_UPLOAD_MAX_BYTES / 1024 / 1024} MB: use files_upload_init (a direct upload) instead`)
    const { apiUploadFile } = await import('@/lib/services/form-files')
    return apiUploadFile(svc(), { task_id: args.task_id, form_id: args.form_id, workflow_id: args.workflow_id, field_key: args.field_key, name: args.name, content_base64: args.content_base64 })
  }))

  server.tool('files_upload_init', 'Start a direct upload of a larger file for an Attachments field: returns { mode: "direct", file_id, upload: { url, method, headers } } — PUT the bytes to the URL with exactly those headers, then call files_upload_complete — or { mode: "server", max_bytes } when the storage can\'t sign uploads (use files_upload).', {
    ...context,
    size: z.number().describe('File size in bytes'),
  }, async (args) => run(async () => {
    const { apiUploadFile } = await import('@/lib/services/form-files')
    return apiUploadFile(svc(), { task_id: args.task_id, form_id: args.form_id, workflow_id: args.workflow_id, field_key: args.field_key, name: args.name, size: args.size })
  }))

  server.tool('files_upload_complete', 'Finish a direct upload (files_upload_init): the server reads the stored file back and verifies it; a file that fails is deleted. Returns the file object.', {
    file_id: z.string().describe('file_id from files_upload_init'),
  }, async (args) => run(async () => {
    const { completeDirectUpload } = await import('@/lib/services/form-files')
    return { file: await completeDirectUpload(svc(), args.file_id) }
  }))
}
