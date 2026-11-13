import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { resolveInstanceConfig } from '@/lib/config'
import { checkInstallable, activationRequest } from '@/lib/licensing/install'
import { generateInstanceId, INSTANCE_ID_SETTING, instanceHostnames } from '@/lib/licensing/instance'
import { envLicences, LICENCES_SETTING, mergeLicence, removeLicence, storedLicences, type RawLicence } from '@/lib/licensing/store'
import { licenceWarnings, summarise, verifyLicence, type LicenceSummary } from '@/lib/licensing/service'
import { LICENCE_KEYRING, type LicenceKey } from '@/lib/licensing/keyring'
import type { InstanceIdentity, TenantEntitlementRow } from '@/lib/licensing/types'
import { apiData, apiOf, isMissingObject } from '@/lib/admin/ops/service-sql'
import { decodeSettings, encodeSetting, notifyConfigChanged, readSettingRows, upsertSettingRow, type SqlClient } from './instance'

/**
 * usertasks-admin licence status [--json] | install <file> | remove <licence-id> | remove --all | request [--out <file>] [--json]
 * usertasks-admin entitlements list [--tenant <id>] [--ext <id>] [--json]
 *                 grant --tenant <id> --ext <id> [--until <ISO date>] [--features a,b] [--limits key=n,…]
 *                 revoke --tenant <id> --ext <id>
 *
 * Licences live in instance_settings (`instance.licences`); the app picks a
 * change up within a minute (or at once with a shared cache store). The same
 * verifier as the app checks signature, key id, binding and dates.
 */

export type LicenceAction = 'status' | 'install' | 'remove' | 'request'
export type EntitlementsAction = 'list' | 'grant' | 'revoke'

export interface LicenceIO {
  out: (line: string) => void
  err: (line: string) => void
  env: NodeJS.ProcessEnv
}

export interface LicenceCliStore {
  readSetting: (key: string) => Promise<unknown>
  writeSetting: (key: string, value: unknown, actor: string) => Promise<void>
  /** Read instance.id, creating it once when absent. */
  ensureInstanceId: () => Promise<string | null>
  listEntitlements: (filter: { tenantId?: string; extensionId?: string }) => Promise<TenantEntitlementRow[]>
  upsertEntitlement: (row: TenantEntitlementRow) => Promise<void>
  deleteEntitlement: (tenantId: string, extensionId: string) => Promise<boolean>
  recordEvent: (event: { event: string; licence_id?: string | null; extension_id?: string | null; tenant_id?: string | null; actor: string; summary: string; detail?: Record<string, unknown> }) => Promise<void>
}

export interface LicenceCliDeps {
  now?: () => Date
  keyring?: readonly LicenceKey[]
  readFile?: (file: string) => Promise<string>
  writeFile?: (file: string, text: string) => Promise<void>
}

