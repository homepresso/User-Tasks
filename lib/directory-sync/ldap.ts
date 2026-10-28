import { isIP } from 'node:net'
import { Client } from 'ldapts'
import { z } from 'zod'
import { assertSafeEgressHost } from '@/lib/egress-guard'
import { LDAP_FLAVORS, LDAP_PRESETS, type LdapFlavor } from '@/lib/directory-sync/ldap-presets'
import {
  looksLikeEmail,
  type DirectoryClient,
  type DirectoryGroup,
  type DirectoryUser,
  type DirectoryUserChanges,
} from '@/lib/directory-sync/types'

/**
 * LDAP / Active Directory directory client (ldapts). One connection per sync,
 * bound as a service account; users and groups come from paged subtree
 * searches with an attribute mapping:
 *
 *  - Transport: ldaps:// (implicit TLS) or ldap:// + StartTLS, verified
 *    against a CA bundle (ca_cert, PEM) or the system roots; plain ldap://
 *    works but is reported as a warning (the bind password crosses the wire).
 *  - Flavours: active_directory (objectGUID, sAMAccountName, userAccountControl
 *    disabled bit, nested groups via LDAP_MATCHING_RULE_IN_CHAIN
 *    1.2.840.113556.1.4.1941, delta via uSNChanged / highestCommittedUSN) and
 *    openldap / generic (entryUUID, uid, member / uniqueMember / memberUid,
 *    nested groups by recursion over member DNs, delta via modifyTimestamp).
 *  - Filters are the admin's; values we interpolate (login names, DNs) are
 *    escaped per RFC 4515.
 *
 * Also used for the optional LDAP bind login (lib/directory-sync/ldap-login):
 * find the user's entry with the service account, then bind as that DN with
 * the password on a separate connection.
 */

export { LDAP_FLAVORS, type LdapFlavor }

/** AD: transitive group membership (LDAP_MATCHING_RULE_IN_CHAIN). */
export const AD_IN_CHAIN_OID = '1.2.840.113556.1.4.1941'
/** AD userAccountControl ACCOUNTDISABLE bit. */
const UAC_ACCOUNT_DISABLE = 0x2

const attr = z.string().trim().min(1).max(100).regex(/^[A-Za-z][A-Za-z0-9-]*(;[A-Za-z0-9-]+)*$/, 'an LDAP attribute name')
const dn = z.string().trim().min(1).max(1000)
const filter = z.string().trim().max(2000).refine((value) => value === '' || (value.startsWith('(') && value.endsWith(')')), 'an LDAP filter in parentheses, e.g. (objectClass=person)')

export const ldapAttributeMapping = z.object({
  id: attr.optional().describe('Stable unique id (AD objectGUID, OpenLDAP entryUUID)'),
  username: attr.optional().describe('Login name (sAMAccountName, uid)'),
  email: attr.optional().describe('Email (mail)'),
  display_name: attr.optional().describe('Display name (displayName)'),
  first_name: attr.optional().describe('Given name (givenName)'),
  last_name: attr.optional().describe('Surname (sn)'),
  group_name: attr.optional().describe('Group name (cn)'),
  group_description: attr.optional().describe('Group description (description)'),
  member: attr.optional().describe('Group member attribute (member, uniqueMember, memberUid)'),
  manager: attr.optional().describe('Manager DN attribute (manager)'),
})

export const ldapSettingsSchema = z.object({
  url: z.string().trim().max(500).regex(/^ldaps?:\/\/[^\s/]+(:\d+)?\/?$/i, 'ldap://host[:port] or ldaps://host[:port]')
    .describe('ldaps://dc1.corp.example.com:636 or ldap://ldap.example.com:389'),
  start_tls: z.boolean().default(false).describe('Upgrade ldap:// with StartTLS'),
  ca_cert: z.string().max(50_000).optional().describe('PEM CA certificate(s) the server certificate must chain to (default: system roots)'),
  tls_reject_unauthorized: z.boolean().default(true).describe('Verify the server certificate (default true)'),
  tls_server_name: z.string().trim().max(255).optional().describe('Expected certificate host name, when it differs from the URL host'),
  bind_dn: dn.describe('Service account DN (or user@domain for AD)'),
  base_dn: dn.describe('Search base, e.g. DC=corp,DC=example,DC=com'),
  user_base_dn: dn.optional().describe('Users below this DN (default base_dn)'),
  group_base_dn: dn.optional().describe('Groups below this DN (default base_dn)'),
  flavor: z.enum(LDAP_FLAVORS).default('generic').describe('active_directory, openldap or generic'),
  user_filter: filter.optional().describe('Which entries are users (default per flavour)'),
  group_filter: filter.optional().describe('Which entries are groups (default per flavour)'),
  attributes: ldapAttributeMapping.default({}),
  nested_groups: z.boolean().default(true).describe('Members of nested groups count as members of the parent'),
  page_size: z.number().int().min(10).max(5000).default(500),
  timeout_ms: z.number().int().min(1000).max(120_000).default(15_000),
  deprovision_missing: z.boolean().default(true).describe('A full sync deactivates linked users no longer returned by the user filter'),
  bind_login: z.boolean().default(false).describe('Users of this workspace sign in with their directory password (built-in auth)'),
  login_attributes: z.array(attr).max(5).optional().describe('Attributes matched against the login name (default email + username attributes)'),
})

