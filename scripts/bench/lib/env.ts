/**
 * Benchmark environment: local Supabase URLs/keys, the bench state file and
 * the localhost guard every suite goes through. The harness only ever talks
 * to a LOCAL stack — it seeds and deletes data freely.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const ROOT = resolve(__dirname, '..', '..', '..')
export const BENCH_DIR = resolve(__dirname, '..')
export const RESULTS_DIR = join(BENCH_DIR, 'results')
const STATE_FILE = join(BENCH_DIR, '.state.json')

export interface BenchEnv {
  supabaseUrl: string
  anonKey: string
  serviceKey: string
  dbUrl: string
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Throws unless `url` points at this machine. */
export function assertLocal(url: string, what: string): void {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`${what} is not a valid URL`)
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`${what} host "${host}" is not localhost/127.0.0.1 — the bench harness only runs against a local Supabase stack`)
  }
}

/** `npx supabase status -o env` from the repo root (the local stack's URLs and keys). */
function supabaseStatusEnv(): Record<string, string> {
  try {
    const out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const vars: Record<string, string> = {}
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
      if (m) vars[m[1]] = m[2]
    }
    return vars
  } catch {
    return {}
  }
}

let cached: BenchEnv | null = null

/**
 * BENCH_SUPABASE_URL / BENCH_ANON_KEY / BENCH_SERVICE_ROLE_KEY / BENCH_DB_URL,
 * falling back to `npx supabase status` of the local stack. Never reads .env
 * files, so a live project configured there can't be picked up by accident.
 */
export function benchEnv(): BenchEnv {
  if (cached) return cached
  let status: Record<string, string> | null = null
  const pick = (name: string, statusKey: string): string => {
    const direct = process.env[name]
    if (direct) return direct
    status ??= supabaseStatusEnv()
    const value = status[statusKey]
    if (!value) throw new Error(`Set ${name} or start the local stack (npx supabase start)`)
    return value
  }
  const env: BenchEnv = {
    supabaseUrl: pick('BENCH_SUPABASE_URL', 'API_URL'),
    anonKey: pick('BENCH_ANON_KEY', 'ANON_KEY'),
    serviceKey: pick('BENCH_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY'),
    dbUrl: pick('BENCH_DB_URL', 'DB_URL'),
  }
  assertLocal(env.supabaseUrl, 'Supabase URL')
  assertLocal(env.dbUrl, 'Database URL')
  cached = env
  return env
}

/** Point the in-process app code (engine, services) at the local stack. */
export function applyAppEnv(env: BenchEnv, appUrl: string): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.supabaseUrl
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.serviceKey
  // Queue kicks go here; the engine suite intercepts this origin so nothing
  // ever reaches a dev server on :3000 (kickQueueProcessor's default).
  process.env.NEXT_PUBLIC_APP_URL = appUrl
}

/** Ids the seed created; read by every suite. */
export interface BenchState {
  tenantId: string
  noiseTenantId: string
  ownerId: string
  memberId: string
  userIds: string[]
  apiKey: string
  workflowIds: Record<string, string>
  versionIds: Record<string, string>
  ordersTableId: string
  eventsTableId: string
  decisionTableId: string
  integrationId: string
  referenceId: string
  echoPort: number
  sampleRunId: string
  busyWorkflowId: string
  seededAt: string
  counts: Record<string, number>
}

export function readState(): BenchState {
  if (!existsSync(STATE_FILE)) throw new Error('No bench state — run the seed first: npx tsx scripts/bench/seed.ts')
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as BenchState
}

export function writeState(state: BenchState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n')
}

export function hasState(): boolean {
  return existsSync(STATE_FILE)
}

/** Minimal `--flag value` / `--flag` parser. */
export function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const [key, inline] = token.slice(2).split('=', 2)
    if (inline !== undefined) args[key] = inline
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[key] = argv[++i]
    else args[key] = true
  }
  return args
}
