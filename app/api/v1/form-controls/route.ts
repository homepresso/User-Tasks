import { apiRoute } from '@/lib/api/route'
import { createFormControlEndpoint, listFormControlsEndpoint } from '@/lib/api-schemas/form-controls'
import { resolvePage } from '@/lib/services/_shared'
import { decodeBase64Package, importFormControlFromUrl, listFormControls, uploadFormControl } from '@/lib/services/form-controls'
import { ServiceError } from '@/lib/services/context'

/** GET /api/v1/form-controls — the workspace's custom form controls. */
export const GET = apiRoute(listFormControlsEndpoint, async ({ ctx, query }) =>
  listFormControls(ctx, { search: query.search, enabled: query.enabled === undefined ? undefined : query.enabled === 'true' }, resolvePage(query)))

/** POST /api/v1/form-controls — upload a package (zip / module + manifest) or import from a URL. */
export const POST = apiRoute(createFormControlEndpoint, async ({ ctx, body }) => {
  if (body.url) return importFormControlFromUrl(ctx, { url: body.url, manifest_url: body.manifest_url ?? null })
  if (body.package_base64) return uploadFormControl(ctx, { zip: decodeBase64Package(body.package_base64) })
  if (body.module) return uploadFormControl(ctx, { module: body.module, manifest: body.manifest, signature: body.signature })
  throw ServiceError.validation('Send package_base64 (a zip), module + manifest, or url')
})
