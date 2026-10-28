import path from 'node:path'
import { parseArgs } from 'node:util'
import type pg from 'pg'
import { PROVIDER_AREAS, type ProviderArea } from '@/lib/config/schema'
import { resolveInstanceConfig } from '@/lib/config'
import { AREA_LABELS, areaName, catalogueBadges, catalogueEntry, filterCatalogue, isDefaultProvider, parseArea } from '@/lib/admin/catalogue'
import { runDoctor, type DoctorReport } from '@/lib/admin/doctor'
import { INSTANCE_ADMINS_SETTING, parseAdminEmails } from '@/lib/admin/instance-admins'
import { ALLOW_UI_SWITCHING_SETTING, switchingGate } from '@/lib/admin/switch-runtime'
import { ensureStorageBuckets, runBootstrap } from './bootstrap'
import { loadMigrations } from './db/migrations'
import { computeStatus, describeTarget, migrate, readApplied, repair } from './db/runner'
import { connect, decodeSettings, defaultActor, encodeSetting, loadInstanceConfig, notifyConfigChanged, readSettingRows, upsertSettingRow } from './instance'
import { runRollback, runSwitch } from './switch/engine'
import { loadCliKeyring } from './kms'
import { runKms } from './kms-cli'
import { housekeepingSummary, resolveHousekeepingOption, runHousekeepingCommand, type HousekeepingAction } from './housekeeping-cli'
import { housekeepingFindings, sqlHousekeeping } from '@/lib/admin/housekeeping'
import { hasSwitchLog, listRecords } from './switch/log'
import { SWITCH_PLANS } from './switch/plans'
import type { SwitchOptions } from './switch/types'

/**
 * usertasks-admin — server-side administration, run where the app runs
 * (same environment: DATABASE_URL, provider variables, ENCRYPTION_KEY).
 * `run(argv, io)` returns the exit code (0 ok, 1 failed, 2 usage / refused).
 */

export const VERSION = '0.1.0'

export const USAGE = `usertasks-admin ${VERSION}

Usage:
  usertasks-admin status [--json]
  usertasks-admin providers list [--area <area>] [--on-prem] [--aws] [--azure] [--gcp] [--json]
  usertasks-admin doctor [--area <a,b>] [--read-only] [--email-to <address>] [--json]
  usertasks-admin switch <area> --to <provider> [--dry-run] [--yes] [--backup-dir <dir>]
                         [--set <option>=<value>]... [--secret <option>=<value>]... [--no-dump] [--force]
      database   --target-url <postgres://…> | --target-host <h> [--target-port 5432] --target-database <db> --target-user <u>
                 [--target-password <pw|secret://name>] (or TARGET_DATABASE_PASSWORD) [--target-sslmode require|verify-full]
                 [--target-ca <pem file>] [--target-auth password|azure|gcp|aws] [--prepare-only] [--dir <migrations>]
      auth       [--map google=oidc:google,azure=oidc:entra]
      storage    [--bucket <name>]... [--prefix <key prefix>] [--overwrite]
      scheduler  [--base-url <url>] [--no-secrets]
      email      [--test-to <address>]
      cache      (validated config: connection, read/write and a rate-limit round trip)
      kms        [--set aws_kms_key_id=… | --set vault_transit_key=… | …] (re-wraps the data keys)
  usertasks-admin kms status [--json]
  usertasks-admin kms rotate [--activate-in <seconds>] [--yes]
  usertasks-admin kms rewrap [--batch <n>] [--restart] [--dry-run] [--yes]
  usertasks-admin kms rewrap-keys [--force] [--dry-run] [--yes]
  usertasks-admin kms prune [--dry-run] [--yes]
  usertasks-admin rollback <switch-id> [--dry-run] [--yes] [--backup-dir <dir>]
  usertasks-admin history [--limit <n>] [--json]
  usertasks-admin instance-admins list | add <email>... | remove <email>...
  usertasks-admin ui-switching status | on | off   (cloud edition: allow provider changes from Settings → Infrastructure)
  usertasks-admin housekeeping show [--json]
  usertasks-admin housekeeping set <setting> <value|default>
      enabled true|false · interval_minutes 15|30|60|…|1440 · cron_history_hours 1–2160 (or 12h, 1d)
      http_response_minutes 5–10080 (or 30m, 1h)
  usertasks-admin housekeeping run [--dry-run] [--json]
  usertasks-admin bootstrap --email <email> --password <password> --org <name> [--name <full name>]
                            [--api-key <key name>] [--if-missing]
  usertasks-admin storage init
  usertasks-admin db migrate [--dry-run] [--include-all] [--owner <role>] [--dir <path>]
  usertasks-admin db status [--dir <path>]
  usertasks-admin db repair --status applied|reverted <version>... [--dir <path>]

Areas: database, auth, storage, realtime, scheduler, email, secrets, cache, kms.
Global: --db-url <url> (default MIGRATION_DATABASE_URL, then DATABASE_URL), --actor <name>.
Backups: --backup-dir, else BACKUP_DIR, else ./backups/switches (private: 0700).`

