/**
 * Full instance migration, end to end: a Supabase-backed install with the
 * Northwind demo workspace is moved off Supabase one area at a time with
 * `usertasks-admin switch`, in the documented order (auth, realtime,
 * scheduler, storage, email, secrets, then the database), and the app is
 * restarted on the new stack with NO Supabase settings at all. Then:
 *
 *   - the full surface E2E (scripts/e2e-surfaces.ts: REST, MCP, CLI),
 *   - the HTTP smoke test (deploy/compose/smoke/smoke.mjs: the migrated demo
 *     owner signs in with their old password, upload + /files, SSE, email),
 *   - files copied from Supabase Storage load through /files (and a stored
 *     logo URL became a storage:// reference),
 *   - scheduled jobs run through the built-in worker (app_cron.tick_runs),
 *   - log export ships new events to the demo's Splunk HEC destination,
 *   - usertasks-admin doctor passes on the new stack,
 *   - the RLS semantics snapshot is identical before and after.
 *
 * DESTRUCTIVE for the source stack (it is switched over and seeded): point it
 * at a disposable Supabase stack only — CI's, or a second local one started
 * from a copy of supabase/ with another project_id and ports. Everything must
 * be on localhost.
 *
 *   E2E_CONFIRM_DISPOSABLE=1 \
 *   E2E_SUPABASE_URL=http://127.0.0.1:55321 E2E_SUPABASE_ANON_KEY=… E2E_SUPABASE_SERVICE_ROLE_KEY=… \
 *   E2E_SUPABASE_JWT_SECRET=… E2E_SOURCE_DB_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *   E2E_TARGET_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55440/postgres \
 *   E2E_S3_ENDPOINT=http://127.0.0.1:9010 E2E_APP_DIR=<built app> npx tsx scripts/e2e-instance-migration.ts
 *
 * Optional: E2E_S3_ACCESS_KEY / E2E_S3_SECRET_KEY (minioadmin), E2E_SMTP_HOST /
 * E2E_SMTP_PORT (127.0.0.1:1025) and E2E_MAILPIT_URL (http://127.0.0.1:8025),
 * E2E_APP_PORT (3420), E2E_MOCK_PORT (4012), E2E_SKIP_SURFACES=1,
 * E2E_ALLOW_DEFAULT_PORTS=1 (a source on the default 54321/54322 ports; CI),
 * E2E_ENCRYPTION_KEY (default: random per run; set it to re-run against the same source),
 * E2E_REPORT=<file.json>. E2E_APP_DIR must hold a production build
 * (`npm run build`) of this checkout; default: the repository itself.
 * Exit code 0 when every check passes; prints a per-area table.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed API payloads */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'

const ROOT = path.resolve(__dirname, '..')
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx')
const env = process.env
const need = (name: string) => env[name]?.trim() || fail(`${name} is required (see the header of scripts/e2e-instance-migration.ts)`)

function fail(message: string): never {
  console.error(`e2e-instance-migration: ${message}`)
  process.exit(2)
}

