import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { checkAddonLicenceText, checkInfrastructureLicenceText as checkLicence } from '@/lib/infrastructure/licence-gate'
import {
  fillSecrets, flagsLayer, formatEnvFile, mergeProfileLayers, parseEnvFile, PRESET_IDS, PRESETS, profileToConfig, redactEnv, redactProfile,
  validateProfile, ProfileInputError, PROFILE_AREAS, type PresetId, type Profile, type ProfileArea, presetProfile,
} from '@/lib/install/profile'
import type { CliIO } from './cli'
import { classifyProfile, describeSeparation, envFingerprint, newSeparation, settingsFingerprint, type SeparatedArea } from '@/lib/install/standard-stack'

/**
 * `usertasks-admin install …`: the install profile (lib/install/profile.ts)
 * for the installers (install.sh / install.ps1, the Windows .msi) and anyone
 * scripting an install. The contract is docs/install-profile.md.
 *
 *   install presets [--format json]
 *   install profile validate [input] [--format text|json]
 *   install profile check    [input] [--area a,b] [--email-to x] [--read-only] [--format text|json]
 *   install profile write    [input] [--format env|json] [--out file] [--merge envfile] [--generate-secrets] [--force]
 *   install profile apply    [input] [--db-url url] [--merge envfile] [--overwrite] [--actor name]
 *
 * input: [--preset <id>] [--from <file.json|->] [--set <path>=<value>]... [--provider <area>=<id>]...
 *        (layers: preset, then the file, then flags). A value written
 *        @env:NAME is read from the environment variable NAME, so secrets
 *        need not appear on the command line (`ps` shows it).
 *
 * Separated profiles (lib/install/standard-stack.ts: anything beyond the
 * bundled single stacks — your own or a managed PostgreSQL, an external
 * bucket, SSO-only sign-in, an email API, …) need an Infrastructure licence:
 * validate, write and apply refuse them unless --licence <file> (or
 * USERTASKS_LICENCE_FILE / USERTASKS_LICENCE) holds a licence for the
 * `infrastructure` extension with the `infrastructure-separation` feature,
 * verified offline (signature against the pinned keyring, dates — it stops 24
 * hours after expiry — and its binding to the install's address). Areas that
 * the running configuration already has (--merge <env file>, or the instance
 * settings for apply) need nothing: an install separated with an earlier
 * release re-runs and upgrades without a licence. apply also installs the
 * licence into the instance (Settings → Licence) so the add-on is licensed.
 *
 * Exit codes: 0 ok · 1 invalid profile / a check failed / licence needed · 2 usage.
 */

export const INSTALL_USAGE = `usertasks-admin install presets [--format json]
usertasks-admin install profile validate|check|write|apply
    [--preset supabase|server|existing|windows] [--from <profile.json>|-]
    [--set <section>.<field>=<value>]... [--provider <area>=<id>]...
  validate  [--format text|json]                       (exit 1 when invalid)
  check     [--area database,email,…] [--email-to <address>] [--read-only] [--format text|json]
  write     [--format env|json] [--out <file>] [--merge <existing env file>] [--generate-secrets] [--force]
  apply     [--db-url <url>] [--merge <env file from write>] [--overwrite] [--actor <name>]   (instance settings, after db migrate)
  --licence <file>   Infrastructure licence: needed for a separated profile (your own PostgreSQL, external storage,
                     SSO-only sign-in, email APIs, …); the bundled single stacks need none. Processing licence: needed
                     for processing.mode: workers (separate processing workers). One file may hold both. Default: USERTASKS_LICENCE_FILE.
Values written @env:NAME are read from the environment.`

const OPTIONS = {
  preset: { type: 'string' },
  from: { type: 'string' },
  set: { type: 'string', multiple: true },
  provider: { type: 'string', multiple: true },
  format: { type: 'string' },
  area: { type: 'string' },
  'email-to': { type: 'string' },
  'read-only': { type: 'boolean' },
  out: { type: 'string' },
  merge: { type: 'string' },
  'generate-secrets': { type: 'boolean' },
  force: { type: 'boolean' },
  'db-url': { type: 'string' },
  overwrite: { type: 'boolean' },
  actor: { type: 'string' },
  'local-root': { type: 'string' },
  licence: { type: 'string' },
  license: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const

class UsageError extends Error {}

function pairs(list: string[] | undefined, flag: string, env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of list ?? []) {
    const eq = item.indexOf('=')
    if (eq < 1) throw new UsageError(`${flag} expects <name>=<value>, got "${item}"`)
    let value = item.slice(eq + 1)
    const ref = /^@env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)
    if (ref) {
      const fromEnv = env[ref[1]]
      if (fromEnv === undefined) throw new UsageError(`${flag} ${item.slice(0, eq)}: environment variable ${ref[1]} is not set`)
      value = fromEnv
    }
    out[item.slice(0, eq).trim()] = value
  }
  return out
}

