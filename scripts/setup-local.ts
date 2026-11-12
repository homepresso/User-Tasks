/**
 * `npm run setup:local`: everything a source checkout needs before
 * `npm run dev`, in one command that works in PowerShell, cmd, bash and zsh.
 *
 *   npm run setup:local                 set up (safe to run again at any time)
 *   npm run setup:local -- --start      ...then run npm run dev
 *   npm run setup:local -- --force      also point an existing .env.local at the local Supabase
 *   npm run setup:local -- --reset      wipe the local database and rebuild it (asks first)
 *   npm run setup:local -- --reset --yes   ...without asking
 *
 * Steps:
 *  1. Checks Node.js (22 LTS recommended; 20.9+ works, with a warning) and that Docker is installed and running.
 *  2. Checks it runs in the UserTasks folder.
 *  3. npm install, when node_modules is missing.
 *  4. Starts the local Supabase (`npx supabase start`) unless it's running.
 *     supabase/config.toml is in the repository, so `supabase init` is never
 *     needed. A brand-new local database gets every migration from `supabase
 *     start`; an existing one gets only the new ones (`supabase migration
 *     up`), so its data is kept. Only --reset (after a confirmation) wipes it.
 *  5. Reads the URL and keys from `npx supabase status -o env`.
 *  6. Writes .env.local from .env.example (scripts/setup-local/env-file.ts):
 *     never overwrites values already there, never prints secrets.
 *  7. Stores the cron secret and app URL in the local database's Vault, so
 *     schedules and queued runs work (docs/self-hosting.md §3). Only when
 *     .env.local points at this local Supabase.
 *  8. Prints what to do next.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Client } from 'pg'
import { installPgCron, pgCronStatus, VAULT_BASE_URL_SECRET, VAULT_CRON_SECRET } from '../lib/providers/scheduler/pg-cron'
import { describePlan, isLocalUrl, parseSupabaseStatus, planEnvFile, supabaseKeysFromStatus, type LocalSupabaseKeys } from './setup-local/env-file'

const ROOT = process.cwd()
const IS_WINDOWS = process.platform === 'win32'
const APP_URL = 'http://localhost:3000'
/** pg_cron runs inside Docker: this is how it reaches `npm run dev` on your machine. */
const CRON_BASE_URL = 'http://host.docker.internal:3000'
const DOCKER_URL = 'https://www.docker.com/products/docker-desktop/'
const NODE_URL = 'https://nodejs.org/'

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)

if (flag('help') || flag('h')) {
  console.log(`npm run setup:local [-- options]

Sets up UserTasks on this computer: checks Node.js and Docker, installs packages,
starts the local Supabase, writes .env.local and sets up background jobs.
Safe to run again at any time.

  --start         run npm run dev when setup is done
  --force         point an existing .env.local at the local Supabase (URL and keys only)
  --reset         wipe the local database and rebuild it (asks first)
  --yes           with --reset: don't ask`)
  process.exit(0)
}

const say = (line = '') => console.log(line)
const step = (n: number, text: string) => say(`\n[${n}/7] ${text}`)

function stop(lines: string[]): never {
  console.error('')
  for (const line of lines) console.error(line)
  console.error('')
  process.exit(1)
}

/**
 * Runs a command. On Windows npm and npx are .cmd files, which Node only
 * starts through a shell; every argument here is a plain word, so that's safe.
 */
function run(command: string, args: string[], options: SpawnSyncOptions = {}) {
  const base: SpawnSyncOptions = { cwd: ROOT, encoding: 'utf8', ...options }
  // One string with shell: true (args + shell is deprecated in Node 22+, DEP0190).
  return IS_WINDOWS ? spawnSync([command, ...args].join(' '), { ...base, shell: true }) : spawnSync(command, args, base)
}

/** `npx supabase …`, answering npx's "Ok to proceed?" for a first download. */
function supabase(args: string[], options: SpawnSyncOptions = {}) {
  return run('npx', ['--yes', 'supabase', ...args], options)
}

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 20 || (major === 20 && minor < 9)) {
    stop([
      `UserTasks needs Node.js 20.9 or later (22 LTS recommended); this computer has ${process.versions.node}.`,
      `Download the 22 LTS (or later) from ${NODE_URL}, install it, close this terminal, open a new one and run this again.`,
    ])
  }
  if (major < 22) {
    say(`  Node.js ${process.versions.node}: works, but Node.js 22 LTS is recommended (Node.js 20 is past its end of life,`)
    say(`  and npm warns "EBADENGINE" for a package that asks for 22). Install the 22 LTS from ${NODE_URL} when you can.`)
    return
  }
  say(`  Node.js ${process.versions.node}: OK`)
}

