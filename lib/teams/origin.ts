/**
 * Where a team comes from (teams.origin, migration 20270116050000): created
 * in UserTasks, or kept by a directory — LDAP / Active Directory, Entra ID,
 * Okta, Google Workspace, SCIM — or by an extension's directory source (a
 * SharePoint group). Shown as a text badge on every team in the assignee
 * pickers, the Teams page and the API (`origin`, `origin_label`).
 *
 * Client-safe (no server imports): the pickers, the services, the sync paths
 * and the tests share it.
 */

export const TEAM_ORIGINS = [
  'internal',
  'active_directory',
  'ldap',
  'entra',
  'okta',
  'google',
  'scim',
  'sharepoint',
  'extension',
] as const

export type TeamOrigin = (typeof TEAM_ORIGINS)[number]

/** Origins a directory source of an extension may declare (manifest `kind`, snapshot group `kind`). */
export const DIRECTORY_SOURCE_KINDS = ['sharepoint', 'active_directory', 'ldap', 'entra', 'okta', 'google', 'extension'] as const
export type DirectorySourceKind = (typeof DIRECTORY_SOURCE_KINDS)[number]

/** Full label (badge text, tooltips, API origin_label). */
export const TEAM_ORIGIN_LABELS: Record<TeamOrigin, string> = {
  internal: 'Internal',
  active_directory: 'Active Directory',
  ldap: 'LDAP',
  entra: 'Entra ID',
  okta: 'Okta',
  google: 'Google',
  scim: 'SCIM',
  sharepoint: 'SharePoint',
  extension: 'Directory source',
}

/** Short label for the filter chips. */
export const TEAM_ORIGIN_SHORT_LABELS: Record<TeamOrigin, string> = {
  internal: 'Internal',
  active_directory: 'AD',
  ldap: 'LDAP',
  entra: 'Entra',
  okta: 'Okta',
  google: 'Google',
  scim: 'SCIM',
  sharepoint: 'SharePoint',
  extension: 'Other',
}

/** What the badge says when hovered: how the team is kept. */
export const TEAM_ORIGIN_DESCRIPTIONS: Record<TeamOrigin, string> = {
  internal: 'Created in UserTasks',
  active_directory: 'Synced from Active Directory',
  ldap: 'Synced from an LDAP directory',
  entra: 'Synced from Microsoft Entra ID',
  okta: 'Synced from Okta',
  google: 'Synced from Google Workspace',
  scim: 'Provisioned over SCIM',
  sharepoint: 'A SharePoint group',
  extension: 'Kept by a directory source',
}

export function isTeamOrigin(value: unknown): value is TeamOrigin {
  return typeof value === 'string' && (TEAM_ORIGINS as readonly string[]).includes(value)
}

/** A stored or requested origin, or 'internal' for anything unknown. */
export function normaliseTeamOrigin(value: unknown): TeamOrigin {
  return isTeamOrigin(value) ? value : 'internal'
}

export function teamOriginLabel(origin: unknown): string {
  return TEAM_ORIGIN_LABELS[normaliseTeamOrigin(origin)]
}

/** Display order of the filter chips (Internal first, then the directories). */
export function sortTeamOrigins<T extends string>(origins: Iterable<T>): T[] {
  const rank = (o: string) => {
    const i = (TEAM_ORIGINS as readonly string[]).indexOf(o)
    return i === -1 ? TEAM_ORIGINS.length : i
  }
  return [...new Set(origins)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/**
 * The origin of a team kept by a built-in directory connection
 * (directory_links.provider). LDAP is "Active Directory" when the connection
 * uses the Active Directory flavour (settings.flavor).
 */
export function originForDirectoryProvider(provider: string, ldapFlavor?: string | null): TeamOrigin {
  switch (provider) {
    case 'entra': return 'entra'
    case 'okta': return 'okta'
    case 'google': return 'google'
    case 'scim': return 'scim'
    case 'ldap': return ldapFlavor === 'active_directory' ? 'active_directory' : 'ldap'
    default: return 'internal'
  }
}

/**
 * The origin of a team kept by an extension's directory source: the group's
 * own `kind`, else the source's `kind` (manifest), else what its label or id
 * names ("SharePoint · Sales", ext.sharepoint.directory), else 'extension'.
 */
export function originForExtensionSource(input: {
  sourceId?: string | null
  groupKind?: string | null
  sourceKind?: string | null
  label?: string | null
}): TeamOrigin {
  for (const kind of [input.groupKind, input.sourceKind]) {
    if (kind && (DIRECTORY_SOURCE_KINDS as readonly string[]).includes(kind)) return kind as TeamOrigin
  }
  const text = `${input.label ?? ''} ${input.sourceId ?? ''}`.toLowerCase()
  if (/share\s*point/.test(text)) return 'sharepoint'
  if (/active\s*directory/.test(text)) return 'active_directory'
  if (/\bentra\b|azure\s*ad/.test(text)) return 'entra'
  return 'extension'
}

/**
 * Best-effort origin of a team row that has no stored origin (the database
 * before 20270116050000): a team with an extension source is that source's
 * kind; anything else reads as Internal.
 */
export function deriveTeamOrigin(team: { origin?: unknown; source?: string | null; source_label?: string | null }): TeamOrigin {
  if (isTeamOrigin(team.origin) && (team.origin !== 'internal' || !team.source)) return team.origin
  if (team.source) return originForExtensionSource({ sourceId: team.source, label: team.source_label })
  return 'internal'
}