type Values = ReturnType<typeof parse>['values']
function parse(argv: string[]) {
  return parseArgs({ args: argv, allowPositionals: true, strict: true, options: OPTIONS })
}

/** Preset → file → flags, merged (not yet validated). */
export function profileInput(values: Values, io: Pick<CliIO, 'env'>, readStdin: () => string = () => readFileSync(0, 'utf8')): Record<string, unknown> {
  let file: Record<string, unknown> | undefined
  if (values.from) {
    const text = values.from === '-' ? readStdin() : readFileSync(path.resolve(values.from), 'utf8')
    try {
      const parsed = JSON.parse(text) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      file = parsed as Record<string, unknown>
    } catch (error) {
      throw new UsageError(`--from ${values.from}: not a JSON profile (${(error as Error).message})`)
    }
  }
  const presetName = values.preset ?? (typeof file?.preset === 'string' ? file.preset : undefined)
  if (presetName && !(PRESET_IDS as readonly string[]).includes(presetName)) throw new UsageError(`Unknown preset "${presetName}" (${PRESET_IDS.join(', ')})`)
  const preset = presetName ? presetProfile(presetName as PresetId, { localRoot: values['local-root'] }) : undefined
  let flags: Record<string, unknown>
  try {
    flags = flagsLayer(pairs(values.set, '--set', io.env), pairs(values.provider, '--provider', io.env))
  } catch (error) {
    if (error instanceof ProfileInputError) throw new UsageError(error.message)
    throw error
  }
  return mergeProfileLayers(preset, file, flags)
}

function printIssues(io: CliIO, label: string, issues: Array<{ path: string; message: string }>, to: 'out' | 'err'): void {
  if (!issues.length) return
  io[to](`${label}:`)
  for (const issue of issues) io[to](`  ${issue.path}: ${issue.message}`)
}

const MARK: Record<string, string> = { ok: 'ok', warn: 'WARN', fail: 'FAIL', skip: 'info' }