if (env.E2E_CONFIRM_DISPOSABLE !== '1') fail('set E2E_CONFIRM_DISPOSABLE=1: this switches and seeds the source stack (use a disposable one)')
const SUPABASE_URL = need('E2E_SUPABASE_URL').replace(/\/+$/, '')
const ANON_KEY = need('E2E_SUPABASE_ANON_KEY')
const SERVICE_KEY = need('E2E_SUPABASE_SERVICE_ROLE_KEY')
const JWT_SECRET = need('E2E_SUPABASE_JWT_SECRET')
const SOURCE_DB = need('E2E_SOURCE_DB_URL')
const TARGET_ADMIN = need('E2E_TARGET_ADMIN_URL')
const S3_ENDPOINT = need('E2E_S3_ENDPOINT')
const S3_KEY = env.E2E_S3_ACCESS_KEY || 'minioadmin'
const S3_SECRET = env.E2E_S3_SECRET_KEY || 'minioadmin'
const SMTP_HOST = env.E2E_SMTP_HOST || '127.0.0.1'
const SMTP_PORT = env.E2E_SMTP_PORT || '1025'
const MAILPIT = (env.E2E_MAILPIT_URL || 'http://127.0.0.1:8025').replace(/\/+$/, '')
const APP_DIR = path.resolve(env.E2E_APP_DIR || ROOT)
const PORT = Number(env.E2E_APP_PORT || 3420)
const MOCK_PORT = Number(env.E2E_MOCK_PORT || 4012)
const APP_URL = `http://localhost:${PORT}`
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`

for (const [name, value] of Object.entries({ E2E_SUPABASE_URL: SUPABASE_URL, E2E_SOURCE_DB_URL: SOURCE_DB, E2E_TARGET_ADMIN_URL: TARGET_ADMIN, E2E_S3_ENDPOINT: S3_ENDPOINT })) {
  const host = new URL(value).hostname
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) fail(`${name} must be a localhost URL (got ${host})`)
}
if (env.E2E_ALLOW_DEFAULT_PORTS !== '1' && (new URL(SOURCE_DB).port === '54322' || new URL(SUPABASE_URL).port === '54321')) {
  fail('the source is on the default local stack ports (54321/54322) — usually your shared dev stack. Use a disposable stack, or set E2E_ALLOW_DEFAULT_PORTS=1 (CI).')
}
if (!existsSync(path.join(APP_DIR, '.next', 'BUILD_ID'))) fail(`${APP_DIR} has no production build: run npm run build there`)

const RUN = Date.now().toString(36)
const WORK = path.join(tmpdir(), `ut-e2e-migration-${RUN}`)
mkdirSync(WORK, { recursive: true })
const TARGET_DB_NAME = `ut_e2e_${RUN}`
const TARGET_DB = (() => { const u = new URL(TARGET_ADMIN); u.pathname = `/${TARGET_DB_NAME}`; return u.toString() })()
// Stored secrets (log destination tokens, --secret options) are encrypted with it: re-running
// against the same source needs the same key (E2E_ENCRYPTION_KEY).
const ENCRYPTION_KEY = env.E2E_ENCRYPTION_KEY?.trim() || randomBytes(32).toString('hex')
const CRON_SECRET = randomBytes(24).toString('hex')
const DEMO = { slug: 'northwind-trading', email: 'ada@northwind.example', password: 'demo-password-2026' }

// ─── Environments ───

const common = {
  PATH: env.PATH ?? '',
  HOME: env.HOME ?? '',
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  DEPLOYMENT_MODE: 'self_hosted',
  APP_URL,
  NEXT_PUBLIC_APP_URL: APP_URL,
  CRON_SECRET,
  ENCRYPTION_KEY,
  ALLOW_PRIVATE_EGRESS: 'true',
  BACKUP_DIR: path.join(WORK, 'backups'),
}
/** The Supabase-backed install (before): providers come from instance_settings as they are switched. */
const supabaseEnv: Record<string, string> = {
  ...common,
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  SUPABASE_JWT_SECRET: JWT_SECRET,
  // Direct connection: the built-in auth store, LISTEN for SSE, the worker's lock, the admin CLI.
  DATABASE_URL: SOURCE_DB,
}
/** The migrated install (after): nothing about Supabase. */
const standaloneEnv: Record<string, string> = { ...common, DB_PROVIDER: 'postgres', DATABASE_URL: TARGET_DB }

// ─── Results ───

type Result = { area: string; check: string; ok: boolean; ms: number; detail: string }
const results: Result[] = []
async function check(area: string, name: string, fn: () => Promise<string | void>): Promise<boolean> {
  const started = Date.now()
  try {
    const detail = (await fn()) ?? ''
    results.push({ area, check: name, ok: true, ms: Date.now() - started, detail })
    console.log(`  ok    ${area.padEnd(9)} ${name}${detail ? ` — ${detail}` : ''}`)
    return true
  } catch (error) {
    const detail = String((error as Error)?.message ?? error).slice(0, 600)
    results.push({ area, check: name, ok: false, ms: Date.now() - started, detail })
    console.log(`  FAIL  ${area.padEnd(9)} ${name} — ${detail}`)
    return false
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const section = (title: string) => console.log(`\n── ${title} ──`)

function run(cmd: string, args: string[], runEnv: Record<string, string>, opts: { cwd?: string; timeoutMs?: number; quiet?: boolean } = {}): { code: number; out: string; stdout: string } {
  const res = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, env: runEnv as NodeJS.ProcessEnv, encoding: 'utf8', timeout: opts.timeoutMs ?? 600_000, maxBuffer: 64 * 1024 * 1024 })
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  writeFileSync(path.join(WORK, `${Date.now()}-${path.basename(args[1] ?? args[0] ?? cmd)}.log`), `$ ${cmd} ${args.join(' ')}\n${out}`)
  if (!opts.quiet && res.status !== 0) console.log(out.split('\n').slice(-25).join('\n'))
  return { code: res.status ?? 1, out, stdout: res.stdout ?? '' }
}

function admin(args: string[], runEnv: Record<string, string>) {
  return run(TSX, [path.join(ROOT, 'packages/admin/src/bin.ts'), ...args], runEnv)
}

// ─── Processes ───

const children: ChildProcess[] = []
function startProcess(name: string, cmd: string, args: string[], runEnv: Record<string, string>, cwd = ROOT): ChildProcess {
  const child = spawn(cmd, args, { cwd, env: runEnv as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = path.join(WORK, `${name}.log`)
  child.stdout!.on('data', (d) => writeFileSync(log, d, { flag: 'a' }))
  child.stderr!.on('data', (d) => writeFileSync(log, d, { flag: 'a' }))
  children.push(child)
  return child
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(200)
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function startApp(name: string, runEnv: Record<string, string>): Promise<ChildProcess> {
  const nextBin = path.join(APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next')
  const child = startProcess(name, process.execPath, [nextBin, 'start', '-p', String(PORT), '-H', '127.0.0.1'], runEnv, APP_DIR)
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`${name} exited with ${child.exitCode}; see ${path.join(WORK, `${name}.log`)}`)
    const res = await fetch(`${APP_URL}/api/config/public`).catch(() => null)
    if (res?.ok) return child
    await sleep(500)
  }
  throw new Error(`${name} did not answer within 60 s`)
}

// ─── HTTP helpers ───

async function api(key: string, method: string, p: string, body?: unknown): Promise<any> {
  const init = {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
  // One retry on a network error: a keep-alive socket the server closed while
  // a switch ran fails before the request is sent (as in e2e-surfaces.ts).
  const res = await fetch(`${APP_URL}/api/v1${p}`, init).catch(() => fetch(`${APP_URL}/api/v1${p}`, init))
  const json: any = await res.json().catch(() => null)
  if (!res.ok || json?.success === false) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(json?.error ?? json).slice(0, 200)}`)
  return json && 'data' in json ? json.data : json
}

