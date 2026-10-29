import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/cron-auth'
import { fromSession, isServiceError } from '@/lib/services/context'
import { authorizeFileDownload, loadFormFile, openFormFileObject } from '@/lib/services/form-files'
import { serveFormFileDownload } from '@/lib/services/form-file-download'

/**
 * Uploaded form attachments: GET|HEAD /attachments/<id>[?inline=1].
 * Authorised per request, then a short-lived signed link
 * (lib/services/form-file-download.ts). Never public, never cached by proxies.
 */

export const dynamic = 'force-dynamic'

async function handle(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return serveFormFileDownload(request, id, {
    load: (fileId) => loadFormFile(createServiceClient() as never, fileId),
    session: async (tenantId) => {
      try {
        return await fromSession({ tenantId })
      } catch (error) {
        if (isServiceError(error) && error.code === 'unauthorized') return null
        throw error
      }
    },
    authorize: authorizeFileDownload,
    open: openFormFileObject,
  })
}

export const GET = handle
export const HEAD = handle
