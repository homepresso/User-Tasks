import { apiRoute } from '@/lib/api/route'
import { createWorkflowWebhookEndpoint, listWorkflowWebhooksEndpoint } from '@/lib/api-schemas/webhooks'
import { createWorkflowWebhook, listWorkflowWebhooks } from '@/lib/services/webhooks'

/** GET /api/v1/workflows/{id}/webhooks */
export const GET = apiRoute(listWorkflowWebhooksEndpoint, async ({ ctx, params }) => listWorkflowWebhooks(ctx, params.id))

/** POST /api/v1/workflows/{id}/webhooks — the secret is returned once. */
export const POST = apiRoute(createWorkflowWebhookEndpoint, async ({ ctx, params, body }) => createWorkflowWebhook(ctx, params.id, body))
