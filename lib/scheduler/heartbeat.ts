import { statSync, writeFileSync } from 'node:fs'

/**
 * Worker liveness for container healthchecks: the worker process rewrites
 * this file at start and after every minute of its loop (ticked, follower,
 * busy or error — the loop is alive), and docker-compose.yml's worker
 * healthcheck fails when it is older than HEARTBEAT_MAX_AGE_MS. A hung
 * loop then shows as unhealthy instead of "Up".
 */
export const DEFAULT_HEARTBEAT_FILE = '/tmp/usertasks-worker-heartbeat'
export const HEARTBEAT_MAX_AGE_MS = 180_000

export function heartbeatFile(): string {
  return process.env.WORKER_HEARTBEAT_FILE?.trim() || DEFAULT_HEARTBEAT_FILE
}

export function writeHeartbeat(file = heartbeatFile(), now = new Date()): void {
  try {
    writeFileSync(file, `${now.toISOString()}\n`)
  } catch (error) {
    console.warn(`[scheduler] heartbeat ${file}: ${(error as Error).message}`)
  }
}

export function heartbeatFresh(file = heartbeatFile(), maxAgeMs = HEARTBEAT_MAX_AGE_MS, now = Date.now()): boolean {
  try {
    return now - statSync(file).mtimeMs < maxAgeMs
  } catch {
    return false
  }
}
