import { getServiceDb, hasServiceDb } from '@/lib/providers/db'

/**
 * Liveness and readiness for container orchestrators (Compose healthcheck,
 * Kubernetes probes, load balancers):
 *  - GET /api/health  — liveness: the process answers. No dependencies, so a
 *    database outage never makes Kubernetes restart every pod.
 *  - GET /api/ready   — readiness: the database answers a one-row read
 *    within READY_TIMEOUT_MS. 503 otherwise, so traffic moves away from a
 *    replica that can't serve requests.
 * Unauthenticated: the bodies carry status words only, never error text.
 */

export const READY_TIMEOUT_MS = 3_000

export type CheckState = 'ok' | 'unavailable' | 'not_configured'

export interface Readiness {
  ready: boolean
  checks: { database: CheckState }
}

type Probe = () => Promise<{ error: unknown }>

function defaultProbe(): Probe | null {
  if (!hasServiceDb()) return null
  return async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- head-only probe on an untyped table
    const { error } = await (getServiceDb() as any).from('instance_settings').select('key', { head: true }).limit(1)
    return { error }
  }
}

export async function checkReadiness(probe: Probe | null = defaultProbe(), timeoutMs = READY_TIMEOUT_MS): Promise<Readiness> {
  if (!probe) return { ready: false, checks: { database: 'not_configured' } }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<{ error: unknown }>((resolve) => { timer = setTimeout(() => resolve({ error: 'timeout' }), timeoutMs) })
    const { error } = await Promise.race([probe(), timeout])
    if (error) {
      console.warn(`[ready] database check failed: ${typeof error === 'string' ? error : (error as { message?: string }).message ?? 'error'}`)
      return { ready: false, checks: { database: 'unavailable' } }
    }
    return { ready: true, checks: { database: 'ok' } }
  } catch (e) {
    console.warn(`[ready] database check failed: ${(e as Error).message}`)
    return { ready: false, checks: { database: 'unavailable' } }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