function signInActionId(): string {
  const manifest = JSON.parse(readFileSync(path.join(APP_DIR, '.next', 'server', 'server-reference-manifest.json'), 'utf8'))
  const entry = Object.entries(manifest.node as Record<string, { exportedName?: string; filename?: string }>)
    .find(([, v]) => v.exportedName === 'signInAction' && v.filename === 'app/actions/auth.ts')
  if (!entry) throw new Error('signInAction not in the server reference manifest')
  return entry[0]
}

function smoke(area: string, key: string, extra: Record<string, string>): Promise<boolean> {
  return check(area, 'HTTP smoke (deploy/compose/smoke/smoke.mjs)', async () => {
    const res = run(process.execPath, [path.join(ROOT, 'deploy/compose/smoke/smoke.mjs')], {
      ...common, SMOKE_URL: APP_URL, SMOKE_API_KEY: key, SMOKE_EMAIL: DEMO.email, SMOKE_PASSWORD: DEMO.password, SMOKE_ORG: DEMO.slug,
      SMOKE_SIGNIN_ACTION: signInActionId(), ...extra,
    }, { quiet: true })
    const lines = res.out.trim().split('\n')
    if (res.code !== 0) throw new Error(lines.filter((l) => l.startsWith('FAIL')).join(' | ') || lines.slice(-3).join(' | '))
    return lines.at(-1)
  })
}

