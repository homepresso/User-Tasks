import { apiRoute } from '@/lib/api/route'
import { inspectPackageEndpoint } from '@/lib/api-schemas/packages'
import { inspectAgainstWorkspace } from '@/lib/services/package-installs'
import { downloadPackageVersion } from '@/lib/services/packages'

export const maxDuration = 60

/** POST /api/v1/packages/inspect */
export const POST = apiRoute(inspectPackageEndpoint, async ({ ctx, body }) => {
  const file = body.file ?? (body.package_id ? Buffer.from((await downloadPackageVersion(ctx, body.package_id, body.version ?? 'latest')).bytes).toString('base64') : '')
  return inspectAgainstWorkspace(ctx, { file })
})
