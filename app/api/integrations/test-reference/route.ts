import { NextRequest, NextResponse } from 'next/server'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { executeReference } from '@/lib/reference-executor'
import { getCurrentTenantId, getOwnedIntegration, getOwnedReference } from '@/lib/integrations/auth'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { applyAuthHeaders } from '@/lib/integrations/attach-auth'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { reference_id, inputs, capture_schema } = body
  const tenantId = await getCurrentTenantId(supabase, user.id)

  // New path: use shared executor with reference_id + inputs
  if (reference_id) {
    try {
      await getOwnedReference(supabase, tenantId, reference_id)
      const result = await executeReference({
        supabase,
        referenceId: reference_id,
        inputValues: inputs ?? {},
        timeout: 30000,
        caller: { traceId: '', callerType: 'manual_test', callerId: user.id },
        expectedTenantId: tenantId,
      })
      // capture_schema: true folds the response into the reference's model;
      // "auto" only when the model is missing or sample-inferred (first test
      // backfills older references). Needs manage_references; never fails the test.
      if (capture_schema && (result.status ?? 200) < 400 && result.data !== undefined && result.data !== null) {
        try {
          const { fromSession } = await import('@/lib/services/context')
          const { captureReferenceSchema } = await import('@/lib/services/references')
          const responseSchema = await captureReferenceSchema(await fromSession(), reference_id, result.data, { onlyIfInferred: capture_schema === 'auto' })
          return NextResponse.json({ ...result, response_schema: responseSchema })
        } catch {
          // No permission or the write failed — the test result still stands.
        }
      }
      return NextResponse.json(result)
    } catch (e: any) {
      const message = e.message ?? 'Execution failed'
      const status = message === 'Reference not found' ? 404 : 500
      return NextResponse.json({ error: message }, { status })
    }
  }

  // Legacy path: direct URL + method + body (for backward compat with old test UI)
  const { integration_id, url, method, body: reqBody, headers: customHeaders } = body
  if (!url) return NextResponse.json({ error: 'URL or reference_id required' }, { status: 400 })

  let authHeaders: Record<string, string> = {}
  if (integration_id) {
    const integration = await getOwnedIntegration(supabase, tenantId, integration_id, 'config')
    if (integration) {
      // Secrets are encrypted at rest — the old hand-rolled block here sent
      // "Bearer enc:v1:…" (the literal ciphertext). Decrypt and reuse the
      // shared attacher so this path can never drift from real execution.
      const config = decryptSensitiveFields((integration as any).config) as any
      await applyAuthHeaders(config, authHeaders, { supabase, integrationId: integration_id })
      if (config?.headers) Object.assign(authHeaders, config.headers)
    }
  }

  try {
    // Clean non-HTTP headers
    const cleanHeaders = { ...authHeaders }
    for (const k of ['_executor', 'db_type', 'host', 'port', 'database', 'ssl', 'encrypt', 'trustServerCertificate']) delete cleanHeaders[k]

    const resp = await fetch(url, {
      method: method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(customHeaders ?? {}), ...cleanHeaders },
      body: method !== 'GET' && reqBody ? reqBody : undefined,
      signal: AbortSignal.timeout(30000),
    })

    const contentType = resp.headers.get('content-type') ?? ''
    let data: any
    if (contentType.includes('json')) { data = await resp.json() }
    else {
      const text = await resp.text()
      try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 2000) } }
    }
    return NextResponse.json({ status: resp.status, data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Request failed' })
  }
}