export async function runInstallCommand(argv: string[], io: CliIO): Promise<number> {
  let values: Values
  let positionals: string[]
  try {
    ({ values, positionals } = parse(argv))
  } catch (error) {
    io.err((error as Error).message)
    io.err('Run `usertasks-admin install --help` for usage.')
    return 2
  }
  const [noun, verb, ...rest] = positionals
  if (values.help || !noun) { io.out(INSTALL_USAGE); return 0 }
  try {
    if (rest.length) throw new UsageError(`Unexpected argument: ${rest[0]}`)
    if (noun === 'presets') {
      if (verb) throw new UsageError(`Unexpected argument: ${verb}`)
      const list = PRESET_IDS.map((id) => ({ ...PRESETS[id], profile: presetProfile(id, { localRoot: values['local-root'] }) }))
      if (values.format === 'json') io.out(JSON.stringify(list, null, 2))
      else for (const p of list) io.out(`${p.id.padEnd(10)} ${p.label}\n${''.padEnd(10)} ${p.description}\n${''.padEnd(10)} needs: ${p.asks.join(', ')}`)
      return 0
    }
    if (noun !== 'profile') throw new UsageError(`Unknown command: install ${noun}`)
    if (!['validate', 'check', 'write', 'apply'].includes(verb ?? '')) throw new UsageError(verb ? `Unknown command: install profile ${verb}` : 'install profile needs a command: validate, check, write or apply')
    const format = values.format ?? (verb === 'write' ? 'env' : 'text')
    const allowed = verb === 'write' ? ['env', 'json'] : ['text', 'json']
    if (!allowed.includes(format)) throw new UsageError(`--format must be ${allowed.join(' or ')} for ${verb}`)

    const input = profileInput(values, io)
    const result = validateProfile(input)
    if (!result.ok) {
      if (format === 'json') io.out(JSON.stringify({ ok: false, errors: result.errors, warnings: result.warnings }, null, 2))
      else { printIssues(io, 'The profile is not valid', result.errors, 'err'); printIssues(io, 'Warnings', result.warnings, 'err') }
      return 1
    }
    const { profile, warnings } = result

    // The Infrastructure add-on boundary: new separation needs a licence (check runs only the connection tests).
    if (verb !== 'check') {
      // apply: the key that encrypts credentials is known before anything reads instance settings
      // (the key is read once per process: reading a stored secret first would leave it unset).
      if (verb === 'apply') primeEncryptionKey(profile, values)
      const existing = verb === 'apply' ? await runningSettingsFingerprints(values, profile, io) : envFingerprints(values)
      let gate = separationGate(profile, existing, values, io)
      // A re-run (--merge): what a profile places in instance settings (the presets' files, sign-in, email, …)
      // is not in the env file, so ask the running instance before refusing what it already runs.
      if (!gate.ok && verb !== 'apply' && values.merge) gate = separationGate(profile, await runningSettingsFingerprints(values, profile, io), values, io)
      if (!gate.ok) {
        if (format === 'json') io.out(JSON.stringify({ ok: false, code: 'licence_required', separated: gate.separated, error: gate.error }, null, 2))
        else io.err(gate.error)
        return 1
      }
      if (gate.note) io.err(gate.note)
      // The Processing add-on boundary: separate processing workers need its licence.
      const pgate = processingGate(profile, values, io)
      if (!pgate.ok) {
        if (format === 'json') io.out(JSON.stringify({ ok: false, code: 'licence_required', addon: 'processing', error: pgate.error }, null, 2))
        else io.err(pgate.error)
        return 1
      }
      if (pgate.note) io.err(pgate.note)
      if (verb === 'apply') {
        for (const text of new Set([gate.licenceText, pgate.licenceText].filter((t): t is string => Boolean(t)))) {
          const installed = await installLicence(text, values, profile, io)
          if (installed !== 0) return installed
        }
      }
    }

    switch (verb) {
      case 'validate': {
        const config = profileToConfig(profile)
        if (format === 'json') {
          io.out(JSON.stringify({
            ok: true, warnings, profile: redactProfile(profile), env: redactEnv(config),
            settings: config.settings.map((s) => ({ ...s, value: s.secret ? '********' : s.value })), notes: config.notes,
          }, null, 2))
        } else {
          io.out('The profile is valid.')
          for (const area of PROFILE_AREAS) io.out(`  ${area.padEnd(10)} ${describe(profile, area)}`)
          printIssues(io, 'Warnings', warnings, 'out')
          if (config.notes.length) { io.out('Next steps:'); for (const n of config.notes) io.out(`  - ${n}`) }
        }
        return 0
      }
      case 'check': {
        const areas = (values.area ?? '').split(',').map((a) => a.trim()).filter(Boolean)
        for (const a of areas) if (a !== 'supabase' && !(PROFILE_AREAS as readonly string[]).includes(a)) throw new UsageError(`Unknown area "${a}"`)
        const { checkProfile } = await import('@/lib/install/checks')
        const report = await checkProfile(profile, { areas: areas as Array<ProfileArea | 'supabase'>, emailTo: values['email-to'], readOnly: values['read-only'] === true })
        if (format === 'json') io.out(JSON.stringify({ ...report, warnings }, null, 2))
        else {
          let area: string | null = null
          for (const c of report.checks) {
            if (c.area !== area) { area = c.area; io.out(area) }
            io.out(`  [${MARK[c.status].padEnd(4)}] ${c.name.padEnd(14)} ${c.detail}`)
          }
          io.out(report.ok ? 'All checks passed.' : 'Some checks failed.')
        }
        return report.ok ? 0 : 1
      }
      case 'write':
        return write(profile, values, format as 'env' | 'json', io)
      case 'apply':
        return apply(profile, values, io)
    }
    return 2
  } catch (error) {
    if (error instanceof UsageError) { io.err(error.message); io.err('Run `usertasks-admin install --help` for usage.'); return 2 }
    throw error
  }
}

function describe(profile: Profile, area: ProfileArea): string {
  const block = profile[area] as { provider: string; hosting?: string }
  const where = profile.placement === 'settings' && ['auth', 'storage', 'email', 'scheduler', 'cache'].includes(area) ? 'instance settings' : 'environment'
  return `${block.provider}${block.hosting ? ` (${block.hosting})` : ''} · ${where}`
}

