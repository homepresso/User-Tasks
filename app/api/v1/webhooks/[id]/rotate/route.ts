import { apiRoute } from '@/lib/api/route'
import { rotateWebhookEndpoint } from '@/lib/api-schemas/webhooks'
import { rotateWebhookSecret } from '@/lib/services/webhooks'

/** POST /api/v1/webhooks/{id}/rotate — new secret, returned once. */
export const POST = apiRoute(rotateWebhookEndpoint, async ({ ctx, params }) => rotateWebhookSecret(ctx, params.id))
