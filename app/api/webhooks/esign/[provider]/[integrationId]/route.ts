import { NextRequest, NextResponse } from 'next/server'
import { esignProvider, providerFromWebhookSlug } from '@/lib/esign/catalog'

/**
 * E-signature webhooks: /api/webhooks/esign/{provider}/{integrationId}
 *
 * DocuSign Connect, Adobe Acrobat Sign webhooks, Dropbox Sign callbacks,
 * PandaDoc webhooks, SignNow event subscriptions and BoldSign webhooks.
 *
 *  - The tenant and integration come from the URL (the integration must
 *    exist, be active and be of that provider) — never from the payload.
 *  - Every delivery is verified with that integration's secret (HMAC,
 *    event hash or client-id handshake + URL token) before anything is read
 *    from it; unverifiable deliveries get 401 and are not processed.
 *  - Replays (a delivery key already processed) are acknowledged and ignored;
 *    stale deliveries are refused.
 *  - Only the envelope id is taken from the payload: its state is read back
 *    from the provider before a waiting workflow resumes or a trigger fires.
 */

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 5 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { params: Promise<{ provider: string; integrationId: string }> }

function reply(result: { status: number; body?: string; json?: unknown; headers?: Record<string, string> } | undefined, fallback: unknown) {
  if (result?.body !== undefined) return new NextResponse(result.body, { status: result.status, headers: result.headers })
  return NextResponse.json(result?.json ?? fallback, { status: result?.status ?? 200, headers: result?.headers })
}

async function handle(request: NextRequest, context: Params) {
  const { provider: slug, integrationId } = await context.params
  const provider = providerFromWebhookSlug(slug)
  if (!provider || !UUID_RE.test(integrationId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  const rawBody = Buffer.from(await request.arrayBuffer())
  if (rawBody.byteLength > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })

  const { serviceDb, contextFromIntegration } = await import('@/lib/esign/service')
  const db = await serviceDb()
  const info = esignProvider(provider)!
  const { data: row } = await (db as any).from('integrations').select('id, name, type, config, tenant_id, is_active')
    .eq('id', integrationId).eq('type', info.connectorKey).maybeSingle()
  if (!row || row.is_active === false) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let loaded
  try {
    loaded = await contextFromIntegration(row, { supabase: db })
  } catch {
    return NextResponse.json({ error: 'The integration is not configured for webhooks' }, { status: 409 })
  }
  const auth = (loaded.ctx.integrationConfig.auth_config ?? {}) as Record<string, any>
  const secrets = {
    webhook_secret: auth.webhook_secret ? String(auth.webhook_secret) : undefined,
    api_key: auth.username ? String(auth.username) : auth.api_key ? String(auth.api_key) : undefined,
    client_id: auth.client_id ? String(auth.client_id) : loaded.ctx.settings.client_id || undefined,
  }

  const { WebhookAuthError } = await import('@/lib/esign/adapter')
  let verified
  try {
    verified = loaded.adapter.verifyWebhook({
      req: { method: request.method, headers: request.headers, rawBody, url: new URL(request.url) },
      secrets,
      now: Date.now(),
    })
  } catch (error) {
    if (error instanceof WebhookAuthError) {
      console.warn(`[esign-webhook] ${provider} delivery refused for integration ${integrationId}: ${error.message}`)
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Invalid webhook delivery' }, { status: 400 })
  }

  if (!verified.events.length) return reply(verified.response, { ok: true, received: 0 })
  try {
    const { processEsignEvents } = await import('@/lib/esign/waits')
    const result = await processEsignEvents({ ...loaded, integration: { id: row.id, name: row.name, type: row.type, tenant_id: row.tenant_id } }, verified.events, { db })
    return reply(verified.response, { ok: true, received: verified.events.length, ...result, duplicate: result.duplicates > 0 && result.processed === 0 })
  } catch (error) {
    console.error(`[esign-webhook] ${provider} processing failed: ${(error as Error)?.message}`)
    return NextResponse.json({ error: 'Processing failed — retry' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: Params) {
  return handle(request, context)
}

/** Adobe Acrobat Sign verifies the webhook URL with a GET (client-id echo). */
export async function GET(request: NextRequest, context: Params) {
  return handle(request, context)
}