function checkDocker() {
  const version = run('docker', ['--version'])
  if (version.error || version.status !== 0) {
    stop([
      "Docker isn't installed (or this terminal can't find it).",
      `UserTasks runs its database in Docker. Install Docker Desktop from ${DOCKER_URL},`,
      'start it, and restart your computer if it asks.' + (IS_WINDOWS ? ' If Docker Desktop asks you to turn on WSL 2, say yes.' : ''),
      'Then open a new terminal and run this again: npm run setup:local',
    ])
  }
  const info = run('docker', ['info'], { stdio: 'pipe' })
  if (info.status !== 0) {
    stop([
      "Docker is installed but not running.",
      'Start Docker Desktop (from the Start menu, Applications or your launcher) and wait until it says it is running,',
      'then run this again: npm run setup:local',
      `Don't have Docker Desktop? Download it from ${DOCKER_URL}`,
    ])
  }
  say(`  ${String(version.stdout).trim()}: running`)
}

function checkFolder() {
  const pkgFile = path.join(ROOT, 'package.json')
  let name: string | undefined
  try {
    name = JSON.parse(readFileSync(pkgFile, 'utf8')).name
  } catch {
    name = undefined
  }
  if (name !== 'usertasks' || !existsSync(path.join(ROOT, 'supabase', 'config.toml')) || !existsSync(path.join(ROOT, '.env.example'))) {
    stop([
      `Run this from the UserTasks folder (the one with package.json); this folder is ${ROOT}.`,
      'Go into it with: cd usertasks   (or wherever you cloned it), then run: npm run setup:local',
    ])
  }
  say(`  Folder: ${ROOT}`)
}

function installDependencies() {
  if (existsSync(path.join(ROOT, 'node_modules'))) {
    say('  node_modules is there: skipping npm install.')
    return
  }
  say('  Running npm install (a few minutes the first time)...')
  const result = run('npm', ['install'], { stdio: 'inherit' })
  if (result.status !== 0) stop(['npm install failed. Read the error above, fix it, and run npm run setup:local again.'])
}

function supabaseStatus(): LocalSupabaseKeys | null {
  const result = supabase(['status', '-o', 'env'], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) return null
  return supabaseKeysFromStatus(parseSupabaseStatus(String(result.stdout)))
}

async function confirm(question: string): Promise<boolean> {
  if (flag('yes')) return true
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim().toLowerCase() === 'yes'
  } finally {
    rl.close()
  }
}

async function startSupabase(): Promise<LocalSupabaseKeys> {
  let keys = supabaseStatus()
  if (keys) {
    say(`  Local Supabase is already running at ${keys.url}.`)
  } else {
    say('  Starting the local Supabase (database, sign-in and file storage, in Docker).')
    say('  The first time it downloads several images: this can take 5-10 minutes. Later starts take seconds.')
    const result = supabase(['start'], { stdio: 'inherit' })
    if (result.status !== 0) {
      stop([
        "The local Supabase didn't start. Common causes:",
        '  - Docker Desktop stopped, or is still starting: wait until it says running, then run this again.',
        '  - Another Supabase project is using the same ports: stop it (npx supabase stop in that folder).',
        '  - Docker ran out of memory or disk space: free some up in Docker Desktop → Settings → Resources.',
        'More help: https://usertasks.com/docs/self-hosting/troubleshooting',
      ])
    }
    keys = supabaseStatus()
    if (!keys) stop(["The local Supabase started, but `npx supabase status -o env` didn't print its URL and keys. Run that command to see what's wrong."])
  }

  if (flag('reset')) {
    say('')
    say('  --reset DELETES everything in the local database (workspaces, users, forms, runs) and rebuilds it.')
    const ok = await confirm('  Type "yes" to wipe the local database: ')
    if (!ok) stop(['Not reset: nothing was changed.' + (process.stdin.isTTY ? '' : ' (No terminal to ask in: add --yes to confirm.)')])
    const reset = supabase(['db', 'reset'], { stdio: 'inherit' })
    if (reset.status !== 0) stop(['npx supabase db reset failed. Read the error above.'])
  } else {
    // New database: `supabase start` already applied every migration and this is a no-op.
    // Existing database: applies only the migrations it doesn't have yet. Data is kept.
    say('  Applying any new database migrations (your data is kept)...')
    const up = supabase(['migration', 'up'], { stdio: 'inherit' })
    if (up.status !== 0) {
      stop([
        "Couldn't apply the database migrations (see above). Your data hasn't been touched.",
        'If this is a scratch install you can rebuild the database from scratch with:',
        '  npm run setup:local -- --reset      (this deletes everything in the local database)',
      ])
    }
  }
  return keys
}

