import { apiRoute } from '@/lib/api/route'
import { uploadWorkflowActionEndpoint } from '@/lib/api-schemas/workflow-activities'
import { decodeBase64Package } from '@/lib/services/form-controls'
import { ServiceError } from '@/lib/services/context'
import { uploadWorkflowAction } from '@/lib/services/workflow-activities'

/** POST /api/v1/workflow-activities/upload — a packaged action (zip, or module + manifest). */
export const POST = apiRoute(uploadWorkflowActionEndpoint, async ({ ctx, body }) => {
  if (body.package_base64) return uploadWorkflowAction(ctx, { zip: decodeBase64Package(body.package_base64) })
  if (body.module) return uploadWorkflowAction(ctx, { module: body.module, manifest: body.manifest, signature: body.signature })
  throw ServiceError.validation('Send package_base64 (a zip) or module + manifest')
})
