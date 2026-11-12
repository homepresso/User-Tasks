import { randomUUID } from 'node:crypto'
import {
  codesMatch, envSetupCode, generateSetupCode, hashSetupCode, setupCodeLogLine, verifySetupCode,
  SETUP_CODE_ENV, MIN_ENV_CODE_LENGTH,
} from './code'

/**
 * First-run setup state (self-hosted). "Setup needed" = no tenants and no
 * users at all. Everything lives in `instance_settings` (service role only,
 * migration 20261104000000; `instance.*` keys are allowed by its CHECK), so
 * no new table is needed:
 *
 *  - `instance.setup_code`  { hash, created_at }: the salted scrypt hash of
 *    the current code (lib/setup/code.ts). One row = every replica agrees.
 *    Deleted when setup completes.
 *  - `instance.setup_claim` { claim_id, claimed_at, completed_at? }: the
 *    atomic guard. The primary key means exactly one submission can insert
 *    it; the winner re-checks "still empty" and provisions, everyone else is
 *    refused. A claim older than CLAIM_STALE_MS (a crashed request) can be
 *    taken over with a conditional update.
 *
 * Works through the REST-shaped service client, so it runs the same on the
 * Supabase and postgres database providers, in the app and in
 * usertasks-admin. Missing table (migrations not applied): the check still
 * works (tenants/users only); generating a code fails and is reported.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SetupDb = { from: (table: string) => any }

export const CODE_KEY = 'instance.setup_code'
export const CLAIM_KEY = 'instance.setup_claim'
const TABLE = 'instance_settings'
/** While setup is needed, re-check this often (a CLI bootstrap may finish it). */
export const SETUP_CHECK_TTL_MS = 5_000
/** A claim this old belongs to a request that died. */
export const CLAIM_STALE_MS = 2 * 60_000
/** At startup, a code younger than this was just made by a sibling replica: keep it. */
export const FRESH_CODE_MS = 60_000

interface SetupGlobals {
  /** true once the install has a tenant or a user: never needed again in this process. */
  done: boolean
  needed: boolean | null
  checkedAt: number
  /** Plain code this process generated (only ever printed to the log). */
  knownCode: string | null
  lastAnnouncedAt: number
}

const g = globalThis as typeof globalThis & { __usertasksSetup?: SetupGlobals }
function state(): SetupGlobals {
  return (g.__usertasksSetup ??= { done: false, needed: null, checkedAt: 0, knownCode: null, lastAnnouncedAt: 0 })
}

/** Tests: forget the cached answer and the remembered code. */
export function resetSetupStateForTests(): void {
  g.__usertasksSetup = undefined
}

/** No tenants and no users (two indexed LIMIT 1 reads). Throws when the database can't answer. */
export async function isInstanceEmpty(db: SetupDb): Promise<boolean> {
  const [tenants, users] = await Promise.all([
    db.from('tenants').select('id').limit(1),
    db.from('users').select('id').limit(1),
  ])
  if (tenants.error) throw new Error(`tenants: ${tenants.error.message}`)
  if (users.error) throw new Error(`users: ${users.error.message}`)
  return !(tenants.data ?? []).length && !(users.data ?? []).length
}

/**
 * Whether first-run setup is needed (self-hosted only; the caller passes the
 * mode). Cached: SETUP_CHECK_TTL_MS while needed, forever once not. A
 * database error answers false and isn't cached (the app's own pages then
 * report the outage; /setup is never shown on a guess).
 */
export async function isSetupNeeded(db: () => SetupDb, opts: { selfHosted: boolean; fresh?: boolean; now?: number }): Promise<boolean> {
  if (!opts.selfHosted) return false
  const s = state()
  if (s.done) return false
  const now = opts.now ?? Date.now()
  if (!opts.fresh && s.needed !== null && now - s.checkedAt < SETUP_CHECK_TTL_MS) return s.needed
  try {
    const needed = await isInstanceEmpty(db())
    s.needed = needed
    s.checkedAt = now
    if (!needed) markSetupDone()
    return needed
  } catch (error) {
    console.warn(`[setup] could not check for first-run setup: ${(error as Error).message}`)
    return false
  }
}

export function markSetupDone(): void {
  const s = state()
  s.done = true
  s.needed = false
  s.knownCode = null
}

interface CodeRow { hash: string; createdAt: string; updatedAt: number }

export async function readCodeRow(db: SetupDb): Promise<CodeRow | null> {
  const { data, error } = await db.from(TABLE).select('value, updated_at').eq('key', CODE_KEY).maybeSingle()
  if (error) throw new Error(`${TABLE}: ${error.message}`)
  if (!data?.value || typeof data.value.hash !== 'string') return null
  return { hash: data.value.hash, createdAt: String(data.value.created_at ?? data.updated_at), updatedAt: Date.parse(data.updated_at) || 0 }
}

/** A new code, replacing any previous one (usertasks-admin setup-code, restarts). Returns the plain code. */
export async function rotateSetupCode(db: SetupDb, actor: string | null = null): Promise<string> {
  const code = generateSetupCode()
  const now = new Date().toISOString()
  const { error } = await db.from(TABLE).upsert(
    { key: CODE_KEY, value: { hash: hashSetupCode(code), created_at: now, by: actor }, secret: false, updated_at: now, updated_by: null },
    { onConflict: 'key' },
  )
  if (error) throw new Error(`${TABLE}: ${error.message}`)
  state().knownCode = code
  return code
}