/** The store over the CLI's connection (direct pg, or the Supabase service-role API). */
export function sqlLicenceStore(db: SqlClient): LicenceCliStore {
  const api = apiOf(db)
  return {
    readSetting: async (key) => decodeSettings(await readSettingRows(db)).get(key),
    writeSetting: async (key, value, actor) => {
      await upsertSettingRow(db, encodeSetting(key, value, false))
      await notifyConfigChanged(db, [resolveInstanceConfig(decodeSettings(await readSettingRows(db)))]).catch(() => null)
      void actor
    },
    ensureInstanceId: async () => {
      const read = async () => decodeSettings(await readSettingRows(db)).get(INSTANCE_ID_SETTING)
      const existing = await read()
      if (typeof existing === 'string' && existing) return existing
      const id = generateInstanceId()
      if (api) {
        await apiData(api.from('instance_settings').upsert({ key: INSTANCE_ID_SETTING, value: id, secret: false, updated_at: new Date().toISOString() }, { onConflict: 'key', ignoreDuplicates: true }))
      } else {
        await db.query(`INSERT INTO public.instance_settings (key, value, secret, updated_at) VALUES ($1, $2::jsonb, false, now()) ON CONFLICT (key) DO NOTHING`, [INSTANCE_ID_SETTING, JSON.stringify(id)])
      }
      const winner = await read()
      return typeof winner === 'string' && winner ? winner : null
    },
    listEntitlements: async (filter) => {
      if (api) {
        let q = api.from('tenant_entitlements').select('*').order('created_at', { ascending: false }).limit(500)
        if (filter.tenantId) q = q.eq('tenant_id', filter.tenantId)
        if (filter.extensionId) q = q.eq('extension_id', filter.extensionId)
        return (await apiData<TenantEntitlementRow[]>(q)) ?? []
      }
      const where: string[] = []
      const values: unknown[] = []
      if (filter.tenantId) { values.push(filter.tenantId); where.push(`tenant_id = $${values.length}`) }
      if (filter.extensionId) { values.push(filter.extensionId); where.push(`extension_id = $${values.length}`) }
      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT id::text, tenant_id::text, extension_id, edition, features, limits, status, source, starts_at, ends_at, notes, created_at, updated_at
           FROM public.tenant_entitlements ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 500`, values)
      return rows.map((r) => ({ ...r, starts_at: iso(r.starts_at), ends_at: iso(r.ends_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at) })) as unknown as TenantEntitlementRow[]
    },
    upsertEntitlement: async (row) => {
      const record = { ...row, updated_at: new Date().toISOString() }
      if (api) {
        await apiData(api.from('tenant_entitlements').upsert(record, { onConflict: 'tenant_id,extension_id' }))
        return
      }
      await db.query(
        `INSERT INTO public.tenant_entitlements (tenant_id, extension_id, edition, features, limits, status, source, starts_at, ends_at, notes, updated_at)
         VALUES ($1, $2, $3, $4::text[], $5::jsonb, $6, $7, $8, $9, $10, now())
         ON CONFLICT (tenant_id, extension_id) DO UPDATE SET edition = EXCLUDED.edition, features = EXCLUDED.features, limits = EXCLUDED.limits,
           status = EXCLUDED.status, source = EXCLUDED.source, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, notes = EXCLUDED.notes, updated_at = now()`,
        [row.tenant_id, row.extension_id, row.edition ?? null, row.features ?? [], JSON.stringify(row.limits ?? {}), row.status, row.source, row.starts_at ?? null, row.ends_at ?? null, row.notes ?? null],
      )
    },
    deleteEntitlement: async (tenantId, extensionId) => {
      if (api) {
        const data = await apiData<unknown[]>(api.from('tenant_entitlements').delete().eq('tenant_id', tenantId).eq('extension_id', extensionId).select('id'))
        return Array.isArray(data) && data.length > 0
      }
      const result = await db.query('DELETE FROM public.tenant_entitlements WHERE tenant_id = $1 AND extension_id = $2', [tenantId, extensionId])
      return (result.rowCount ?? 0) > 0
    },
    recordEvent: async (e) => {
      try {
        if (api) {
          const { error } = await api.from('licence_events').insert({ ...e, detail: e.detail ?? {} })
          if (error && !isMissingObject(error)) throw new Error(error.message)
          return
        }
        await db.query(
          `INSERT INTO public.licence_events (event, licence_id, extension_id, tenant_id, actor, summary, detail) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [e.event, e.licence_id ?? null, e.extension_id ?? null, e.tenant_id ?? null, e.actor, e.summary, JSON.stringify(e.detail ?? {})],
        )
      } catch {
        // licence_events missing (migration 20270112000100 not applied): the change itself stands.
      }
    },
  }
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function day(value: string | null): string {
  return value ? value.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC') : '-'
}

async function identityOf(store: LicenceCliStore, env: NodeJS.ProcessEnv): Promise<InstanceIdentity> {
  return { instanceId: await store.ensureInstanceId(), hostnames: instanceHostnames(env.APP_URL || env.NEXT_PUBLIC_APP_URL) }
}