function write(input: Profile, values: Values, format: 'env' | 'json', io: CliIO): number {
  const out = values.out ? path.resolve(values.out) : null
  // Existing secrets always win: an installer re-run must never replace ENCRYPTION_KEY.
  const mergeFrom = values.merge ? path.resolve(values.merge) : out && existsSync(out) && !values.force ? out : null
  if (values.merge && !existsSync(mergeFrom!)) throw new UsageError(`--merge ${values.merge}: file not found`)
  const existing = mergeFrom && format === 'env' ? parseEnvFile(readFileSync(mergeFrom, 'utf8')) : mergeFrom ? envFromJson(readFileSync(mergeFrom, 'utf8')) : {}
  if (out && existsSync(out) && values.force && existing.ENCRYPTION_KEY === undefined) {
    const current = format === 'env' ? parseEnvFile(readFileSync(out, 'utf8')) : envFromJson(readFileSync(out, 'utf8'))
    if (current.ENCRYPTION_KEY && current.ENCRYPTION_KEY !== input.app.encryptionKey) {
      throw new UsageError(`${out} has a different ENCRYPTION_KEY: replacing it would make every stored credential unreadable. Pass --merge ${values.out} to keep it.`)
    }
  }
  const { profile, generated, kept } = fillSecrets(input, existing, { generate: values['generate-secrets'] === true })
  const config = profileToConfig(profile)
  const text = format === 'env'
    ? formatEnvFile(config.env, `UserTasks configuration written by usertasks-admin install profile write (${new Date().toISOString()}).\nKeep this file private: it holds credentials.`)
    : `${JSON.stringify({ env: config.env, settings: config.settings, secretKeys: config.secretKeys, notes: config.notes, generated, kept }, null, 2)}\n`
  if (out) {
    writeFileSync(out, text, { mode: 0o600 })
    try { chmodSync(out, 0o600) } catch { /* Windows: ACLs are the installer's job */ }
    io.err(`Wrote ${out}${generated.length ? ` (generated ${generated.join(', ')})` : ''}${kept.length ? ` (kept existing ${kept.join(', ')})` : ''}`)
  } else {
    io.out(text.trimEnd())
    if (generated.length) io.err(`Generated ${generated.join(', ')}: save the output, they are not stored anywhere else.`)
  }
  for (const note of config.notes) io.err(`note: ${note}`)
  return 0
}

function envFromJson(text: string): Record<string, string> {
  try {
    const parsed = JSON.parse(text) as { env?: Record<string, string> }
    return parsed.env ?? {}
  } catch {
    return {}
  }
}

/** ENCRYPTION_KEY for `apply` from the profile or the merged env file, when the environment has none (a fresh install). */
function primeEncryptionKey(input: Profile, values: Values): void {
  if (process.env.ENCRYPTION_KEY) return
  const existing = values.merge && existsSync(path.resolve(values.merge)) ? parseEnvFile(readFileSync(path.resolve(values.merge), 'utf8')) : {}
  const { profile } = fillSecrets(input, existing, { generate: false })
  if (profile.app.encryptionKey) process.env.ENCRYPTION_KEY = profile.app.encryptionKey
}

async function apply(input: Profile, values: Values, io: CliIO): Promise<number> {
  // The env file `write` produced (--merge) supplies ENCRYPTION_KEY and the database URL when the profile doesn't.
  const existing = values.merge ? parseEnvFile(readFileSync(path.resolve(values.merge), 'utf8')) : {}
  const { profile } = fillSecrets(input, existing, { generate: false })
  const config = profileToConfig(profile)
  if (!config.settings.length) { io.out('Nothing to apply: this profile keeps everything in the environment (placement "env").'); return 0 }
  const url = values['db-url'] || io.env.MIGRATION_DATABASE_URL || io.env.DATABASE_URL || config.env.MIGRATION_DATABASE_URL || config.env.DATABASE_URL
  if (!url) { io.err('Set DATABASE_URL (or --db-url): apply writes instance settings into the app database.'); return 2 }
  const { applyProfileSettings } = await import('@/lib/install/apply')
  const { connect, defaultActor } = await import('./instance')
  // Credentials are encrypted with the profile's ENCRYPTION_KEY when the environment has none (a fresh install).
  if (!process.env.ENCRYPTION_KEY && profile.app.encryptionKey) process.env.ENCRYPTION_KEY = profile.app.encryptionKey
  let db: Awaited<ReturnType<typeof connect>>
  try {
    db = await connect(url)
  } catch (error) {
    io.err(`Can't connect to the database: ${(error as Error).message}`)
    return 1
  }
  try {
    const result = await applyProfileSettings(db, config.settings, { overwrite: values.overwrite === true, actor: values.actor || defaultActor() })
    for (const key of result.written) io.out(`set ${key}`)
    for (const key of result.skipped) io.out(`kept ${key} (already set; --overwrite replaces it)`)
    if (result.warning) io.err(`warning: ${result.warning}`)
    io.out(`Applied ${result.written.length} setting${result.written.length === 1 ? '' : 's'}${result.skipped.length ? `, kept ${result.skipped.length}` : ''}.`)
    return 0
  } catch (error) {
    io.err((error as Error).message)
    return 1
  } finally {
    await db.end().catch(() => undefined)
  }
}