export type LdapSettingsInput = z.input<typeof ldapSettingsSchema>
export type LdapSettings = z.output<typeof ldapSettingsSchema>

export interface ResolvedLdapSettings extends LdapSettings {
  userFilter: string
  groupFilter: string
  map: Required<z.output<typeof ldapAttributeMapping>>
  loginAttributes: string[]
  userBase: string
  groupBase: string
}

const PRESETS: Record<LdapFlavor, { userFilter: string; groupFilter: string; map: Required<z.output<typeof ldapAttributeMapping>> }> = LDAP_PRESETS

export function ldapPreset(flavor: LdapFlavor) {
  return PRESETS[flavor]
}

/** Parse and complete LDAP settings (flavour defaults for filters and the mapping). */
export function resolveLdapSettings(raw: unknown): ResolvedLdapSettings {
  const settings = ldapSettingsSchema.parse(raw ?? {})
  const preset = PRESETS[settings.flavor]
  const map = { ...preset.map, ...Object.fromEntries(Object.entries(settings.attributes).filter(([, v]) => v)) } as ResolvedLdapSettings['map']
  return {
    ...settings,
    userFilter: settings.user_filter || preset.userFilter,
    groupFilter: settings.group_filter || preset.groupFilter,
    map,
    loginAttributes: settings.login_attributes?.length
      ? settings.login_attributes
      : [...new Set([map.email, ...(settings.flavor === 'active_directory' ? ['userPrincipalName'] : []), map.username])],
    userBase: settings.user_base_dn || settings.base_dn,
    groupBase: settings.group_base_dn || settings.base_dn,
  }
}