/** A code only if none exists (first need; never invalidates someone else's). Null when one already exists. */
export async function createSetupCodeIfMissing(db: SetupDb): Promise<string | null> {
  const code = generateSetupCode()
  const now = new Date().toISOString()
  const { error } = await db.from(TABLE).insert({ key: CODE_KEY, value: { hash: hashSetupCode(code), created_at: now }, secret: false, updated_at: now })
  if (error) {
    // Lost the race (unique key) — or a real failure, which the re-read surfaces.
    if (await readCodeRow(db)) return null
    throw new Error(`${TABLE}: ${error.message}`)
  }
  state().knownCode = code
  return code
}

export type CodeAnnouncement =
  | { kind: 'env' }
  | { kind: 'code'; code: string }
  | { kind: 'elsewhere'; createdAt: string }

/**
 * Makes sure a code exists and says what can be printed:
 *  - USERTASKS_SETUP_CODE set → the operator already knows it;
 *  - `startup`: no code, or one older than FRESH_CODE_MS that this process
 *    can't print (a restart) → a new one; a fresh one from a sibling replica
 *    is kept (its log has it);
 *  - page visits never rotate (a visitor must not be able to invalidate the
 *    printed code); they create one only when none exists.
 */
export async function ensureSetupCode(db: SetupDb, opts: { startup: boolean; env?: Record<string, string | undefined>; now?: number }): Promise<CodeAnnouncement> {
  const env = envSetupCode(opts.env)
  if (env && 'code' in env) return { kind: 'env' }
  const s = state()
  const row = await readCodeRow(db)
  if (!row) {
    const created = await createSetupCodeIfMissing(db)
    if (created) return { kind: 'code', code: created }
    const again = await readCodeRow(db)
    return { kind: 'elsewhere', createdAt: again?.createdAt ?? new Date().toISOString() }
  }
  if (s.knownCode && verifySetupCode(s.knownCode, row.hash)) return { kind: 'code', code: s.knownCode }
  const age = (opts.now ?? Date.now()) - row.updatedAt
  if (opts.startup && age >= FRESH_CODE_MS) return { kind: 'code', code: await rotateSetupCode(db) }
  return { kind: 'elsewhere', createdAt: row.createdAt }
}

/** The lines to log for an announcement. */
export function announcementLines(a: CodeAnnouncement, env: Record<string, string | undefined> = process.env): string[] {
  const lines: string[] = []
  const envCode = envSetupCode(env)
  if (envCode && 'invalid' in envCode) lines.push(`[setup] ${SETUP_CODE_ENV} is shorter than ${MIN_ENV_CODE_LENGTH} characters and was ignored; using a generated code.`)
  if (a.kind === 'env') lines.push(`UserTasks setup code: set by ${SETUP_CODE_ENV} (open /setup to create the admin account)`)
  else if (a.kind === 'code') lines.push(setupCodeLogLine(a.code))
  else lines.push(`UserTasks setup code: made by another server process at ${a.createdAt}; see that process's log, or run \`usertasks-admin setup-code\` for a new one (open /setup to create the admin account)`)
  return lines
}

/**
 * Log the code (startup, and /setup visits while setup is needed — at most
 * every 30 s for visits, so the page can't flood the log).
 */
export async function announceSetupCode(db: SetupDb, opts: { startup: boolean; log?: (line: string) => void; env?: Record<string, string | undefined> }): Promise<void> {
  const s = state()
  const now = Date.now()
  if (!opts.startup && now - s.lastAnnouncedAt < 30_000) return
  s.lastAnnouncedAt = now
  const log = opts.log ?? ((line: string) => console.log(line))
  try {
    for (const line of announcementLines(await ensureSetupCode(db, { startup: opts.startup, env: opts.env }), opts.env)) log(line)
  } catch (error) {
    log(`[setup] could not create a setup code: ${(error as Error).message}. Apply the database migrations (usertasks-admin db migrate), or set ${SETUP_CODE_ENV}.`)
  }
}

/** Is `given` the current setup code? (the env override, else the stored hash; constant time either way). */
export async function checkSetupCode(db: SetupDb, given: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const fromEnv = envSetupCode(env)
  if (fromEnv && 'code' in fromEnv) return codesMatch(given, fromEnv.code)
  const row = await readCodeRow(db).catch(() => null)
  return verifySetupCode(given, row?.hash)
}

/** Take the one-time setup claim. Returns its id, or null when another submission holds it. */
export async function claimSetup(db: SetupDb, now: number = Date.now()): Promise<string | null> {
  const claimId = randomUUID()
  const at = new Date(now).toISOString()
  const value = { claim_id: claimId, claimed_at: at }
  const { error } = await db.from(TABLE).insert({ key: CLAIM_KEY, value, secret: false, updated_at: at })
  if (!error) return claimId
  // Held — take it over only if its holder died (conditional on the old timestamp).
  const stale = new Date(now - CLAIM_STALE_MS).toISOString()
  const { data } = await db.from(TABLE).update({ value, updated_at: at })
    .eq('key', CLAIM_KEY).lt('updated_at', stale).select('key')
  return (data ?? []).length ? claimId : null
}

/** Give the claim back (provisioning failed): the next submission can try. */
export async function releaseSetup(db: SetupDb): Promise<void> {
  await db.from(TABLE).delete().eq('key', CLAIM_KEY).then(() => undefined, () => undefined)
}

/** Setup done: the code stops working, the claim records who and when. */
export async function completeSetup(db: SetupDb, info: { claimId: string; tenantId: string; userId: string }): Promise<void> {
  const at = new Date().toISOString()
  await db.from(TABLE).delete().eq('key', CODE_KEY).then(() => undefined, () => undefined)
  await db.from(TABLE).update({
    value: { claim_id: info.claimId, completed_at: at, tenant_id: info.tenantId, user_id: info.userId },
    updated_at: at,
  }).eq('key', CLAIM_KEY).then(() => undefined, () => undefined)
  markSetupDone()
}
