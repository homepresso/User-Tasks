import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { processorSecret } from "@/lib/config/bootstrap"
import { requireServiceDb } from "@/lib/providers/db"

/**
 * Shared authorization for internal service endpoints (cron jobs, queue/deletion
 * processors, workflow event resumption). These run with the service-role key and
 * bypass RLS, so they must never be reachable unauthenticated.
 *
 * A caller is authorized when it presents the configured processor secret via
 * either the `X-Processor-Secret` header or `Authorization: Bearer <secret>`.
 *
 * Fails CLOSED: if no secret is configured in the environment, every call is
 * rejected. This is deliberate — a missing secret is a misconfiguration, not a
 * licence to run destructive cross-tenant jobs unauthenticated.
 */
export function getProcessorSecret(): string | undefined {
  return processorSecret()
}

export function isAuthorizedServiceCall(request: Request): boolean {
  const expected = getProcessorSecret()
  if (!expected) return false // fail closed — no secret configured

  const headerSecret = request.headers.get("x-processor-secret")
  if (headerSecret && headerSecret === expected) return true

  const authHeader = request.headers.get("authorization")
  if (authHeader && authHeader === `Bearer ${expected}`) return true

  return false
}

/**
 * Returns a 401 NextResponse when the request is not an authorized service call,
 * or `null` when it is authorized (callers should proceed only when this is null).
 */
export function requireServiceAuth(request: Request): NextResponse | null {
  if (isAuthorizedServiceCall(request)) return null

  const reason = getProcessorSecret()
    ? "Unauthorized"
    : "Service endpoint is not configured (missing WORKFLOW_PROCESSOR_SECRET / CRON_SECRET)"
  return NextResponse.json({ error: reason }, { status: getProcessorSecret() ? 401 : 503 })
}

/**
 * Service-role Supabase client for internal jobs. Requires the service-role key —
 * NO anon-key fallback, so a missing key throws loudly instead of silently running
 * (and failing) against the RLS-restricted anon role.
 *
 * Kept as the entry point its ~30 callers (and their test mocks) use; the
 * client itself comes from the DB seam (lib/providers/db).
 */
export function createServiceClient(): SupabaseClient {
  return requireServiceDb(
    "createServiceClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
  )
}
