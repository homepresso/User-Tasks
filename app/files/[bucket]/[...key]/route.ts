import type { NextRequest } from 'next/server'
import { getStorageProvider } from '@/lib/providers/storage'
import { serveStorageFile } from '@/lib/storage/serve'

/**
 * Stored files, streamed through the configured StorageProvider:
 *
 *   GET|HEAD /files/<bucket>/<key…>
 *
 * Public buckets need no session; private ones need an app-signed URL or a
 * member of the owning tenant (lib/storage/serve.ts). This is where
 * `storage://` references resolve to with the s3 / local / azure_blob / gcs
 * providers (unless a public base URL is configured).
 */

export const dynamic = 'force-dynamic'

async function sessionTenants(): Promise<string[] | null> {
  const { getSessionDbWithUser } = await import('@/lib/providers/db/session')
  const { supabase, user } = await getSessionDbWithUser()
  if (!user) return null
  const { data, error } = await supabase.rpc('get_user_tenant_ids')
  if (error) return null
  return ((data ?? []) as unknown[]).map((row) =>
    String(typeof row === 'object' && row !== null ? Object.values(row)[0] : row))
}

async function handle(request: NextRequest, { params }: { params: Promise<{ bucket: string; key: string[] }> }) {
  const { bucket, key } = await params
  return serveStorageFile(request, bucket, key, { provider: getStorageProvider, sessionTenants })
}

export const GET = handle
export const HEAD = handle
