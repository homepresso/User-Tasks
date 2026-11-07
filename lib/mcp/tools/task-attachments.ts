import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { fromMcpContext } from '@/lib/services/context'
import { messageOf } from './_util'
import { MCP_UPLOAD_MAX_BYTES } from './files'

/*
 * Task attachments for agents (lib/services/task-attachments.ts): list,
 * attach (base64 in the call, or a direct upload for larger files), delete,
 * and a short-lived download link. Registered with the task tools.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const meta = {
  task_id: z.string().describe('The task'),
  file_name: z.string().describe('File name with its extension (e.g. contract.pdf)'),
  name: z.string().optional().describe('Display name (default: the file name without its extension)'),
  type: z.string().optional().describe('Type, free text (default Other). Suggested: Contract, Invoice, Receipt, Evidence, Image, Other'),
  description: z.string().optional().describe('Description'),
}

export function registerTaskAttachmentTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)
  const load = () => import('@/lib/services/task-attachments')

  server.tool('tasks_attachments_list', 'List the files on a task\'s Attachments tab (name, type, description, file name, MIME type, size, uploader, date, url, storage_ref) with can_add / can_delete for the caller. Readers of the task only.', {
    task_id: z.string().describe('The task'),
  }, async (args) => run(async () => (await load()).listTaskAttachments(svc(), args.task_id)))

  server.tool('tasks_attachments_add', `Attach a small file (base64, at most ${MCP_UPLOAD_MAX_BYTES / 1024 / 1024} MB) to an open task you can work on, with a name, type and description. The server checks the size, the type by content and blocked types. Returns { mode: "uploaded", attachment }.`, {
    ...meta,
    content_base64: z.string().describe('The file, base64-encoded'),
  }, async (args) => run(async () => {
    const approx = Math.floor(args.content_base64.replace(/\s+/g, '').length * 3 / 4)
    if (approx > MCP_UPLOAD_MAX_BYTES) throw new Error(`The file is larger than ${MCP_UPLOAD_MAX_BYTES / 1024 / 1024} MB: use tasks_attachments_add_init (a direct upload) instead`)
    return (await load()).apiAddTaskAttachment(svc(), args.task_id, { ...args })
  }))

  server.tool('tasks_attachments_add_init', 'Start a direct upload of a larger task attachment: returns { mode: "direct", attachment_id, upload: { url, method, headers } } — PUT the bytes to the URL with exactly those headers, then call tasks_attachments_complete — or { mode: "server", max_bytes } when the storage can\'t sign uploads (use tasks_attachments_add).', {
    ...meta,
    size: z.number().describe('File size in bytes'),
  }, async (args) => run(async () => (await load()).apiAddTaskAttachment(svc(), args.task_id, { ...args })))

  server.tool('tasks_attachments_complete', 'Finish a direct upload (tasks_attachments_add_init): the server reads the stored file back and verifies it; a file that fails is deleted. Returns { attachment }.', {
    task_id: z.string().describe('The task'),
    attachment_id: z.string().describe('attachment_id from tasks_attachments_add_init'),
  }, async (args) => run(async () => (await load()).apiCompleteTaskAttachment(svc(), args.task_id, args.attachment_id)))

  server.tool('tasks_attachments_delete', 'Delete a task attachment: its uploader, or a holder of tasks.delete. Refused while the task\'s form is on legal hold. Audited.', {
    task_id: z.string().describe('The task'),
    attachment_id: z.string().describe('The attachment'),
  }, async (args) => run(async () => (await load()).deleteTaskAttachment(svc(), args.task_id, args.attachment_id)))

  server.tool('tasks_attachments_download_url', 'A signed download link for a task attachment, valid for 5 minutes (no session needed). Readers of the task only; every call is audited.', {
    task_id: z.string().describe('The task'),
    attachment_id: z.string().describe('The attachment'),
  }, async (args) => run(async () => (await load()).taskAttachmentDownloadUrl(svc(), args.task_id, args.attachment_id)))
}