export interface CliIO {
  out: (line: string) => void
  err: (line: string) => void
  env: NodeJS.ProcessEnv
}

export const defaultIO: CliIO = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  env: process.env,
}

const OPTIONS = {
  'dry-run': { type: 'boolean' },
  'include-all': { type: 'boolean' },
  owner: { type: 'string' },
  dir: { type: 'string' },
  status: { type: 'string' },
  'db-url': { type: 'string' },
  json: { type: 'boolean' },
  area: { type: 'string' },
  'on-prem': { type: 'boolean' },
  aws: { type: 'boolean' },
  azure: { type: 'boolean' },
  gcp: { type: 'boolean' },
  'read-only': { type: 'boolean' },
  'email-to': { type: 'string' },
  to: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
  'backup-dir': { type: 'string' },
  set: { type: 'string', multiple: true },
  secret: { type: 'string', multiple: true },
  'no-dump': { type: 'boolean' },
  force: { type: 'boolean' },
  actor: { type: 'string' },
  'target-url': { type: 'string' },
  'target-host': { type: 'string' },
  'target-port': { type: 'string' },
  'target-database': { type: 'string' },
  'target-user': { type: 'string' },
  'target-password': { type: 'string' },
  'target-sslmode': { type: 'string' },
  'target-ca': { type: 'string' },
  'target-auth': { type: 'string' },
  'prepare-only': { type: 'boolean' },
  map: { type: 'string' },
  bucket: { type: 'string', multiple: true },
  prefix: { type: 'string' },
  overwrite: { type: 'boolean' },
  columns: { type: 'string' },
  'base-url': { type: 'string' },
  'no-secrets': { type: 'boolean' },
  'test-to': { type: 'string' },
  limit: { type: 'string' },
  email: { type: 'string' },
  password: { type: 'string' },
  org: { type: 'string' },
  name: { type: 'string' },
  'api-key': { type: 'string' },
  'if-missing': { type: 'boolean' },
  'activate-in': { type: 'string' },
  batch: { type: 'string' },
  restart: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

export type ParsedValues = ReturnType<typeof parse>['values']

function parse(argv: string[]) {
  return parseArgs({ args: argv, allowPositionals: true, strict: true, options: OPTIONS })
}

export type Command =
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'providers' }
  | { kind: 'doctor'; areas: ProviderArea[] }
  | { kind: 'switch'; area: ProviderArea; options: SwitchOptions }
  | { kind: 'rollback'; id: string }
  | { kind: 'history' }
  | { kind: 'instance-admins'; action: 'list' | 'add' | 'remove'; emails: string[] }
  | { kind: 'ui-switching'; action: 'status' | 'on' | 'off' }
  | { kind: 'housekeeping'; action: HousekeepingAction; args: string[] }
  | { kind: 'db'; action: 'migrate' | 'status' | 'repair'; rest: string[] }
  | { kind: 'bootstrap' }
  | { kind: 'storage-init' }
  | { kind: 'kms'; action: 'status' | 'rotate' | 'rewrap' | 'rewrap-keys' | 'prune' }

function pairs(list: string[] | undefined, flag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of list ?? []) {
    const eq = item.indexOf('=')
    if (eq < 1) throw new UsageError(`${flag} expects <option>=<value>, got "${item}"`)
    const key = item.slice(0, eq).trim()
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) throw new UsageError(`${flag}: invalid option name "${key}"`)
    out[key] = item.slice(eq + 1)
  }
  return out
}

