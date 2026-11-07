import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/cron-auth'
import { fromSession, isServiceError } from '@/lib/services/context'
import { authorizeFileDownload, loadFormFile, openFormFileObject } from '@/lib/services/form-files'
import { serveFormFileDownload } from '@/lib/services/form-file-download'
import { authorizeTaskAttachmentDownload, isTaskAttachmentDownload, loadTaskAttachmentDownload } from '@/lib/services/task-attachments'

/**
 * Uploaded form attachments and task attachments (lib/services/task-attachments.ts):
 * GET|HEAD /attachments/<id>[?inline=1].
 * Authorised per request, then a short-lived signed link
 * (lib/services/form-file-download.ts). Never public, never cached by proxies.
 */

export const dynamic = 'force-dynamic'

async function handle(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return serveFormFileDownload(request, id, {
    load: async (fileId) => {
      const db = createServiceClient() as never
      return (await loadFormFile(db, fileId)) ?? loadTaskAttachmentDownload(db, fileId)
    },
    session: async (tenantId) => {
      try {
        return await fromSession({ tenantId })
      } catch (error) {
        if (isServiceError(error) && error.code === 'unauthorized') return null
        throw error
      }
    },
    // Task attachments: the task's people; the authorised download is audited.
    authorize: (ctx, row) => (isTaskAttachmentDownload(row) ? authorizeTaskAttachmentDownload(ctx, row) : authorizeFileDownload(ctx, row)),
    open: openFormFileObject,
  })
}

export const GET = handle
export const HEAD = handle