function printLicence(io: LicenceIO, l: LicenceSummary): void {
  const state = !l.valid ? 'INVALID' : l.timeState === 'cutoff_pending' ? 'EXPIRED (stops within 24 h)' : (l.timeState ?? '?').toUpperCase().replace('_', ' ')
  io.out(`${l.licenceId ?? '(unreadable)'}  ${state}  [${l.source}]`)
  if (l.customer) io.out(`  customer      ${l.customer}${l.trial ? ' (trial)' : ''}`)
  if (l.expiresAt) io.out(`  expires       ${day(l.expiresAt)}${l.daysLeft !== null && l.daysLeft >= 0 ? ` (${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'})` : ''}`)
  if (l.cutoffAt) io.out(`  stops at      ${day(l.cutoffAt)} (expiry + 24 h)`)
  if (l.updatesUntil) io.out(`  updates until ${l.updatesUntil}`)
  if (l.bound.instanceIds.length || l.bound.hostnames.length) io.out(`  bound to      ${[...l.bound.instanceIds, ...l.bound.hostnames].join(', ')}`)
  for (const e of l.extensions) io.out(`  extension     ${e.id}${e.edition ? ` (${e.edition})` : ''}: ${e.features?.length ? e.features.join(', ') : 'all features'}`)
  for (const [k, v] of Object.entries(l.limits)) io.out(`  limit         ${k} = ${v}`)
  for (const p of l.problems) io.out(`  problem       ${p.code}: ${p.message}`)
}

export async function runLicence(action: LicenceAction, args: string[], values: { json?: boolean; all?: boolean; out?: string; actor: string }, store: LicenceCliStore, io: LicenceIO, deps: LicenceCliDeps = {}): Promise<number> {
  const now = (deps.now ?? (() => new Date()))()
  const keyring = deps.keyring ?? LICENCE_KEYRING
  const identity = await identityOf(store, io.env)

  if (action === 'status') {
    const raw: RawLicence[] = [
      ...storedLicences(await store.readSetting(LICENCES_SETTING)).map((r) => ({ source: 'setting' as const, raw: r })),
      ...await envLicences({ env: io.env }),
    ]
    const verified = raw.map((r) => verifyLicence(r, identity, now, keyring))
    const licences = verified.map(summarise)
    const warnings = licenceWarnings(verified)
    if (values.json) {
      io.out(JSON.stringify({ instance: identity, now: now.toISOString(), licences, warnings }, null, 2))
      return 0
    }
    io.out(`Instance id: ${identity.instanceId ?? '(none: instance_settings unavailable)'}`)
    io.out(`Hostnames:   ${identity.hostnames.join(', ') || '(APP_URL not set in this environment)'}`)
    if (!licences.length) io.out('No licence installed: paid extensions are available but not licensed (usertasks-admin licence install <file>).')
    for (const l of licences) printLicence(io, l)
    for (const w of warnings) io.out(`${w.level === 'error' ? 'ERROR' : w.level === 'warn' ? 'WARN' : 'info'} ${w.message}`)
    return warnings.some((w) => w.level === 'error') ? 1 : 0
  }

  if (action === 'install') {
    const file = args[0]
    if (!file) { io.err('licence install needs the licence file'); return 2 }
    let text: string
    try {
      text = await (deps.readFile ?? ((f: string) => readFile(f, 'utf8')))(path.resolve(file))
    } catch (error) {
      io.err(`Cannot read ${file}: ${(error as Error).message}`)
      return 1
    }
    const check = checkInstallable(text, identity, now, keyring)
    if (!check.ok || !check.licence || !check.summary) {
      io.err(`Licence not installed: ${check.problems.map((p) => p.message).join('; ')}`)
      return 1
    }
    const { next, replaced } = mergeLicence(storedLicences(await store.readSetting(LICENCES_SETTING)), check.licence)
    await store.writeSetting(LICENCES_SETTING, next, values.actor)
    await store.recordEvent({
      event: replaced ? 'replaced' : 'installed', licence_id: check.licence.licence_id, actor: values.actor,
      summary: `${replaced ? 'Replaced' : 'Installed'} licence ${check.licence.licence_id} (usertasks-admin)`,
      detail: { expires_at: check.licence.expires_at, extensions: check.licence.extensions.map((e) => e.id), kid: check.licence.kid },
    })
    io.out(`${replaced ? 'Replaced' : 'Installed'} licence ${check.licence.licence_id}.`)
    printLicence(io, check.summary)
    for (const note of check.notes) io.out(`note: ${note}`)
    io.out('Running app processes pick it up within a minute.')
    return 0
  }

  if (action === 'remove') {
    const id = args[0]
    if (!id && !values.all) { io.err('licence remove needs a licence id (see licence status), or --all'); return 2 }
    const { next, removed } = removeLicence(storedLicences(await store.readSetting(LICENCES_SETTING)), id ?? null)
    if (!removed.length) {
      io.err(id ? `No installed licence ${id}. (Licences from USERTASKS_LICENCE / USERTASKS_LICENCE_FILE are removed by unsetting the variable.)` : 'No licences installed.')
      return 1
    }
    await store.writeSetting(LICENCES_SETTING, next, values.actor)
    for (const r of removed) await store.recordEvent({ event: 'removed', licence_id: r, actor: values.actor, summary: `Removed licence ${r} (usertasks-admin)` })
    io.out(`Removed: ${removed.join(', ')}`)
    return 0
  }

  // request
  const installed = storedLicences(await store.readSetting(LICENCES_SETTING))
    .map((l) => (l && typeof l === 'object' ? String((l as { licence_id?: unknown }).licence_id ?? '') : ''))
    .filter(Boolean)
  const request = activationRequest({
    identity,
    installed,
    now,
    deploymentMode: io.env.DEPLOYMENT_MODE?.trim().toLowerCase() === 'cloud' ? 'cloud' : 'self_hosted',
  })
  const text = `${JSON.stringify(request, null, 2)}\n`
  if (values.json && !values.out) { io.out(text.trimEnd()); return 0 }
  const target = path.resolve(values.out || `usertasks-licence-request${identity.instanceId ? `-${identity.instanceId}` : ''}.json`)
  await (deps.writeFile ?? ((f: string, t: string) => writeFile(f, t, { mode: 0o644 })))(target, text)
  io.out(`Activation request written to ${target}`)
  io.out('Upload it to the licensing portal from any connected machine, then: usertasks-admin licence install <the licence file>')
  return 0
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseLimits(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of (raw ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const eq = part.indexOf('=')
    const key = part.slice(0, eq).trim()
    const value = Number(part.slice(eq + 1))
    if (eq < 1 || !key || !Number.isFinite(value) || value < 0) throw new Error(`--limits expects key=number[,key=number], got "${part}"`)
    out[key] = value
  }
  return out
}

export async function runEntitlements(action: EntitlementsAction, values: { json?: boolean; tenant?: string; ext?: string; until?: string; features?: string; limits?: string; actor: string }, store: LicenceCliStore, io: LicenceIO): Promise<number> {
  if (values.tenant && !UUID.test(values.tenant)) { io.err('--tenant must be a workspace id (UUID)'); return 2 }
  if (action === 'list') {
    const rows = await store.listEntitlements({ tenantId: values.tenant, extensionId: values.ext })
    if (values.json) { io.out(JSON.stringify(rows, null, 2)); return 0 }
    if (!rows.length) io.out('No workspace entitlements.')
    for (const r of rows) {
      io.out(`${r.tenant_id}  ${r.extension_id.padEnd(14)} ${r.status.padEnd(9)} ${r.source.padEnd(7)} until ${r.ends_at ? day(r.ends_at) : 'no end'}${Object.keys(r.limits ?? {}).length ? `  limits ${JSON.stringify(r.limits)}` : ''}${r.features?.length ? `  features ${r.features.join(',')}` : ''}`)
    }
    return 0
  }
  if (!values.tenant || !values.ext) { io.err(`entitlements ${action} needs --tenant <workspace id> and --ext <extension id>`); return 2 }
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(values.ext)) { io.err('--ext must be an extension id (lowercase a-z, 0-9, hyphens)'); return 2 }
  if (action === 'revoke') {
    const deleted = await store.deleteEntitlement(values.tenant, values.ext)
    if (!deleted) { io.err(`No ${values.ext} entitlement for workspace ${values.tenant}`); return 1 }
    await store.recordEvent({ event: 'entitlement_revoked', extension_id: values.ext, tenant_id: values.tenant, actor: values.actor, summary: `Entitlement ${values.ext} removed (usertasks-admin)` })
    io.out(`Removed the ${values.ext} entitlement of ${values.tenant}. Running app processes see it within a minute.`)
    return 0
  }
  let limits: Record<string, number>
  try { limits = parseLimits(values.limits) } catch (error) { io.err((error as Error).message); return 2 }
  if (values.until && Number.isNaN(Date.parse(values.until))) { io.err('--until must be a date (ISO 8601, e.g. 2027-12-31T00:00:00Z)'); return 2 }
  const row: TenantEntitlementRow = {
    tenant_id: values.tenant,
    extension_id: values.ext,
    features: (values.features ?? '').split(',').map((f) => f.trim()).filter(Boolean),
    limits,
    status: 'active',
    source: 'admin',
    ends_at: values.until ? new Date(values.until).toISOString() : null,
  }
  await store.upsertEntitlement(row)
  await store.recordEvent({ event: 'entitlement_granted', extension_id: values.ext, tenant_id: values.tenant, actor: values.actor, summary: `Entitlement ${values.ext} granted${row.ends_at ? ` until ${row.ends_at}` : ''} (usertasks-admin)`, detail: { limits, features: row.features, ends_at: row.ends_at } })
  io.out(`Granted ${values.ext} to ${values.tenant}${row.ends_at ? ` until ${day(row.ends_at)} (stops 24 hours later)` : ''}.`)
  return 0
}

/** The `licence` line of `usertasks-admin status`, and its warnings. */
export async function licenceStatusLine(store: LicenceCliStore, env: NodeJS.ProcessEnv, deps: LicenceCliDeps = {}): Promise<{ line: string; warnings: Array<{ level: string; message: string }>; licences: LicenceSummary[] }> {
  const now = (deps.now ?? (() => new Date()))()
  const identity: InstanceIdentity = { instanceId: await store.ensureInstanceId().catch(() => null), hostnames: instanceHostnames(env.APP_URL || env.NEXT_PUBLIC_APP_URL) }
  const raw: RawLicence[] = [
    ...storedLicences(await store.readSetting(LICENCES_SETTING)).map((r) => ({ source: 'setting' as const, raw: r })),
    ...await envLicences({ env }),
  ]
  const verified = raw.map((r) => verifyLicence(r, identity, now, deps.keyring ?? LICENCE_KEYRING))
  const licences = verified.map(summarise)
  const warnings = licenceWarnings(verified)
  if (!licences.length) return { line: 'none installed (paid extensions unlicensed)', warnings, licences }
  const usable = licences.filter((l) => l.valid && (l.timeState === 'active' || l.timeState === 'expiring' || l.timeState === 'cutoff_pending'))
  const soonest = usable.map((l) => l.expiresAt).filter((e): e is string => Boolean(e)).sort()[0]
  const exts = [...new Set(usable.flatMap((l) => l.extensions.map((e) => e.id)))].join(', ')
  return { line: `${licences.length} installed, ${usable.length} usable${exts ? ` (${exts})` : ''}${soonest ? ` · next expiry ${day(soonest)}` : ''}`, warnings, licences }
}