// ── Infrastructure licence (separated profiles) ─────────────────────────────

function licenceTextFrom(values: Values, env: Record<string, string | undefined>): { text: string | null; source: string | null } {
  const file = values.licence || values.license || env.USERTASKS_LICENCE_FILE || env.USERTASKS_LICENSE_FILE
  if (file) {
    const resolved = path.resolve(file)
    if (!existsSync(resolved)) throw new UsageError(`--licence ${file}: file not found`)
    return { text: readFileSync(resolved, 'utf8'), source: resolved }
  }
  const inline = env.USERTASKS_LICENCE || env.USERTASKS_LICENSE
  return inline ? { text: inline, source: 'USERTASKS_LICENCE' } : { text: null, source: null }
}

/** Fingerprints of the env file being merged (an install being re-run). */
function envFingerprints(values: Values): (area: ProfileArea) => string | null {
  if (!values.merge || !existsSync(path.resolve(values.merge))) return () => null
  const env = parseEnvFile(readFileSync(path.resolve(values.merge), 'utf8'))
  return (area) => envFingerprint(area, env)
}

/** apply (and a write / validate re-run): what the instance runs now (its settings, then the merged env file). */
async function runningSettingsFingerprints(values: Values, profile: Profile, io: CliIO): Promise<(area: ProfileArea) => string | null> {
  const fromEnv = envFingerprints(values)
  const existing = values.merge ? parseEnvFile(readFileSync(path.resolve(values.merge), 'utf8')) : {}
  const url = values['db-url'] || io.env.MIGRATION_DATABASE_URL || io.env.DATABASE_URL || existing.MIGRATION_DATABASE_URL || existing.DATABASE_URL
  if (!url) return fromEnv
  try {
    const { connect, decodeSettings, readSettingRows } = await import('./instance')
    const db = await connect(url)
    try {
      // Providers and endpoints only: secret rows are not decrypted here (that would read ENCRYPTION_KEY
      // before `apply` sets it from the merged env file, and the key is cached for the process).
      const settings = decodeSettings((await readSettingRows(db)).filter((row) => !row.secret))
      return (area) => settingsFingerprint(area, settings) ?? fromEnv(area)
    } finally {
      await db.end().catch(() => undefined)
    }
  } catch {
    void profile
    return fromEnv
  }
}

export interface SeparationGate {
  ok: boolean
  separated: SeparatedArea[]
  error: string
  note: string | null
  licenceText: string | null
}

/** Refuse new separation without a valid Infrastructure licence (offline check). */
export function separationGate(profile: Profile, existing: (area: ProfileArea) => string | null, values: Values, io: { env: Record<string, string | undefined> }, now = new Date(), keyring?: Parameters<typeof checkLicence>[1]['keyring']): SeparationGate {
  const classification = classifyProfile(profile)
  const added = newSeparation(classification, existing)
  if (!added.length) {
    const kept = classification.separated.length ? `note: separated areas already configured here are kept (${describeSeparation(classification.separated)}); changing them later needs the Infrastructure add-on.` : null
    return { ok: true, separated: [], error: '', note: kept, licenceText: null }
  }
  const { text, source } = licenceTextFrom(values, io.env)
  const what = describeSeparation(added)
  if (!text) {
    return {
      ok: false, separated: added, note: null, licenceText: null,
      error: `This profile moves services off the standard stack: ${what}. That needs the Infrastructure add-on (a paid extension): pass --licence <your .licence file> (or set USERTASKS_LICENCE_FILE). Without a licence, install the bundled stack (PostgreSQL, files, sign-in and worker installed with UserTasks) or a Supabase project.`,
    }
  }
  const check = checkLicence(text, { appUrl: profile.app.url, now, keyring })
  if (!check.ok) return { ok: false, separated: added, note: null, licenceText: null, error: `This profile moves services off the standard stack (${what}), and the Infrastructure licence ${source ? `from ${source} ` : ''}was not accepted: ${check.reason ?? 'not licensed'}` }
  return { ok: true, separated: added, error: '', licenceText: text, note: `Infrastructure licence ${check.licenceId ?? ''}${check.customer ? ` (${check.customer})` : ''} accepted for: ${what}.${check.reason ? ` ${check.reason}` : ''}` }
}