export class UsageError extends Error {}

export function backupRoot(values: ParsedValues, env: NodeJS.ProcessEnv): string {
  return path.resolve(values['backup-dir'] || env.BACKUP_DIR || 'backups/switches')
}

/** argv → command (throws UsageError). Pure: no I/O. */
export function parseCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): { command: Command; values: ParsedValues } {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv)
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
  const { values, positionals } = parsed
  const [verb, sub, ...rest] = positionals
  if (values.help || !verb) return { command: { kind: 'help' }, values }
  switch (verb) {
    case 'status':
      return { command: { kind: 'status' }, values }
    case 'providers':
      if (sub && sub !== 'list' && sub !== 'show') throw new UsageError(`Unknown command: providers ${sub}`)
      if (values.area && !parseArea(values.area)) throw new UsageError(`Unknown area "${values.area}"`)
      return { command: { kind: 'providers' }, values }
    case 'doctor': {
      const areas = (values.area ?? '').split(',').map((a) => a.trim()).filter(Boolean).map((a) => {
        const area = parseArea(a)
        if (!area) throw new UsageError(`Unknown area "${a}"`)
        return area
      })
      return { command: { kind: 'doctor', areas }, values }
    }
    case 'switch': {
      const area = parseArea(sub)
      if (!area) throw new UsageError(sub ? `Unknown area "${sub}". Areas: database, ${PROVIDER_AREAS.filter((a) => a !== 'db').join(', ')}` : 'switch needs an area')
      if (!values.to) throw new UsageError('switch needs --to <provider>')
      if (rest.length) throw new UsageError(`Unexpected argument: ${rest[0]}`)
      const options: SwitchOptions = {
        to: values.to.trim().toLowerCase(),
        dryRun: values['dry-run'] === true,
        yes: values.yes === true,
        backupRoot: backupRoot(values, env),
        set: pairs(values.set, '--set'),
        secret: pairs(values.secret, '--secret'),
        flags: {
          'target-url': values['target-url'],
          'target-host': values['target-host'],
          'target-port': values['target-port'],
          'target-database': values['target-database'],
          'target-user': values['target-user'],
          // Prefer the environment (or a secret:// reference) over the command line, which `ps` shows.
          'target-password': values['target-password'] ?? env.TARGET_DATABASE_PASSWORD,
          'target-sslmode': values['target-sslmode'],
          'target-ca': values['target-ca'],
          'target-auth': values['target-auth'],
          'prepare-only': values['prepare-only'],
          dir: values.dir,
          map: values.map,
          bucket: values.bucket,
          prefix: values.prefix,
          overwrite: values.overwrite,
          columns: values.columns,
          'base-url': values['base-url'],
          'no-secrets': values['no-secrets'],
          'test-to': values['test-to'],
        },
        noDump: values['no-dump'] === true,
        actor: values.actor || defaultActor(),
        force: values.force === true,
      }
      if (area === 'db' && !options.flags['target-url'] && !(options.flags['target-host'] && options.flags['target-database'] && options.flags['target-user'])) {
        throw new UsageError('switch database needs --target-url <postgres://…> (or --target-host, --target-database and --target-user)')
      }
      if (options.flags['target-auth'] && !['password', 'azure', 'gcp', 'aws'].includes(String(options.flags['target-auth']))) throw new UsageError('--target-auth must be password, azure, gcp or aws')
      return { command: { kind: 'switch', area, options }, values }
    }
    case 'rollback':
      if (!sub) throw new UsageError('rollback needs a switch id (see `usertasks-admin history`)')
      return { command: { kind: 'rollback', id: sub }, values }
    case 'history':
      if (values.limit && !/^\d+$/.test(values.limit)) throw new UsageError('--limit must be a number')
      return { command: { kind: 'history' }, values }
    case 'instance-admins': {
      const action = (sub ?? 'list') as 'list' | 'add' | 'remove'
      if (!['list', 'add', 'remove'].includes(action)) throw new UsageError(`Unknown command: instance-admins ${sub}`)
      const emails = parseAdminEmails(rest)
      if (action !== 'list' && (!emails.length || emails.length !== rest.length)) throw new UsageError(`instance-admins ${action} needs one or more email addresses`)
      return { command: { kind: 'instance-admins', action, emails }, values }
    }
    case 'ui-switching': {
      const action = (sub ?? 'status') as 'status' | 'on' | 'off'
      if (!['status', 'on', 'off'].includes(action)) throw new UsageError(`Unknown command: ui-switching ${sub}`)
      if (rest.length) throw new UsageError(`Unexpected argument: ${rest[0]}`)
      return { command: { kind: 'ui-switching', action }, values }
    }
    case 'housekeeping': {
      const action = (sub ?? 'show') as HousekeepingAction
      if (!['show', 'set', 'run'].includes(action)) throw new UsageError(`Unknown command: housekeeping ${sub}`)
      if (action === 'set') {
        if (rest.length !== 2) throw new UsageError('housekeeping set needs <setting> <value> (or `default`)')
        if (!resolveHousekeepingOption(rest[0])) throw new UsageError(`Unknown housekeeping setting "${rest[0]}"`)
      } else if (rest.length) throw new UsageError(`Unexpected argument: ${rest[0]}`)
      if (values['dry-run'] && action !== 'run') throw new UsageError('--dry-run applies to housekeeping run only')
      return { command: { kind: 'housekeeping', action, args: rest }, values }
    }
    case 'bootstrap':
      if (sub) throw new UsageError(`Unexpected argument: ${sub}`)
      return { command: { kind: 'bootstrap' }, values }
    case 'storage':
      if (sub !== 'init' || rest.length) throw new UsageError(sub ? `Unknown command: storage ${sub}` : 'storage needs a command: init')
      return { command: { kind: 'storage-init' }, values }
    case 'kms': {
      const actions = ['status', 'rotate', 'rewrap', 'rewrap-keys', 'prune'] as const
      if (!actions.includes(sub as (typeof actions)[number]) || rest.length) throw new UsageError(sub ? `Unknown command: kms ${[sub, ...rest].join(' ')}` : `kms needs a command: ${actions.join(', ')}`)
      if (values['activate-in'] !== undefined && !/^\d+$/.test(values['activate-in'])) throw new UsageError('--activate-in must be a number of seconds')
      if (values.batch !== undefined && !/^\d+$/.test(values.batch)) throw new UsageError('--batch must be a number')
      return { command: { kind: 'kms', action: sub as (typeof actions)[number] }, values }
    }
    case 'db':
      if (!['migrate', 'status', 'repair'].includes(sub ?? '')) throw new UsageError(sub ? `Unknown command: db ${sub}` : 'db needs a command: migrate, status or repair')
      return { command: { kind: 'db', action: sub as 'migrate' | 'status' | 'repair', rest }, values }
    default:
      throw new UsageError(`Unknown command: ${verb}`)
  }
}