function rlsSnapshot(area: string, dbUrl: string): Promise<boolean> {
  return check(area, 'RLS semantics snapshot (__tests__/rls-semantics-db.test.ts)', async () => {
    const res = run(path.join(ROOT, 'node_modules', '.bin', 'vitest'), ['run', '__tests__/rls-semantics-db.test.ts'], { ...common, NODE_ENV: 'test', NO_COLOR: '1', EVENT_STREAM_DB_URL: dbUrl }, { quiet: true })
    const summary = res.out.match(/Tests\s+[^\n]+/)?.[0]?.trim() ?? ''
    if (res.code !== 0 || !/passed/.test(summary) || /skipped/.test(summary)) throw new Error(`${summary || 'failed'}; log in ${WORK}`)
    return `identical to __snapshots__/rls-semantics.json (${summary})`
  })
}

async function mockStats(): Promise<Record<string, number>> {
  return (await fetch(`${MOCK_URL}/_stats`)).json() as Promise<Record<string, number>>
}

// ─── Main ───

async function main() {
  console.log(`Instance migration E2E ${RUN}\n  source  ${SUPABASE_URL} (${new URL(SOURCE_DB).host})\n  target  ${new URL(TARGET_DB).host}/${TARGET_DB_NAME}\n  app     ${APP_DIR} on ${APP_URL}\n  logs    ${WORK}`)
  const source = new pg.Client({ connectionString: SOURCE_DB })
  await source.connect()
  startProcess('mock-services', process.execPath, [path.join(ROOT, 'scripts/screenshots/mock-services.mjs')], { ...common, MOCK_PORT: String(MOCK_PORT), MOCK_HANG_MS: '31000' })

  // 1. The Supabase-backed install with the Northwind demo.
  section('1. Supabase install + Northwind demo')
  await source.query(`DELETE FROM public.instance_settings`)
  let app = await startApp('app-supabase', supabaseEnv)
  const demoOut = path.join(WORK, 'demo')
  const seeded = await check('setup', 'seed Northwind (scripts/screenshots/seed-demo.ts)', async () => {
    const res = run(TSX, [path.join(ROOT, 'scripts/screenshots/seed-demo.ts')], {
      ...supabaseEnv, NODE_ENV: 'development', DEMO_APP_URL: APP_URL, DEMO_OUT_DIR: demoOut, MOCK_URL,
    }, { timeoutMs: 900_000 })
    if (res.code !== 0) throw new Error(res.out.split('\n').slice(-5).join(' | '))
    return res.out.match(/[^\n]*Demo state[^\n]*/)?.[0] ?? 'seeded'
  })
  if (!seeded) return finish(source)
  const KEY = readFileSync(path.join(demoOut, 'api-key.txt'), 'utf8').trim()
  const tenantId = (await source.query<{ id: string }>(`SELECT id FROM public.tenants WHERE slug = $1`, [DEMO.slug])).rows[0].id

  // Files in Supabase Storage: a font through the API, and a logo whose public URL is stored.
  const fontBytes = Buffer.concat([Buffer.from('wOF2'), Buffer.from(`e2e-font-${RUN}`.padEnd(80, '.'))])
  let fontPath = ''
  const logoBytes = Buffer.from(`e2e-logo-${RUN}`)
  const logoKey = `${tenantId}/e2e-logo-${RUN}.png`
  await check('storage', 'baseline: font upload + logo on Supabase Storage', async () => {
    const up = await api(KEY, 'POST', '/workspace-theme/fonts', { file_name: `E2E-${RUN}.woff2`, content_base64: fontBytes.toString('base64') })
    fontPath = new URL(up.font.url, APP_URL).pathname
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/logos/${logoKey}`, {
      method: 'POST', headers: { authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'image/png', 'x-upsert': 'true' }, body: logoBytes,
    })
    if (!res.ok) throw new Error(`logo upload → ${res.status} ${await res.text()}`)
    await source.query(`UPDATE public.tenants SET branding = coalesce(branding, '{}'::jsonb) || jsonb_build_object('e2e_logo_url', $2::text) WHERE id = $1`, [
      tenantId, `${SUPABASE_URL}/storage/v1/object/public/logos/${logoKey}`,
    ])
    return `font ${fontPath}`
  })
  await smoke('before', KEY, { SMOKE_REALTIME: 'skip', SMOKE_MAIL: 'skip' })
  if (env.E2E_SKIP_SURFACES !== '1') {
    await check('before', 'surface E2E (scripts/e2e-surfaces.ts)', async () => {
      const res = run(TSX, [path.join(ROOT, 'scripts/e2e-surfaces.ts')], { ...common, USERTASKS_URL: APP_URL, USERTASKS_API_KEY: KEY }, { timeoutMs: 1_200_000, quiet: true })
      if (res.code !== 0) throw new Error(res.out.split('\n').filter((l) => /fail|✗|FAIL/i.test(l)).slice(0, 8).join(' | ') || res.out.slice(-400))
      return res.out.trim().split('\n').at(-1)
    })
  }
  await rlsSnapshot('before', SOURCE_DB)

  // 2. Switch every area, in the documented order.
  section('2. usertasks-admin switch, area by area')
  const switches: Array<{ area: string; args: string[] }> = [
    { area: 'auth', args: ['switch', 'auth', '--to', 'builtin'] },
    { area: 'realtime', args: ['switch', 'realtime', '--to', 'sse'] },
    { area: 'scheduler', args: ['switch', 'scheduler', '--to', 'worker'] },
    {
      area: 'storage',
      args: ['switch', 'storage', '--to', 's3', '--set', `endpoint=${S3_ENDPOINT}`, '--set', 'force_path_style=true', '--set', 'region=us-east-1',
        '--set', `access_key_id=${S3_KEY}`, '--secret', `secret_access_key=${S3_SECRET}`, '--set', `bucket_prefix=e2e-${RUN}-`],
    },
    {
      area: 'email',
      args: ['switch', 'email', '--to', 'smtp', '--set', `smtp_host=${SMTP_HOST}`, '--set', `smtp_port=${SMTP_PORT}`, '--set', 'smtp_starttls=off',
        '--set', 'from=UserTasks <noreply@e2e.usertasks.test>', '--test-to', `switch-test-${RUN}@e2e.usertasks.test`],
    },
    { area: 'secrets', args: ['switch', 'secrets', '--to', 'db'] },
  ]
  for (const s of switches) {
    const dry = admin([...s.args, '--dry-run'], supabaseEnv)
    await check(s.area, `switch --dry-run`, async () => { if (dry.code !== 0) throw new Error(dry.out.slice(-400)) })
    const ok = await check(s.area, `switch ${s.args.slice(1, 4).join(' ')}`, async () => {
      const res = admin([...s.args, '--yes', '--actor', 'e2e'], supabaseEnv)
      if (res.code !== 0) throw new Error(res.out.split('\n').slice(-8).join(' | '))
      return res.out.match(/Switched[^\n]*/)?.[0] ?? res.out.trim().split('\n').at(-1)
    })
    if (!ok) return finish(source)
    await check(s.area, 'app still serves the API', async () => { await api(KEY, 'GET', '/me') })
  }
  await check('email', 'test message reached Mailpit', async () => {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:switch-test-${RUN}@e2e.usertasks.test`)}`)
    const json: any = await res.json()
    if (!(json.messages_count > 0)) throw new Error('no test message')
  })

  // The database last: writes stop (the app is stopped), the copy runs, the app moves.
  await stopProcess(app)
  const sourceCounts = await countRows(source)
  const admin0 = new pg.Client({ connectionString: TARGET_ADMIN })
  await admin0.connect()
  await admin0.query(`CREATE DATABASE ${TARGET_DB_NAME}`)
  await admin0.end()
  const dbSwitched = await check('database', 'switch database --to postgres (copy + row counts + RLS smoke)', async () => {
    const res = admin(['switch', 'database', '--to', 'postgres', '--target-url', TARGET_DB, '--yes', '--actor', 'e2e'], supabaseEnv)
    if (res.code !== 0) throw new Error(res.out.split('\n').slice(-10).join(' | '))
    return res.out.match(/row counts[^\n]*/i)?.[0] ?? 'copied'
  })
  if (!dbSwitched) return finish(source)
  const target = new pg.Client({ connectionString: TARGET_DB })
  await target.connect()
  await check('database', 'row counts match the source', async () => {
    const after = await countRows(target)
    const diff = Object.keys(sourceCounts).filter((t) => sourceCounts[t] !== after[t])
    if (diff.length) throw new Error(diff.map((t) => `${t}: ${sourceCounts[t]} → ${after[t]}`).join(', '))
    return `${Object.keys(after).length} tables, ${Object.values(after).reduce((a, b) => a + b, 0)} rows`
  })

  // 3. The migrated install: no Supabase settings at all.
  section('3. Restart on the new stack (no Supabase)')
  const startedAt = new Date()
  app = await startApp('app-standalone', standaloneEnv)
  await check('auth', 'demo owner signs in with the migrated password (smoke below)', async () => {
    const { rows } = await target.query(`SELECT migrated_from FROM app_auth.credentials c JOIN public.users u ON u.id = c.user_id WHERE u.email = $1`, [DEMO.email])
    if (rows[0]?.migrated_from !== 'supabase') throw new Error(`credential row: ${JSON.stringify(rows[0] ?? null)}`)
    return 'credential migrated from Supabase Auth'
  })
  await smoke('after', KEY, { SMOKE_REALTIME: 'sse', SMOKE_MAIL: 'mailpit', SMOKE_MAIL_URL: MAILPIT })
  await check('storage', 'files copied from Supabase load via /files', async () => {
    const font = await fetch(`${APP_URL}${fontPath.replace(/^.*\/(brand-fonts\/)/, '/files/$1')}`)
    const fontGot = Buffer.from(await font.arrayBuffer())
    if (!font.ok || !fontGot.equals(fontBytes)) throw new Error(`font → ${font.status} (${fontGot.length} bytes)`)
    const { rows } = await target.query<{ url: string }>(`SELECT branding->>'e2e_logo_url' AS url FROM public.tenants WHERE id = $1`, [tenantId])
    const stored = rows[0]?.url ?? ''
    const logo = await fetch(`${APP_URL}/files/logos/${logoKey}`)
    const logoGot = Buffer.from(await logo.arrayBuffer())
    if (!logo.ok || !logoGot.equals(logoBytes)) throw new Error(`logo → ${logo.status}`)
    return `font and logo identical; stored logo URL now ${stored.startsWith('storage://') ? stored : `${stored} (not rewritten: custom branding key)`}`
  })
  if (env.E2E_SKIP_SURFACES !== '1') {
    await check('after', 'surface E2E (scripts/e2e-surfaces.ts)', async () => {
      const res = run(TSX, [path.join(ROOT, 'scripts/e2e-surfaces.ts')], { ...common, USERTASKS_URL: APP_URL, USERTASKS_API_KEY: KEY }, { timeoutMs: 1_200_000, quiet: true })
      if (res.code !== 0) throw new Error(res.out.split('\n').filter((l) => /fail|✗|FAIL/i.test(l)).slice(0, 8).join(' | ') || res.out.slice(-400))
      return res.out.trim().split('\n').at(-1)
    })
  }
  const before = await mockStats()
  await api(KEY, 'POST', '/tasks/ingest', { title: `Log export E2E ${RUN}` })
  await check('scheduler', 'scheduled jobs run through the built-in worker', async () => {
    for (let i = 0; i < 30; i++) {
      const { rows } = await target.query<{ job_name: string; last_status: string }>(
        `SELECT job_name, last_status FROM app_cron.tick_runs WHERE last_finished_at >= $1 ORDER BY job_name`, [startedAt],
      )
      const leader = await target.query(`SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted`)
      if (rows.length && leader.rowCount) {
        const failed = rows.filter((r) => r.last_status === 'error')
        if (failed.length) throw new Error(`failed: ${failed.map((r) => r.job_name).join(', ')}`)
        return `${rows.length} job(s) ran since the restart: ${rows.map((r) => r.job_name).join(', ')}`
      }
      await sleep(5000)
    }
    throw new Error('no tick_runs since the restart within 150 s')
  })
  await check('log export', 'new events shipped to the Splunk HEC destination', async () => {
    for (let i = 0; i < 30; i++) {
      const now = await mockStats()
      if (now.splunk_events > before.splunk_events) return `${now.splunk_events - before.splunk_events} event(s) shipped by the worker's ship-events job`
      await sleep(5000)
    }
    throw new Error(`Splunk mock received nothing new within 150 s (${before.splunk_events} before)`)
  })
  await check('after', 'usertasks-admin doctor (every area)', async () => {
    const res = admin(['doctor', '--json'], standaloneEnv)
    const report = JSON.parse(res.stdout)
    const bad = (report.checks as Array<{ area: string; name: string; status: string; detail: string }>).filter((c) => c.status === 'fail')
    if (bad.length) throw new Error(bad.map((c) => `${c.area} ${c.name}: ${c.detail}`).join(' | '))
    const providers = admin(['status', '--json'], standaloneEnv)
    const status = JSON.parse(providers.stdout)
    return status.areas.map((a: { area: string; provider: string }) => `${a.area}=${a.provider}`).join(' ')
  })
  await rlsSnapshot('after', TARGET_DB)
  await stopProcess(app)
  await target.end()
  return finish(source)
}