export interface ProcessingGate {
  ok: boolean
  error: string
  note: string | null
  licenceText: string | null
}

/**
 * Refuse `processing.mode: workers` without a valid Processing licence
 * (offline check: signature against the pinned keyring, dates — it stops 24
 * hours after expiry — extension `processing`, feature `processing`,
 * binding). A re-run whose merged env already has PROCESSING_MODE=workers
 * keeps it without a licence check (nothing new is turned on). The same
 * --licence file may hold several add-ons.
 */
export function processingGate(profile: Profile, values: Values, io: { env: Record<string, string | undefined> }, now = new Date(), keyring?: Parameters<typeof checkLicence>[1]['keyring']): ProcessingGate {
  if (profile.processing?.mode !== 'workers') return { ok: true, error: '', note: null, licenceText: null }
  const merged = values.merge && existsSync(path.resolve(values.merge)) ? parseEnvFile(readFileSync(path.resolve(values.merge), 'utf8')) : {}
  if ((merged.PROCESSING_MODE ?? '').trim().toLowerCase() === 'workers') {
    return { ok: true, error: '', note: 'note: separate processing workers are already configured here (PROCESSING_MODE=workers) and are kept.', licenceText: null }
  }
  const { text, source } = licenceTextFrom(values, io.env)
  if (!text) {
    return { ok: false, note: null, licenceText: null, error: 'This profile runs processing on separate workers (processing.mode: workers). That needs the Processing add-on (a paid extension): pass --licence <your .licence file> (or set USERTASKS_LICENCE_FILE). Without a licence, leave processing out: the web app processes queued work (free).' }
  }
  const check = checkAddonLicenceText(text, { appUrl: profile.app.url, now, keyring, extensionId: 'processing', feature: 'processing', addonName: 'Processing' })
  if (!check.ok) return { ok: false, note: null, licenceText: null, error: `This profile runs processing on separate workers, and the Processing licence ${source ? `from ${source} ` : ''}was not accepted: ${check.reason ?? 'not licensed'}` }
  return { ok: true, error: '', licenceText: text, note: `Processing licence ${check.licenceId ?? ''}${check.customer ? ` (${check.customer})` : ''} accepted: separate processing workers.${check.reason ? ` ${check.reason}` : ''}` }
}

/** apply --licence: store the licence in the instance (Settings → Licence) as `usertasks-admin licence install` does. */
async function installLicence(text: string, values: Values, profile: Profile, io: CliIO): Promise<number> {
  const existing = values.merge ? parseEnvFile(readFileSync(path.resolve(values.merge), 'utf8')) : {}
  const url = values['db-url'] || io.env.MIGRATION_DATABASE_URL || io.env.DATABASE_URL || existing.MIGRATION_DATABASE_URL || existing.DATABASE_URL
  if (!url) return 0 // nothing to install into yet: `apply` reports the missing connection itself
  const [{ connect, defaultActor }, { runLicence, sqlLicenceStore }] = await Promise.all([import('./instance'), import('./licence-cli')])
  let db: Awaited<ReturnType<typeof connect>>
  try {
    db = await connect(url)
  } catch (error) {
    io.err(`Can't connect to the database to install the licence: ${(error as Error).message}`)
    return 1
  }
  try {
    // The licence is bound to the install's address: the profile's, when this process has no APP_URL (the installers).
    const env = { ...io.env, APP_URL: io.env.APP_URL || io.env.NEXT_PUBLIC_APP_URL || profile.app.url }
    const code = await runLicence('install', ['-'], { actor: values.actor || defaultActor() }, sqlLicenceStore(db), { ...io, out: io.out, env }, { readFile: async () => text })
    if (code !== 0) io.err('The licence could not be installed in the instance (see above): install it later with usertasks-admin licence install <file>.')
    return 0
  } finally {
    await db.end().catch(() => undefined)
  }
}