function dbUrlFrom(values: ParsedValues, env: NodeJS.ProcessEnv): string | undefined {
  return values['db-url'] || env.MIGRATION_DATABASE_URL || env.DATABASE_URL
}

const STATUS_MARK: Record<string, string> = { ok: 'ok', warn: 'WARN', fail: 'FAIL', skip: '-' }

function printDoctor(io: CliIO, report: DoctorReport): void {
  let area: string | null = null
  for (const check of report.checks) {
    if (check.area !== area) { area = check.area; io.out(`${AREA_LABELS[check.area]}`) }
    io.out(`  [${STATUS_MARK[check.status].padEnd(4)}] ${check.name.padEnd(16)} ${check.detail}`)
  }
  io.out(report.ok ? 'All checks passed.' : 'Some checks failed.')
}

async function withDb<T>(url: string | undefined, fn: (db: pg.Client | null) => Promise<T>, warn?: (line: string) => void): Promise<T> {
  const db = url ? await connect(url) : null
  try {
    // Data keys first: encrypted settings (and every command's secrets) may need them.
    if (db) for (const w of await loadCliKeyring(db)) warn?.(`warning: ${w}`)
    return await fn(db)
  } finally {
    await db?.end().catch(() => undefined)
  }
}

export async function run(argv: string[], io: CliIO = defaultIO): Promise<number> {
  let command: Command
  let values: ParsedValues
  try {
    ({ command, values } = parseCommand(argv, io.env))
  } catch (error) {
    if (error instanceof UsageError) { io.err(error.message); io.err('Run `usertasks-admin --help` for usage.'); return 2 }
    throw error
  }
  const url = dbUrlFrom(values, io.env)
  const needDb = (what: string) => { io.err(`Set DATABASE_URL (or --db-url) to ${what}.`); return 2 }

  switch (command.kind) {
    case 'help':
      io.out(USAGE)
      return 0

    case 'providers': {
      const entries = filterCatalogue({ area: parseArea(values.area) ?? undefined, onPrem: values['on-prem'], aws: values.aws, azure: values.azure, gcp: values.gcp })
      if (values.json) { io.out(JSON.stringify(entries, null, 2)); return 0 }
      let area: string | null = null
      for (const e of entries) {
        if (e.area !== area) { area = e.area; io.out(`${AREA_LABELS[e.area]} (${areaName(e.area)})`) }
        const flags = [...catalogueBadges(e), ...(isDefaultProvider(e.area, e.id) ? ['default'] : []), `switch:${e.switch}`]
        io.out(`  ${e.id.padEnd(20)} ${e.label.padEnd(46)} ${flags.join(' ')}`)
        if (e.capabilities.length) io.out(`  ${''.padEnd(20)} capabilities: ${e.capabilities.join(', ')}`)
      }
      if (!entries.length) io.out('No providers match.')
      return 0
    }

    case 'status':
      return withDb(url, async (db) => {
        const warnings: string[] = []
        const { config } = db ? await loadInstanceConfig(db, (w) => warnings.push(w)) : { config: resolveInstanceConfig(new Map()) }
        const report = await runDoctor({ config, sql: db, storageWriteProbe: false, timeoutMs: 8_000 })
        let pgVersion: string | null = null
        let migration: string | null = null
        let housekeeping: Awaited<ReturnType<ReturnType<typeof sqlHousekeeping>['status']>> | null = null
        if (db) {
          const target = await describeTarget(db)
          pgVersion = `${Math.floor(target.serverVersion / 10000)}${target.supabase ? ' (Supabase)' : ''}`
          const applied = await readApplied(db)
          migration = applied.at(-1)?.version ?? null
          housekeeping = await sqlHousekeeping(db).status().catch(() => null)
        }
        const rows = PROVIDER_AREAS.map((area) => {
          const p = config.providers[area]
          const entry = catalogueEntry(area, p.id)
          return { area: areaName(area), provider: p.id, source: p.source, badges: entry ? catalogueBadges(entry) : [], health: report.areas[area] }
        })
        if (values.json) {
          io.out(JSON.stringify({ cli: VERSION, postgres: pgVersion, migration, areas: rows, checks: report.checks, housekeeping: housekeeping && { settings: housekeeping.settings, last_run: housekeeping.runs[0] ?? null, findings: housekeepingFindings(housekeeping) } }, null, 2))
          return report.ok ? 0 : 1
        }
        io.out(`usertasks-admin ${VERSION}${pgVersion ? ` · PostgreSQL ${pgVersion}` : ' · no DATABASE_URL (config from the environment only)'}${migration ? ` · migration ${migration}` : ''}`)
        for (const row of rows) {
          io.out(`  ${row.area.padEnd(10)} ${row.provider.padEnd(20)} ${row.source.padEnd(9)} ${STATUS_MARK[row.health].padEnd(5)} ${row.badges.join(' ')}`)
        }
        if (db) io.out(`  ${'housekeeping'.padEnd(10)} ${housekeeping ? housekeepingSummary(housekeeping) : 'not installed (apply migration 20261109500000: usertasks-admin db migrate)'}`)
        for (const f of housekeeping ? housekeepingFindings(housekeeping) : []) if (f.level === 'warn') io.out(`  WARN ${f.name}: ${f.detail}`)
        for (const w of warnings) io.err(`warning: ${w}`)
        const failing = report.checks.filter((c) => c.status === 'fail')
        for (const c of failing) io.out(`  FAIL ${areaName(c.area)} ${c.name}: ${c.detail}`)
        if (failing.length) io.out('Run `usertasks-admin doctor` for every check.')
        return report.ok ? 0 : 1
      }, io.err)

    case 'doctor':
      return withDb(url, async (db) => {
        const { config } = db ? await loadInstanceConfig(db, io.err) : { config: resolveInstanceConfig(new Map()) }
        const report = await runDoctor({ config, sql: db, areas: command.areas, storageWriteProbe: !values['read-only'], emailTo: values['email-to'] })
        if (values.json) io.out(JSON.stringify(report, null, 2))
        else printDoctor(io, report)
        return report.ok ? 0 : 1
      }, io.err)

    case 'switch': {
      if (!url) return needDb('reach the app database')
      const plan = SWITCH_PLANS[command.area]
      return withDb(url, async (db) => {
        const result = await runSwitch({ db: db!, dbUrl: url, area: command.area, plan, options: command.options, io: { log: io.out, warn: io.err } })
        return result.code
      }, io.err)
    }

    case 'rollback': {
      if (!url) return needDb('reach the app database')
      return withDb(url, async (db) => {
        const result = await runRollback({
          db: db!, dbUrl: url, id: command.id, plans: SWITCH_PLANS, yes: values.yes === true, dryRun: values['dry-run'] === true,
          backupRoot: backupRoot(values, io.env), actor: values.actor || defaultActor(), io: { log: io.out, warn: io.err },
        })
        return result.code
      }, io.err)
    }

    case 'history': {
      if (!url) return needDb('read the switch log')
      return withDb(url, async (db) => {
        if (!(await hasSwitchLog(db!))) { io.err('No switch log in this database (apply the migrations: usertasks-admin db migrate).'); return 1 }
        const records = await listRecords(db!, Number(values.limit ?? 20))
        if (values.json) { io.out(JSON.stringify(records.map((r) => ({ ...r, config_before: undefined, config_after: undefined })), null, 2)); return 0 }
        if (!records.length) io.out('No provider switches yet.')
        for (const r of records) {
          io.out(`${r.id}  ${r.started_at}  ${r.kind.padEnd(8)} ${areaName(r.area).padEnd(9)} ${String(r.from_provider ?? '?')} → ${r.to_provider}  ${r.status}${r.actor ? `  ${r.actor}` : ''}`)
          if (r.error) io.out(`    error: ${r.error}`)
        }
        return 0
      }, io.err)
    }

    case 'instance-admins': {
      if (!url) return needDb('read and write instance settings')
      return withDb(url, async (db) => {
        const rows = await readSettingRows(db!)
        const current = parseAdminEmails(decodeSettings(rows).get(INSTANCE_ADMINS_SETTING))
        const fromEnv = parseAdminEmails(io.env.INSTANCE_ADMIN_EMAILS)
        if (command.action === 'list') {
          for (const e of current) io.out(`${e}  (instance setting)`)
          for (const e of fromEnv) io.out(`${e}  (INSTANCE_ADMIN_EMAILS)`)
          if (!current.length && !fromEnv.length) io.out('No instance admins: nobody can open Settings → Infrastructure.')
          return 0
        }
        const next = command.action === 'add'
          ? [...new Set([...current, ...command.emails])]
          : current.filter((e) => !command.emails.includes(e))
        await upsertSettingRow(db!, encodeSetting(INSTANCE_ADMINS_SETTING, next, false))
        const warning = await notifyConfigChanged(db!, [resolveInstanceConfig(decodeSettings(rows))])
        if (warning) io.err(`warning: ${warning}`)
        io.out(`Instance admins (setting): ${next.join(', ') || 'none'}`)
        return 0
      }, io.err)
    }

    case 'ui-switching': {
      if (!url) return needDb('read and write instance settings')
      return withDb(url, async (db) => {
        const rows = await readSettingRows(db!)
        const gate = () => switchingGate({ flag: io.env.INFRA_UI_SWITCHING, deploymentMode: io.env.DEPLOYMENT_MODE?.trim().toLowerCase() === 'cloud' ? 'cloud' : 'self_hosted', allowSetting: decodeSettings(rows).get(ALLOW_UI_SWITCHING_SETTING) })
        if (command.action !== 'status') {
          await upsertSettingRow(db!, encodeSetting(ALLOW_UI_SWITCHING_SETTING, command.action === 'on', false))
          rows.splice(0, rows.length, ...(await readSettingRows(db!)))
          const warning = await notifyConfigChanged(db!, [resolveInstanceConfig(decodeSettings(rows))])
          if (warning) io.err(`warning: ${warning}`)
        }
        const allowed = decodeSettings(rows).get(ALLOW_UI_SWITCHING_SETTING) === true
        const result = gate()
        io.out(`${ALLOW_UI_SWITCHING_SETTING} = ${allowed}${io.env.INFRA_UI_SWITCHING !== undefined ? ` · INFRA_UI_SWITCHING=${io.env.INFRA_UI_SWITCHING} (this shell)` : ''}`)
        io.out(result.enabled ? 'Provider changes from Settings → Infrastructure: allowed (with this environment).' : `Provider changes from Settings → Infrastructure: off — ${result.reason}`)
        return 0
      }, io.err)
    }

    case 'housekeeping':
      if (!url) return needDb('reach the app database')
      return withDb(url, (db) => runHousekeepingCommand(command.action, command.args, db!, {
        json: values.json, dryRun: values['dry-run'] === true, actor: values.actor || defaultActor(),
      }, io), io.err)

    case 'db':
      return runDb(command.action, command.rest, values, url, io)

    case 'kms':
      if (!url) return needDb('reach the app database')
      return withDb(url, (db) => runKms(command.action, db!, values, io), io.err)

    case 'storage-init':
      return ensureStorageBuckets(io)

    case 'bootstrap':
      // The password may come from the environment instead of argv (process lists).
      return runBootstrap({
        email: values.email ?? '',
        password: values.password ?? io.env.BOOTSTRAP_PASSWORD ?? '',
        org: values.org ?? '',
        name: values.name,
        apiKeyName: values['api-key'],
        ifMissing: values['if-missing'] === true,
      }, io)
  }
}

