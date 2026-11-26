import { after, NextRequest, NextResponse } from "next/server"
import { getServiceDb } from "@/lib/providers/db"
import { isMissingSha256Column, verifyWebhookSecret } from "@/lib/webhook-secret"
import { handsOff, QueuedRunTimeoutError, startRun, type RunOutcome } from "@/lib/processing/dispatch"
import { processWorkflowQueueBatch } from "@/lib/workflow-queue-processor"
import { kickQueueProcessor } from "@/lib/process-queue"
import { safeWebhookResponseHeaders, webhookMaxBodyBytes, webhookRateLimitPerMinute } from "@/lib/webhook-response"
import { capResponseBody, ResponseBodyTooLargeError } from "@/lib/capped-response"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  try {
  const supabase = getServiceDb({ anonFallback: true })

  // Get slug from query param or header
  const url = new URL(request.url)
  const slug = url.searchParams.get("hook")
  if (!slug) {
    return NextResponse.json(
      { error: "Missing webhook slug. Use ?hook=your-slug" },
      { status: 400 }
    )
  }

  // Find webhook by slug (without api_key_sha256 until its migration is applied)
  const findWebhook = (columns: string) => supabase
    .from("workflow_webhooks")
    .select(`${columns}, workflow:workflows(id, is_active, trigger_type, published_version_id)`)
    .eq("slug", slug)
    .eq("is_active", true)
    .single()
  const baseColumns = "id, slug, tenant_id, is_active, api_key_hash, api_key_prefix, payload_mapping, receive_count"
  let found = await findWebhook(`${baseColumns}, api_key_sha256`)
  const hasSha256Column = !isMissingSha256Column(found.error)
  if (!hasSha256Column) found = await findWebhook(baseColumns)
  const webhook = found.data as any

  if (!webhook) {
    return NextResponse.json(
      { error: "Webhook not found or inactive" },
      { status: 404 }
    )
  }

  // Per-webhook rate limit (counted before the key check, so guessing keys is throttled too).
  const limited = await rateLimit(`webhook:${webhook.id}`, { max: webhookRateLimitPerMinute(), windowMs: 60_000 })
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests to this webhook" },
      { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))) } },
    )
  }

  // Verify API key
  const authHeader = request.headers.get("Authorization")
  const apiKeyParam = url.searchParams.get("key")
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : apiKeyParam

  if (!token) {
    return NextResponse.json(
      { error: "Missing API key. Send as Bearer token or ?key= param" },
      { status: 401 }
    )
  }

  // SHA-256 + constant-time compare; legacy bcrypt-only rows verify once and
  // are upgraded (lib/webhook-secret). Plaintext keys are never stored.
  const check = await verifyWebhookSecret(webhook, token)
  if (!check.valid) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 })
  }
  if (check.upgradeSha256 && hasSha256Column) {
    const sha256 = check.upgradeSha256
    after(async () => {
      // Only the secret just verified: a rotation in between changed api_key_hash.
      await supabase
        .from("workflow_webhooks")
        .update({ api_key_sha256: sha256 } as any)
        .eq("id", webhook.id)
        .eq("api_key_hash", webhook.api_key_hash)
        .is("api_key_sha256" as any, null)
    })
  }

  // Parse incoming payload
  // Capped (WEBHOOK_MAX_BODY_BYTES): the body is read into memory.
  let payload: Record<string, any> = {}
  let rawBody = ""
  try {
    rawBody = await capResponseBody(
      new Response(request.body, { headers: { "content-length": request.headers.get("content-length") ?? "" } }),
      webhookMaxBodyBytes(),
    ).text()
  } catch (error) {
    if (error instanceof ResponseBodyTooLargeError) {
      return NextResponse.json({ error: `Payload too large (max ${webhookMaxBodyBytes()} bytes)` }, { status: 413 })
    }
    throw error
  }
  try {
    if (rawBody.trim()) payload = JSON.parse(rawBody)
  } catch {
    // Not JSON: an empty payload, as before
  }

  // Apply payload mapping — extract fields from incoming data into variables
  const mappings = Array.isArray(webhook.payload_mapping) ? webhook.payload_mapping : []
  // Spread all top-level payload fields as variables, then overlay explicit mappings
  const variables: Record<string, any> = { _raw: payload, ...payload }

  for (const mapping of mappings) {
    const value = getNestedValue(payload, mapping.incoming_field)
    if (value !== undefined) {
      variables[mapping.variable_name] = value
    }
  }

  after(async () => {
    await supabase
      .from("workflow_webhooks")
      .update({
        last_received_at: new Date().toISOString(),
        receive_count: (webhook.receive_count ?? 0) + 1,
      })
      .eq("id", webhook.id)
  })

  const workflow = webhook.workflow as any
  if (!workflow || !workflow.is_active) {
    return NextResponse.json({
      received: true,
      queued: false,
      reason: "Workflow is inactive",
    })
  }

  if (workflow.trigger_type === 'middleware_received') {
    // Request/response: runs here, or on a processing worker while the caller
    // waits (lib/processing/dispatch; 504 when it does not finish in time).
    let result: RunOutcome
    try {
      result = await startRun({
        workflowId: workflow.id,
        tenantId: webhook.tenant_id,
        variables,
        initiator: { userId: null, via: "webhook" },
        priority: 100,
      })
    } catch (error) {
      if (error instanceof QueuedRunTimeoutError) {
        return NextResponse.json({ received: true, error: "The workflow did not respond in time", job_id: error.jobId }, { status: 504 })
      }
      throw error
    }

    const response = result.response ?? {
      statusCode: 200,
      headers: {},
      bodyType: 'json' as const,
      body: { ok: true, status: result.status, reason: result.reason ?? null },
    }

    if (response.bodyType === 'file') {
      return new NextResponse(response.body as BodyInit, {
        status: response.statusCode,
        headers: safeWebhookResponseHeaders(response.headers),
      })
    }

    if (response.bodyType === 'text') {
      return new NextResponse(String(response.body ?? ''), {
        status: response.statusCode,
        headers: safeWebhookResponseHeaders(response.headers),
      })
    }

    return new NextResponse(JSON.stringify(response.body ?? null), {
      status: response.statusCode,
      headers: safeWebhookResponseHeaders(response.headers),
    })
  }

  const triggerData = { ...variables, _version_id: workflow.published_version_id ?? null }

  // Try to enqueue to job queue
  const { data: jobId, error: enqueueError } = await supabase.rpc("enqueue_workflow", {
    p_workflow_id: workflow.id,
    p_tenant_id: webhook.tenant_id,
    p_task_id: null,
    p_trigger_type: "webhook_received",
    p_trigger_data: triggerData,
    p_priority: 0,
    p_delay_seconds: 0,
  })

  if (!enqueueError) {
    // Web mode: run a small batch right after the response. Queue mode: the
    // processing workers run it (the kick only wakes them).
    const local = !(await handsOff())
    after(async () => {
      if (!local) return kickQueueProcessor()
      try {
        await processWorkflowQueueBatch({ batchSize: 5 })
      } catch {
        kickQueueProcessor()
      }
    })

    return NextResponse.json({
      received: true,
      queued: true,
      job_id: jobId,
    })
  }

  // Queue failed — try direct execution (web mode only: with separate
  // workers the web app runs nothing; the sender retries).
  if (await handsOff()) {
    return NextResponse.json({ received: true, error: "Could not queue the workflow; try again" }, { status: 503 })
  }
try {
    const result = await startRun({
      workflowId: workflow.id,
      tenantId: webhook.tenant_id,
      variables,
      initiator: { userId: null, via: "webhook" },
    })
    return NextResponse.json({
      received: true,
      executed: true,
      run_status: result.status,
    })
  } catch {
    return NextResponse.json(
      { received: true, error: "Workflow execution failed" },
      { status: 500 }
    )
  }
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => {
    if (o === undefined || o === null) return undefined
    // Handle array indices like "items[0]"
    const match = k.match(/^(\w+)\[(\d+)\]$/)
    if (match) return o[match[1]]?.[Number(match[2])]
    return o[k]
  }, obj)
}
