import { NextRequest, NextResponse } from "next/server"
import { fromSession, isServiceError } from "@/lib/services/context"
import { createWorkflowWebhook, rotateWebhookSecret } from "@/lib/services/webhooks"

/*
 * Session route used by the workflow editor's webhook trigger panel. Thin
 * wrapper over lib/services/webhooks (shared with /api/v1/workflows/{id}/webhooks):
 * the tenant comes from the session (never the request body), the workflow
 * must belong to it, settings.manage_webhooks is required and the secret is
 * generated server-side and returned once.
 */

function failure(error: unknown) {
  if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error("[webhooks/create-key]", error)
  return NextResponse.json({ error: "Internal server error" }, { status: 500 })
}

export async function POST(request: NextRequest) {
  try {
    const { workflow_id, slug } = await request.json().catch(() => ({}))
    if (!workflow_id) return NextResponse.json({ error: "workflow_id is required" }, { status: 400 })
    const { webhook, secret } = await createWorkflowWebhook(await fromSession(), String(workflow_id), { slug: slug ? String(slug) : undefined })
    return NextResponse.json({ created: true, raw_key: secret, prefix: webhook.api_key_prefix, webhook_id: webhook.id })
  } catch (error) {
    return failure(error)
  }
}

// Regenerate the key of an existing webhook.
export async function PUT(request: NextRequest) {
  try {
    const { webhook_id } = await request.json().catch(() => ({}))
    if (!webhook_id) return NextResponse.json({ error: "webhook_id is required" }, { status: 400 })
    const { webhook, secret } = await rotateWebhookSecret(await fromSession(), String(webhook_id))
    return NextResponse.json({ regenerated: true, raw_key: secret, prefix: webhook.api_key_prefix })
  } catch (error) {
    return failure(error)
  }
}