async function runDb(action: 'migrate' | 'status' | 'repair', rest: string[], values: ParsedValues, url: string | undefined, io: CliIO): Promise<number> {
  if (!url) { io.err('Set DATABASE_URL (or MIGRATION_DATABASE_URL) to the database to migrate.'); return 2 }
  const dir = path.resolve(values.dir || io.env.MIGRATIONS_DIR || 'supabase/migrations')
  const files = loadMigrations(dir)
  const db = await connect(url)
  // Server NOTICEs (skipped optional sections, role fallbacks) are worth seeing.
  db.on('notice', (msg) => {
    if (!/(does not exist|already exists), skipping$/.test(msg.message ?? '')) io.out(`  notice: ${msg.message}`)
  })
  try {
    if (action === 'status') {
      const target = await describeTarget(db, values.owner)
      const rows = computeStatus(files, await readApplied(db))
      io.out(`Database: PostgreSQL ${Math.floor(target.serverVersion / 10000)} as ${target.currentUser}${target.supabase ? ' (Supabase)' : ''}`)
      for (const row of rows) io.out(`  ${row.version}  ${row.state.padEnd(12)}  ${row.name}`)
      const pending = rows.filter((r) => r.state === 'pending' || r.state === 'out_of_order').length
      io.out(pending ? `${pending} migration(s) to apply.` : 'Up to date.')
      return 0
    }
    if (action === 'repair') {
      if (values.status !== 'applied' && values.status !== 'reverted') { io.err('repair needs --status applied|reverted'); return 2 }
      const done = await repair(db, files, { status: values.status, versions: rest })
      io.out(`Marked ${values.status}: ${done.join(', ')}`)
      return 0
    }
    const result = await migrate(db, files, {
      dryRun: values['dry-run'],
      includeAll: values['include-all'],
      owner: values.owner,
      log: (line) => io.out(line),
    })
    for (const w of result.warnings) io.err(`warning: ${w}`)
    const t = result.target
    if (!t.supabase && t.owner !== 'postgres') io.out(`Objects owned by ${t.owner} (the dump's "postgres" ownership statements are pointed at it).`)
    if (values['dry-run']) io.out(result.pending.length ? `Would apply ${result.pending.length}: ${result.pending.join(', ')}` : 'Up to date.')
    else io.out(result.applied.length ? `Applied ${result.applied.length} migration(s).` : 'Up to date.')
    return 0
  } finally {
    await db.end()
  }
}