/** Row counts of the public and app_auth tables (what the database switch copies). */
async function countRows(db: pg.Client): Promise<Record<string, number>> {
  const { rows } = await db.query<{ t: string }>(`SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables WHERE schemaname IN ('public', 'app_auth') ORDER BY 1`)
  const out: Record<string, number> = {}
  for (const { t } of rows) out[t] = Number((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n)
  // Rows the switches themselves write on each side.
  delete out['public.instance_provider_switches']
  return out
}

async function finish(source: pg.Client): Promise<void> {
  await source.end().catch(() => undefined)
  for (const child of children) await stopProcess(child)
  console.log('\n── Summary ──')
  const areas = [...new Set(results.map((r) => r.area))]
  for (const area of areas) {
    const rs = results.filter((r) => r.area === area)
    console.log(`  ${rs.every((r) => r.ok) ? 'ok  ' : 'FAIL'}  ${area.padEnd(10)} ${rs.filter((r) => r.ok).length}/${rs.length}`)
  }
  const failed = results.filter((r) => !r.ok).length
  if (env.E2E_REPORT) writeFileSync(env.E2E_REPORT, JSON.stringify({ run: RUN, results, logs: WORK }, null, 2))
  console.log(failed ? `\n${failed} of ${results.length} checks failed (logs: ${WORK}).` : `\nAll ${results.length} checks passed (logs: ${WORK}).`)
  console.log(`Target database ${TARGET_DB_NAME} is left in place for inspection.`)
  process.exit(failed ? 1 : 0)
}

process.on('SIGINT', () => { for (const c of children) c.kill('SIGKILL'); process.exit(130) })
main().catch(async (error) => {
  console.error(error)
  for (const c of children) c.kill('SIGKILL')
  process.exit(1)
})