/** RFC 4515 escaping of a value placed inside a filter. */
export function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (ch) => `\\${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

/** AD objectGUID (16 bytes, mixed endian) → 8-4-4-4-12 string. */
export function formatObjectGuid(buffer: Buffer): string {
  if (buffer.length !== 16) return buffer.toString('hex')
  const hex = (start: number, end: number, reverse = false) => {
    const slice = [...buffer.subarray(start, end)]
    return (reverse ? slice.reverse() : slice).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `${hex(0, 4, true)}-${hex(4, 6, true)}-${hex(6, 8, true)}-${hex(8, 10)}-${hex(10, 16)}`
}

/** Case/whitespace-insensitive DN key (member values and entry DNs differ in both). */
export function normalizeDn(value: string): string {
  return value.trim().replace(/\s*([,=+])\s*/g, '$1').toLowerCase()
}

/** LDAP generalized time (YYYYMMDDHHMMSSZ). */
export function toGeneralizedTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
}

// ── Transport ────────────────────────────────────────────────────────────────

type EntryValue = Buffer | Buffer[] | string[] | string
export interface LdapEntry { dn: string; [attribute: string]: EntryValue }

/** The slice of ldapts' Client we use (lets tests substitute a fake). */
export interface LdapConnection {
  startTLS(options?: Record<string, unknown>): Promise<void>
  bind(dn: string, password?: string): Promise<void>
  search(base: string, options: Record<string, unknown>): Promise<{ searchEntries: LdapEntry[] }>
  unbind(): Promise<void>
}

export type LdapConnectionFactory = (options: { url: string; timeout: number; connectTimeout: number; tlsOptions?: Record<string, unknown> }) => Promise<LdapConnection>

const defaultFactory: LdapConnectionFactory = async (options) =>
  new Client(options as ConstructorParameters<typeof Client>[0]) as unknown as LdapConnection

export class LdapError extends Error {
  constructor(message: string, readonly code: 'invalid_credentials' | 'connection' | 'tls' | 'search' | 'config' = 'connection') {
    super(message)
    this.name = 'LdapError'
  }
}

function describeLdapError(error: unknown, what: string): LdapError {
  const e = error as { name?: string; code?: string | number; message?: string }
  const message = String(e?.message ?? error).slice(0, 300)
  const code = String(e?.code ?? '')
  if (e?.name === 'InvalidCredentialsError' || e?.code === 49) return new LdapError(`${what}: invalid credentials`, 'invalid_credentials')
  if (/^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_OSSL)/.test(code)
    || /self[- ]signed certificate|unable to verify the first certificate|unable to get local issuer|Hostname\/IP does not match|certificate has expired/i.test(message)) {
    return new LdapError(`${what}: TLS verification failed (${message})`, 'tls')
  }
  if (/^(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN)$/.test(code) || /timeout|Connection closed|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    return new LdapError(`${what}: could not reach the directory server (${message})`, 'connection')
  }
  return new LdapError(`${what}: ${message}`, 'search')
}

function tlsOptionsFor(settings: ResolvedLdapSettings, host: string): Record<string, unknown> {
  return {
    ...(settings.ca_cert?.trim() ? { ca: [settings.ca_cert.trim()] } : {}),
    rejectUnauthorized: settings.tls_reject_unauthorized,
    // SNI takes host names only (RFC 6066); IP literals are checked against the certificate's IP SANs.
    ...(settings.tls_server_name || !isIP(host) ? { servername: settings.tls_server_name || host } : {}),
    minVersion: 'TLSv1.2',
  }
}

function hostOf(url: string): string {
  return new URL(url).hostname
}

/** Whether the connection is encrypted (ldaps:// or StartTLS). */
export function ldapIsEncrypted(settings: Pick<LdapSettings, 'url' | 'start_tls'>): boolean {
  return /^ldaps:/i.test(settings.url) || settings.start_tls
}

async function openConnection(settings: ResolvedLdapSettings, factory: LdapConnectionFactory): Promise<LdapConnection> {
  const host = hostOf(settings.url)
  await assertSafeEgressHost(host)
  const tlsOptions = tlsOptionsFor(settings, host)
  const connection = await factory({
    url: settings.url.replace(/\/+$/, ''),
    timeout: settings.timeout_ms,
    connectTimeout: Math.min(settings.timeout_ms, 10_000),
    ...(/^ldaps:/i.test(settings.url) ? { tlsOptions } : {}),
  })
  if (settings.start_tls && !/^ldaps:/i.test(settings.url)) {
    try {
      await connection.startTLS(tlsOptions)
    } catch (error) {
      await connection.unbind().catch(() => undefined)
      throw describeLdapError(error, 'StartTLS')
    }
  }
  return connection
}

// ── Entry helpers ────────────────────────────────────────────────────────────

function values(entry: LdapEntry, name: string): Array<string | Buffer> {
  const lower = name.toLowerCase()
  const key = Object.keys(entry).find((k) => k.toLowerCase() === lower)
  if (!key) return []
  const value = entry[key]
  return Array.isArray(value) ? (value as Array<string | Buffer>) : [value as string | Buffer]
}

function text(entry: LdapEntry, name: string): string | null {
  const first = values(entry, name)[0]
  if (first === undefined) return null
  const out = Buffer.isBuffer(first) ? first.toString('utf8') : String(first)
  return out.trim() === '' ? null : out
}

function idOf(entry: LdapEntry, settings: ResolvedLdapSettings): string {
  const raw = values(entry, settings.map.id)[0]
  if (Buffer.isBuffer(raw)) return settings.map.id.toLowerCase() === 'objectguid' ? formatObjectGuid(raw) : raw.toString('hex')
  if (typeof raw === 'string' && raw.trim()) return raw.trim().toLowerCase()
  // No id attribute: the DN (stable until the entry is renamed or moved).
  return `dn:${normalizeDn(entry.dn)}`
}

export interface LdapUser extends DirectoryUser {
  dn: string
  username: string | null
  /** The manager attribute's DN (resolved to `manager` by the client). */
  managerDn?: string
}

export function entryToUser(entry: LdapEntry, settings: ResolvedLdapSettings): LdapUser {
  const map = settings.map
  const mail = text(entry, map.email)
  const upn = settings.flavor === 'active_directory' ? text(entry, 'userPrincipalName') : null
  const email = looksLikeEmail(mail) ? mail.toLowerCase() : looksLikeEmail(upn) ? upn.toLowerCase() : null
  const username = text(entry, map.username)
  const name = [text(entry, map.first_name), text(entry, map.last_name)].filter(Boolean).join(' ').trim()
  let active = true
  if (settings.flavor === 'active_directory') {
    const uac = Number(text(entry, 'userAccountControl'))
    if (Number.isFinite(uac) && (uac & UAC_ACCOUNT_DISABLE)) active = false
  }
  return {
    externalId: idOf(entry, settings),
    dn: entry.dn,
    username,
    displayName: String(text(entry, map.display_name) || name || text(entry, 'cn') || username || email || entry.dn),
    email,
    active,
    ...(text(entry, map.manager) ? { managerDn: String(text(entry, map.manager)) } : {}),
  }
}

/** Resolve each user's manager DN to the manager's externalId (when it is a synced user). */
function withManagers(users: LdapUser[], byDn: Map<string, string>): LdapUser[] {
  for (const user of users) {
    if (!user.managerDn) continue
    const externalId = byDn.get(normalizeDn(user.managerDn))
    if (externalId) user.manager = { externalId }
  }
  return users
}

function userAttributes(settings: ResolvedLdapSettings): string[] {
  const map = settings.map
  return [...new Set([
    map.id, map.username, map.email, map.display_name, map.first_name, map.last_name, map.manager, 'cn',
    ...(settings.flavor === 'active_directory' ? ['userPrincipalName', 'userAccountControl'] : []),
  ])]
}

function bufferAttributes(settings: ResolvedLdapSettings): string[] {
  return settings.map.id.toLowerCase() === 'objectguid' ? [settings.map.id] : []
}

// ── Client ───────────────────────────────────────────────────────────────────

export interface LdapClientOptions {
  settings: unknown
  bindPassword: string
  /** Tests: a fake transport. */
  connect?: LdapConnectionFactory
  now?: () => Date
}

export interface LdapTestResult {
  ok: true
  server: string
  encrypted: boolean
  vendor: string | null
  users: number
  groups: number
  sample: Array<{ dn: string; externalId: string; email: string | null; displayName: string; active: boolean }>
  warnings: string[]
}

export interface LdapDirectoryClient extends DirectoryClient {
  test(): Promise<LdapTestResult>
  /** The single active user entry matching a login name, or null. */
  findLoginUser(login: string): Promise<LdapUser | null>
}

interface GroupRecord {
  group: DirectoryGroup
  dn: string
  members: string[]
}

export function createLdapClient(options: LdapClientOptions): LdapDirectoryClient {
  const settings = resolveLdapSettings(options.settings)
  const factory = options.connect ?? defaultFactory
  const now = options.now ?? (() => new Date())
  let connection: LdapConnection | null = null
  let groups: GroupRecord[] | null = null
  let dnIndex: Map<string, string> | null = null
  let usernameIndex: Map<string, string> | null = null

  async function conn(): Promise<LdapConnection> {
    if (connection) return connection
    const opened = await openConnection(settings, factory).catch((error) => {
      throw error instanceof LdapError ? error : describeLdapError(error, 'Connect')
    })
    try {
      await opened.bind(settings.bind_dn, options.bindPassword)
    } catch (error) {
      await opened.unbind().catch(() => undefined)
      throw describeLdapError(error, 'Bind as the service account')
    }
    connection = opened
    return opened
  }

  async function search(base: string, searchFilter: string, attributes: string[], extra: Record<string, unknown> = {}): Promise<LdapEntry[]> {
    const c = await conn()
    try {
      const { searchEntries } = await c.search(base, {
        scope: 'sub',
        filter: searchFilter,
        attributes,
        paged: { pageSize: settings.page_size },
        explicitBufferAttributes: bufferAttributes(settings),
        ...extra,
      })
      return searchEntries
    } catch (error) {
      throw describeLdapError(error, `Search ${base}`)
    }
  }

  async function rootDse(): Promise<LdapEntry | null> {
    const c = await conn()
    try {
      const { searchEntries } = await c.search('', {
        scope: 'base',
        filter: '(objectClass=*)',
        attributes: ['highestCommittedUSN', 'vendorName', 'vendorVersion', 'defaultNamingContext', 'supportedControl', 'dnsHostName'],
      })
      return searchEntries[0] ?? null
    } catch {
      return null
    }
  }

  async function listUsersMatching(extraFilter: string | null): Promise<LdapUser[]> {
    const f = extraFilter ? `(&${settings.userFilter}${extraFilter})` : settings.userFilter
    const entries = await search(settings.userBase, f, userAttributes(settings))
    return entries.map((entry) => entryToUser(entry, settings))
  }

  async function loadGroups(): Promise<GroupRecord[]> {
    if (groups) return groups
    const map = settings.map
    const memberAttrs = settings.flavor === 'active_directory' ? [] : [...new Set([map.member, 'member', 'uniqueMember', 'memberUid'])]
    const entries = await search(settings.groupBase, settings.groupFilter, [...new Set([map.id, map.group_name, map.group_description, ...memberAttrs])])
    groups = entries.map((entry) => ({
      dn: entry.dn,
      group: {
        externalId: idOf(entry, settings),
        displayName: String(text(entry, map.group_name) || entry.dn),
        description: text(entry, map.group_description),
      },
      members: memberAttrs.flatMap((name) => values(entry, name).map((v) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v)))),
    }))
    return groups
  }

  /** DN → externalId and username → externalId for every user (ids only). */
  async function userIndexes(): Promise<{ byDn: Map<string, string>; byUsername: Map<string, string> }> {
    if (!dnIndex || !usernameIndex) {
      const entries = await search(settings.userBase, settings.userFilter, [...new Set([settings.map.id, settings.map.username])])
      dnIndex = new Map()
      usernameIndex = new Map()
      for (const entry of entries) {
        const id = idOf(entry, settings)
        dnIndex.set(normalizeDn(entry.dn), id)
        const username = text(entry, settings.map.username)
        if (username) usernameIndex.set(username.toLowerCase(), id)
      }
    }
    return { byDn: dnIndex, byUsername: usernameIndex }
  }

  /** Generic directories: resolve member DNs, recursing into nested groups (cycle-safe). */
  async function resolveMembers(record: GroupRecord): Promise<string[]> {
    const all = await loadGroups()
    const groupsByDn = new Map(all.map((g) => [normalizeDn(g.dn), g]))
    const { byDn, byUsername } = await userIndexes()
    const out = new Set<string>()
    const visited = new Set<string>()
    const visit = (group: GroupRecord) => {
      const key = normalizeDn(group.dn)
      if (visited.has(key)) return
      visited.add(key)
      for (const member of group.members) {
        if (member.includes('=')) {
          const memberKey = normalizeDn(member)
          const userId = byDn.get(memberKey)
          if (userId) out.add(userId)
          else if (settings.nested_groups) {
            const nested = groupsByDn.get(memberKey)
            if (nested) visit(nested)
          }
        } else {
          // posixGroup memberUid: a username.
          const userId = byUsername.get(member.toLowerCase())
          if (userId) out.add(userId)
        }
      }
    }
    visit(record)
    return [...out]
  }

  const api: LdapDirectoryClient = {
    async verify() {
      const dse = await rootDse()
      const base = await search(settings.base_dn, '(objectClass=*)', ['1.1'], { scope: 'base', paged: false })
      if (base.length === 0) throw new LdapError(`Base DN ${settings.base_dn} was not found`, 'search')
      const orgName = (dse && (text(dse, 'dnsHostName') || text(dse, 'vendorName'))) || settings.base_dn
      return { orgName }
    },

    async listUsers() {
      const users = await listUsersMatching(null)
      dnIndex = new Map(users.map((u) => [normalizeDn(u.dn), u.externalId]))
      usernameIndex = new Map(users.filter((u) => u.username).map((u) => [String(u.username).toLowerCase(), u.externalId]))
      return withManagers(users, dnIndex)
    },

    async listGroups() {
      return (await loadGroups()).map((g) => g.group)
    },

    async listGroupMemberIds(groupId: string) {
      const record = (await loadGroups()).find((g) => g.group.externalId === groupId)
      if (!record) return []
      if (settings.flavor === 'active_directory') {
        const rule = settings.nested_groups ? `memberOf:${AD_IN_CHAIN_OID}:` : 'memberOf'
        const entries = await search(settings.userBase, `(&${settings.userFilter}(${rule}=${escapeLdapFilterValue(record.dn)}))`, [settings.map.id])
        return entries.map((entry) => idOf(entry, settings))
      }
      return resolveMembers(record)
    },

    async deltaCursor() {
      if (settings.flavor === 'active_directory') {
        const dse = await rootDse()
        const usn = dse ? text(dse, 'highestCommittedUSN') : null
        return usn && /^\d+$/.test(usn) ? `usn:${usn}` : null
      }
      // modifyTimestamp has second resolution and replicas lag: overlap 10 minutes.
      return `ts:${toGeneralizedTime(new Date(now().getTime() - 10 * 60_000))}`
    },

    async listUserChanges(cursor: string): Promise<DirectoryUserChanges> {
      const next = await api.deltaCursor!()
      let changedFilter: string
      if (cursor.startsWith('usn:')) changedFilter = `(uSNChanged>=${Number(cursor.slice(4)) + 1})`
      else if (cursor.startsWith('ts:')) changedFilter = `(modifyTimestamp>=${escapeLdapFilterValue(cursor.slice(3))})`
      else throw new LdapError(`Unknown delta cursor ${cursor.slice(0, 20)}`, 'config')
      const changed = await listUsersMatching(changedFilter)
      const managed = changed.some((u) => u.managerDn) ? withManagers(changed, (await userIndexes()).byDn) : changed
      return { users: managed, cursor: next }
    },

    async test(): Promise<LdapTestResult> {
      const warnings: string[] = []
      if (!ldapIsEncrypted(settings)) warnings.push('The connection is not encrypted: use ldaps:// or StartTLS so the bind password and directory data are protected.')
      if (!settings.tls_reject_unauthorized && ldapIsEncrypted(settings)) warnings.push('Certificate verification is off: anyone on the network path could impersonate the directory server.')
      const dse = await rootDse()
      const { orgName } = await api.verify()
      const users = await listUsersMatching(null)
      const groupList = (await loadGroups()).map((g) => g.group)
      if (users.length === 0) warnings.push('The user filter matched no entries.')
      if (users.length > 0 && users.every((u) => !u.email)) warnings.push(`No user has an email in "${settings.map.email}": users without an email are not synced.`)
      if (users.some((u) => u.externalId.startsWith('dn:'))) warnings.push(`Some users have no "${settings.map.id}" attribute: their DN is used as the id, so renaming or moving them re-creates the link.`)
      return {
        ok: true,
        server: orgName ?? hostOf(settings.url),
        encrypted: ldapIsEncrypted(settings),
        vendor: dse ? text(dse, 'vendorName') : null,
        users: users.length,
        groups: groupList.length,
        sample: users.slice(0, 5).map((u) => ({ dn: u.dn, externalId: u.externalId, email: u.email, displayName: u.displayName, active: u.active })),
        warnings,
      }
    },

    async findLoginUser(login: string) {
      const value = escapeLdapFilterValue(login.trim())
      if (!value) return null
      const any = settings.loginAttributes.map((name) => `(${name}=${value})`).join('')
      const entries = await search(settings.userBase, `(&${settings.userFilter}(|${any}))`, userAttributes(settings), { sizeLimit: 2, paged: false })
      if (entries.length !== 1) return null
      return entryToUser(entries[0], settings)
    },

    async close() {
      const c = connection
      connection = null
      if (c) await c.unbind().catch(() => undefined)
    },
  }
  return api
}

/**
 * Check a user's password with a simple bind as their DN, on a connection of
 * its own. Empty passwords are refused before reaching the server (an empty
 * simple bind is an unauthenticated bind that many servers accept).
 */
export async function verifyLdapPassword(options: { settings: unknown; dn: string; password: string; connect?: LdapConnectionFactory }): Promise<boolean> {
  if (!options.password || !options.dn) return false
  const settings = resolveLdapSettings(options.settings)
  const connection = await openConnection(settings, options.connect ?? defaultFactory).catch((error) => {
    throw error instanceof LdapError ? error : describeLdapError(error, 'Connect')
  })
  try {
    await connection.bind(options.dn, options.password)
    return true
  } catch (error) {
    const described = describeLdapError(error, 'Bind')
    if (described.code === 'invalid_credentials') return false
    throw described
  } finally {
    await connection.unbind().catch(() => undefined)
  }
}
