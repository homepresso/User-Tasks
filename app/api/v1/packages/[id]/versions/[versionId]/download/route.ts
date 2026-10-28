import { apiRoute } from '@/lib/api/route'
import { downloadPackageVersionEndpoint } from '@/lib/api-schemas/packages'
import { downloadPackageVersion } from '@/lib/services/packages'

/** GET /api/v1/packages/{id}/versions/{versionId}/download — the .utpkg as base64 */
export const GET = apiRoute(downloadPackageVersionEndpoint, async ({ ctx, params }) => {
  const file = await downloadPackageVersion(ctx, params.id, params.versionId)
  return { file_name: file.file_name, checksum: file.checksum, size_bytes: file.bytes.byteLength, file_base64: Buffer.from(file.bytes).toString('base64') }
})
