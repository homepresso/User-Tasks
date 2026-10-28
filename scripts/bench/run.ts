/**
 * Benchmark runner. Writes scripts/bench/results/<label>.json + <label>.md
 * (each suite's entry is replaced when it is re-run). See README.md.
 *
 *   npx tsx scripts/bench/run.ts --label baseline \
 *     [--suites engine,probes,queue,api,db,size] [--app-dir <clone>] [--app-url http://127.0.0.1:3311]
 *     [--build] [--docker] [--slow] [--reps 3] [--requests 100]
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertLocal, benchEnv, parseArgs } from './lib/env'
import { saveSuite, type SuiteResult } from './lib/results'

// size first: with --build it produces the build the server suites run against.
const ALL = ['size', 'engine', 'probes', 'db', 'queue', 'api']
const SERVER_SUITES = new Set(['queue', 'api'])

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) })
    return true
  } catch {
    return false
  }
}

async function startServer(appDir: string, appUrl: string, env: Record<string, string>): Promise<ChildProcess> {
  const nextBin = join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next')
  if (!existsSync(join(appDir, '.next', 'BUILD_ID'))) throw new Error(`${appDir} has no production build — add --build (with the size suite) or run next build there`)
  const { port, hostname } = new URL(appUrl)
  const child = spawn(process.execPath, [nextBin, 'start', '-p', port, '-H', hostname], { cwd: appDir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout?.on('data', (d) => { output += d })
  child.stderr?.on('data', (d) => { output += d })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited:\n${output.slice(-2000)}`)
    if (await reachable(`${appUrl}/api/v1/me`)) return child
    await new Promise((r) => setTimeout(r, 300))
  }
  child.kill()
  throw new Error(`next start did not answer within 60 s:\n${output.slice(-2000)}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const label = typeof args.label === 'string' ? args.label : ''
  if (!/^[\w.-]+$/.test(label)) throw new Error('--label <name> is required (letters, digits, . _ -)')
  const suites = typeof args.suites === 'string' ? args.suites.split(',').map((s) => s.trim()).filter(Boolean) : ALL
  for (const s of suites) if (!ALL.includes(s)) throw new Error(`unknown suite "${s}" (${ALL.join(', ')})`)
  const appUrl = typeof args['app-url'] === 'string' ? args['app-url'].replace(/\/+$/, '') : 'http://127.0.0.1:3311'
  const appDir = typeof args['app-dir'] === 'string' ? resolve(args['app-dir']) : null
  const secret = typeof args.secret === 'string' ? args.secret : 'bench-processor-secret'
  assertLocal(appUrl, 'App URL')
  if (new URL(appUrl).port === '3000') throw new Error('Refusing :3000 (the dev server) — use another --app-url port')

  const env = benchEnv()
  // Build- and run-time env of the app under test: local stack only. NEXT_PUBLIC_*
  // values are inlined by next build, so the build must see the same ones.
  // WORKFLOW_PROCESSOR_SECRET (not just CRON_SECRET) so kickQueueProcessor's
  // X-Processor-Secret header is sent — see docs/perf/baseline.md.
  const appEnv: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: env.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: env.serviceKey,
    NEXT_PUBLIC_APP_URL: appUrl,
    DEPLOYMENT_MODE: 'self_hosted',
    CRON_SECRET: secret,
    WORKFLOW_PROCESSOR_SECRET: secret,
  }

  const reps = Number(args.reps ?? 3)
  const requests = Number(args.requests ?? 100)
  let server: ChildProcess | null = null

  const run = async (name: string, fn: () => Promise<SuiteResult>) => {
    console.log(`▶ ${name}`)
    const started = performance.now()
    const result = await fn()
    saveSuite(label, name, result, performance.now() - started)
  }

  try {
    for (const name of suites) {
      if (SERVER_SUITES.has(name) && !server && !(await reachable(`${appUrl}/api/v1/me`))) {
        if (!appDir) throw new Error(`${appUrl} is not answering — start the app there or pass --app-dir to start it`)
        console.log(`▶ starting next start in ${appDir} at ${appUrl}`)
        server = await startServer(appDir, appUrl, appEnv)
      }
      switch (name) {
        case 'engine': await run(name, async () => (await import('./suites/engine')).runEngine({ reps })); break
        case 'probes': await run(name, async () => (await import('./suites/probes')).runProbes()); break
        case 'queue': await run(name, async () => (await import('./suites/queue')).runQueue({ appUrl, secret, slow: Boolean(args.slow) })); break
        case 'api': await run(name, async () => (await import('./suites/api')).runApi({ appUrl, requests })); break
        case 'db': await run(name, async () => (await import('./suites/db')).runDb({ label })); break
        case 'size': {
          if (!appDir) throw new Error('the size suite needs --app-dir (a clone to build/measure)')
          await run(name, async () => (await import('./suites/size')).runSize({ appDir, build: Boolean(args.build), docker: Boolean(args.docker), env: appEnv }))
          break
        }
      }
    }
  } finally {
    server?.kill()
  }
  console.log(`Results: scripts/bench/results/${label}.json and ${label}.md`)
}

main().catch((error) => {
  console.error(`bench: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
