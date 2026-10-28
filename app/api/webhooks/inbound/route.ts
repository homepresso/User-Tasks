import { after, NextRequest, NextResponse } from "next/server"
import { getServiceDb } from "@/lib/providers/db"
import bcrypt from "bcryptjs"
import { executeWorkflow } from "@/lib/workflow-engine"
import { processWorkflowQueueBatch } from "@/lib/workflow-queue-processor"
import { kickQueueProcessor } from "@/lib/process-queue"

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

  // Find webhook by slug
  const { data: webhook } = await supabase
    .from("workflow_webhooks")
    .select("id, slug, tenant_id, is_active, api_key_hash, api_key_prefix, payload_mapping, receive_count, workflow:workflows(id, is_active, trigger_type, published_version_id)")
    .eq("slug", slug)
    .eq("is_active", true)
    .single()

  if (!webhook) {
    return NextResponse.json(
      { error: "Webhook not found or inactive" },
      { status: 404 }
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

  // Validate API key via bcrypt hash only (plaintext keys are no longer stored).
  let isValid = false
  if ((webhook as any).api_key_prefix && !token.startsWith((webhook as any).api_key_prefix)) {
    isValid = false
  } else {
    try { isValid = await bcrypt.compare(token, webhook.api_key_hash) } catch { /* invalid hash */ }
  }
  if (!isValid) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 })
  }

  // Parse incoming payload
  let payload: Record<string, any> = {}
  try {
    payload = await request.json()
  } catch {
    // Allow empty body
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
    const result = await executeWorkflow(
      workflow.id,
      undefined,
      false,
      variables,
      undefined,
      undefined,
      undefined,
      { initiator: { userId: null, via: "webhook" } },
    )

    const response = result.response ?? {
      statusCode: 200,
      headers: {},
      bodyType: 'json' as const,
      body: { ok: true, status: result.status, reason: result.reason ?? null },
    }

    if (response.bodyType === 'file') {
      return new NextResponse(response.body as BodyInit, {
        status: response.statusCode,
        headers: response.headers,
      })
    }

    if (response.bodyType === 'text') {
      return new NextResponse(String(response.body ?? ''), {
        status: response.statusCode,
        headers: response.headers,
      })
    }

    return new NextResponse(JSON.stringify(response.body ?? null), {
      status: response.statusCode,
      headers: response.headers,
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
    after(async () => {
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

  // Queue failed — try direct execution
try {
    const result = await executeWorkflow(
      workflow.id,
      undefined,
      false,
      variables,
      undefined,
      undefined,
      undefined,
      { initiator: { userId: null, via: "webhook" } },
    )
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