function writeEnvFile(keys: LocalSupabaseKeys): Record<string, string> {
  const envFile = path.join(ROOT, '.env.local')
  const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8') : null
  const plan = planEnvFile({
    template: readFileSync(path.join(ROOT, '.env.example'), 'utf8'),
    existing,
    supabase: keys,
    force: flag('force'),
    appUrl: APP_URL,
  })
  if (plan.changed) writeFileSync(envFile, plan.text, { mode: 0o600 })
  for (const line of describePlan(plan)) say(`  ${line}`)
  for (const warning of plan.warnings) say(`  Note: ${warning}`)
  return plan.values
}

async function configureScheduler(keys: LocalSupabaseKeys, values: Record<string, string>) {
  if (!isLocalUrl(values.NEXT_PUBLIC_SUPABASE_URL) || values.NEXT_PUBLIC_SUPABASE_URL !== keys.url) {
    say("  Skipped: .env.local doesn't point at the local Supabase, so the local database's scheduler isn't set up.")
    return
  }
  if (!keys.dbUrl) {
    say("  Skipped: `supabase status` didn't print DB_URL. Schedules and queued runs need the two Vault secrets in docs/self-hosting.md (section 3).")
    return
  }
  const secret = process.env.WORKFLOW_PROCESSOR_SECRET || values.CRON_SECRET
  const client = new Client({ connectionString: keys.dbUrl, application_name: 'usertasks-setup-local' })
  try {
    await client.connect()
    const status = await pgCronStatus(client)
    const { rows } = await client.query<{ name: string; value: string }>(
      'SELECT name, decrypted_secret AS value FROM vault.decrypted_secrets WHERE name = ANY($1)',
      [[VAULT_BASE_URL_SECRET, VAULT_CRON_SECRET]],
    )
    const current = Object.fromEntries(rows.map((row) => [row.name, row.value]))
    const options: { baseUrl?: string; secret?: string } = {}
    // Keep a base URL someone set on purpose (another port); set the secret to match .env.local.
    if (!current[VAULT_BASE_URL_SECRET]) options.baseUrl = CRON_BASE_URL
    if (current[VAULT_CRON_SECRET] !== secret) options.secret = secret
    if (!options.baseUrl && !options.secret && status.installed) {
      say('  Background jobs are already set up in the local database.')
      return
    }
    const result = await installPgCron(client, options)
    const changed = Object.entries(result.vault).map(([name, action]) => `${name} ${action}`)
    say(`  Background jobs set up (pg_cron calls ${current[VAULT_BASE_URL_SECRET] || CRON_BASE_URL} every minute)${changed.length ? `; Vault: ${changed.join(', ')}` : ''}.`)
  } catch (error) {
    say(`  Skipped (${(error as Error).message}).`)
    say('  The app works without it; schedules, delays and queued runs wait until it is set up. See docs/self-hosting.md, section 3.')
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function main() {
  say('Setting up UserTasks on this computer.')

  step(1, 'Checking Node.js and Docker')
  checkNode()
  checkDocker()

  step(2, 'Checking the folder')
  checkFolder()

  step(3, 'Installing packages')
  installDependencies()

  step(4, 'Starting the local database (Supabase)')
  const keys = await startSupabase()

  step(5, 'Reading the local Supabase URL and keys')
  say(`  API: ${keys.url} (keys read; not shown)`)

  step(6, 'Writing .env.local')
  const values = writeEnvFile(keys)

  step(7, 'Setting up background jobs (schedules, queued runs)')
  await configureScheduler(keys, values)

  say('')
  say('All set.')
  say('')
  say('Next:')
  say('  1. Run:   npm run dev')
  say('  2. Wait for "Ready", then find the line:   UserTasks setup code: XXXX-XXXX-XXXX')
  say(`  3. Open ${APP_URL} in your browser and fill in "Create your admin account" with that code.`)
  say('')
  say('Lost the code? npm run setup-code prints a new one.')
  say('To stop later: Ctrl+C, then npx supabase stop. To start again: npx supabase start, then npm run dev.')

  if (flag('start')) {
    say('')
    say('Starting npm run dev (Ctrl+C to stop)...')
    const dev = run('npm', ['run', 'dev'], { stdio: 'inherit' })
    process.exit(dev.status ?? 0)
  }
}

main().catch((error) => {
  stop([`Setup stopped: ${(error as Error).message}`, 'Run npm run setup:local again after fixing it. More help: https://usertasks.com/docs/self-hosting/troubleshooting'])
})
