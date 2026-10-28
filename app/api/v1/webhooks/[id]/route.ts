import { apiRoute } from '@/lib/api/route'
import { deleteWebhookEndpoint, getWebhookEndpoint, updateWebhookEndpoint } from '@/lib/api-schemas/webhooks'
import { deleteWebhook, getWebhook, updateWebhook } from '@/lib/services/webhooks'

/** GET /api/v1/webhooks/{id} */
export const GET = apiRoute(getWebhookEndpoint, async ({ ctx, params }) => getWebhook(ctx, params.id))

/** PATCH /api/v1/webhooks/{id} */
export const PATCH = apiRoute(updateWebhookEndpoint, async ({ ctx, params, body }) => updateWebhook(ctx, params.id, body))

/** DELETE /api/v1/webhooks/{id} */
export const DELETE = apiRoute(deleteWebhookEndpoint, async ({ ctx, params }) => deleteWebhook(ctx, params.id))
