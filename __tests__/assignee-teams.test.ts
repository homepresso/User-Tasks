/**
 * Searching teams in the assignee pickers, with a source badge on every team:
 *  - origin derivation (lib/teams/origin.ts) for the built-in directories,
 *    extension directory sources (the source's / a group's kind, else the
 *    label) and rows read before migration 20270116050000;
 *  - the extension manifest's directory source `kind` and a snapshot group's
 *    `kind`;
 *  - the search term clean-up and the picker's keyboard moves;
 *  - the picker markup (components/tasks/assignee-search.tsx): one combobox,
 *    results grouped People / Teams, a text badge and member count on every
 *    team, filter chips only for the origins the workspace has;
 *  - API parity: GET /api/v1/teams documents search / origin / limit and
 *    `origin` on team objects (OpenAPI, SDK, CLI), MCP teams_list takes the
 *    same filters.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  deriveTeamOrigin, isTeamOrigin, normaliseTeamOrigin, originForDirectoryProvider, originForExtensionSource, sortTeamOrigins,
  TEAM_ORIGIN_DESCRIPTIONS, TEAM_ORIGIN_LABELS, TEAM_ORIGIN_SHORT_LABELS, TEAM_ORIGINS,
} from '@/lib/teams/origin'
import { searchTerm } from '@/lib/services/assignee-search'
import { withOrigin } from '@/lib/services/teams'
import { parseExtensionManifest } from '@/lib/extensions/manifest'
import { normaliseSnapshot } from '@/lib/directory-sync/sources'
import { AssigneeSearch, moveActive } from '@/components/tasks/assignee-search'
import { TeamOriginBadge } from '@/components/teams/team-origin-badge'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */

const listTeamsMock = vi.hoisted(() => vi.fn(async (_ctx: unknown, _opts?: unknown) => ({ teams: [{ id: 't1', name: 'Finance', origin: 'entra' }], total: 1 })))
vi.mock('@/lib/services/teams', async (importOriginal) => ({ ...(await importOriginal<any>()), listTeams: listTeamsMock }))
vi.mock('@/lib/services/context', async (importOriginal) => ({ ...(await importOriginal<any>()), fromMcpContext: () => ({ tenantId: 'tenant-a' }) }))

describe('team origin', () => {
  it('every origin has a label, a short chip label and a description', () => {
    for (const origin of TEAM_ORIGINS) {
      expect(TEAM_ORIGIN_LABELS[origin]).toBeTruthy()
      expect(TEAM_ORIGIN_SHORT_LABELS[origin]).toBeTruthy()
      expect(TEAM_ORIGIN_DESCRIPTIONS[origin]).toBeTruthy()
    }
    expect(TEAM_ORIGIN_LABELS.entra).toBe('Entra ID')
    expect(TEAM_ORIGIN_LABELS.active_directory).toBe('Active Directory')
    expect(TEAM_ORIGIN_SHORT_LABELS.active_directory).toBe('AD')
    expect(isTeamOrigin('sharepoint')).toBe(true)
    expect(isTeamOrigin('myspace')).toBe(false)
    expect(normaliseTeamOrigin('myspace')).toBe('internal')
  })

  it('built-in directories: LDAP is Active Directory with that flavour', () => {
    expect(originForDirectoryProvider('entra')).toBe('entra')
    expect(originForDirectoryProvider('okta')).toBe('okta')
    expect(originForDirectoryProvider('google')).toBe('google')
    expect(originForDirectoryProvider('scim')).toBe('scim')
    expect(originForDirectoryProvider('ldap', 'active_directory')).toBe('active_directory')
    expect(originForDirectoryProvider('ldap', 'openldap')).toBe('ldap')
    expect(originForDirectoryProvider('ldap')).toBe('ldap')
    expect(originForDirectoryProvider('something')).toBe('internal')
  })

  it('extension sources: a group\'s kind, else the source\'s kind, else the label or id', () => {
    expect(originForExtensionSource({ sourceId: 'ext.acme.people', groupKind: 'active_directory', sourceKind: 'sharepoint' })).toBe('active_directory')
    expect(originForExtensionSource({ sourceId: 'ext.acme.people', sourceKind: 'sharepoint' })).toBe('sharepoint')
    expect(originForExtensionSource({ sourceId: 'ext.sharepoint.directory' })).toBe('sharepoint')
    expect(originForExtensionSource({ sourceId: 'ext.acme.people', label: 'SharePoint · Sales' })).toBe('sharepoint')
    expect(originForExtensionSource({ sourceId: 'ext.acme.people', label: 'Azure AD groups' })).toBe('entra')
    expect(originForExtensionSource({ sourceId: 'ext.acme.people', label: 'Partner portal' })).toBe('extension')
    // An unknown kind is ignored (the label decides).
    expect(originForExtensionSource({ sourceKind: 'internal', label: 'Partner portal' })).toBe('extension')
  })

  it('rows read before the migration: a source team is its source\'s kind, anything else Internal', () => {
    expect(deriveTeamOrigin({ source: 'ext.sharepoint.directory', source_label: 'SharePoint · HR' })).toBe('sharepoint')
    expect(deriveTeamOrigin({ source: null })).toBe('internal')
    expect(deriveTeamOrigin({})).toBe('internal')
    expect(deriveTeamOrigin({ origin: 'entra' })).toBe('entra')
    // A stored default 'internal' on a source team (tagging not run yet) still reads as the source.
    expect(deriveTeamOrigin({ origin: 'internal', source: 'ext.sharepoint.directory' })).toBe('sharepoint')
    expect(withOrigin({ id: 't', name: 'HR', source: 'ext.sharepoint.directory' })).toMatchObject({ origin: 'sharepoint', origin_label: 'SharePoint', external_id: null })
  })

  it('chips are ordered Internal first, then the directories', () => {
    expect(sortTeamOrigins(['sharepoint', 'internal', 'entra', 'active_directory'])).toEqual(['internal', 'active_directory', 'entra', 'sharepoint'])
  })
})

describe('extension directory source kind', () => {
  const manifest = {
    manifest_version: 1, id: 'acmedir', name: 'Acme directory', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' },
    engines: { usertasks: '>=0.1.0 <2.0.0', extension_sdk: '^1.0.0' },
    licence: { tier: 'paid', sku: 'acme-dir', features: ['directory'] },
    deployments: ['cloud', 'self_hosted'],
  }

  it('the manifest declares what kind of directory a source is', () => {
    const parsed = parseExtensionManifest({ ...manifest, contributes: { directorySources: [{ key: 'people', label: 'SharePoint', kind: 'sharepoint', feature: 'directory' }] } })
    expect(parsed.contributes.directorySources[0]).toMatchObject({ key: 'people', kind: 'sharepoint' })
    expect(parseExtensionManifest({ ...manifest, contributes: { directorySources: [{ key: 'people', label: 'Acme', feature: 'directory' }] } }).contributes.directorySources[0].kind).toBeUndefined()
    expect(() => parseExtensionManifest({ ...manifest, contributes: { directorySources: [{ key: 'people', label: 'Acme', kind: 'internal', feature: 'directory' }] } })).toThrow()
  })

  it('a snapshot group may name its own kind', () => {
    const snap = normaliseSnapshot({ users: [], groups: [
      { externalId: 'g1', displayName: 'Owners', members: [] },
      { externalId: 'g2', displayName: 'CONTOSO\\Finance', kind: 'active_directory', members: [] },
    ] })
    expect(snap.groups.map((g) => [g.externalId, g.kind])).toEqual([['g1', null], ['g2', 'active_directory']])
    expect(() => normaliseSnapshot({ users: [], groups: [{ externalId: 'g3', displayName: 'X', kind: 'myspace' as any, members: [] }] })).toThrow(/invalid snapshot/)
  })
})

describe('picker behaviour', () => {
  it('cleans the search term of LIKE and or() syntax', () => {
    expect(searchTerm('  Fin%an_ce, (team) * "x" : y\\ ')).toBe('Fin an ce team x y')
    expect(searchTerm(null)).toBe('')
    expect(searchTerm('a'.repeat(300))).toHaveLength(100)
  })

  it('keyboard: arrows wrap around people then teams, Home / End jump, other keys do not move', () => {
    expect(moveActive('ArrowDown', -1, 4)).toBe(0)
    expect(moveActive('ArrowDown', 0, 4)).toBe(1)
    expect(moveActive('ArrowDown', 3, 4)).toBe(0)
    expect(moveActive('ArrowUp', 0, 4)).toBe(3)
    expect(moveActive('ArrowUp', 2, 4)).toBe(1)
    expect(moveActive('ArrowUp', -1, 4)).toBe(3)
    expect(moveActive('Home', 2, 4)).toBe(0)
    expect(moveActive('End', 0, 4)).toBe(3)
    expect(moveActive('ArrowDown', 9, 4)).toBe(0) // a stale index (fewer results) is clamped
    expect(moveActive('Enter', 1, 4)).toBeNull()
    expect(moveActive('ArrowDown', 0, 0)).toBeNull()
  })
})

describe('picker markup', () => {
  const people = [
    { kind: 'person', id: 'u1', name: 'Finn Fischer', email: 'finn@northwind.test' },
  ]
  const teams = [
    { kind: 'team', id: 't-int', name: 'Finance Ops', description: null, origin: 'internal', origin_label: 'Internal', source_label: null, member_count: 1 },
    { kind: 'team', id: 't-ad', name: 'FIN-Payables', description: null, origin: 'active_directory', origin_label: 'Active Directory', source_label: null, member_count: 12 },
    { kind: 'team', id: 't-entra', name: 'Finance Approvers', description: null, origin: 'entra', origin_label: 'Entra ID', source_label: null, member_count: 2 },
    { kind: 'team', id: 't-sp', name: 'Finance Site Members', description: null, origin: 'sharepoint', origin_label: 'SharePoint', source_label: 'SharePoint · Finance', member_count: 3 },
  ]
  const origins = [
    { origin: 'internal', label: 'Internal', count: 4 },
    { origin: 'active_directory', label: 'Active Directory', count: 9 },
    { origin: 'entra', label: 'Entra ID', count: 2 },
    { origin: 'sharepoint', label: 'SharePoint', count: 5 },
  ]
  const render = (props: Record<string, unknown> = {}, data = { people, teams }, originRows: unknown[] = origins) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    const kinds = (props.kinds as string[] | undefined) ?? ['person', 'team']
    client.setQueryData(['assignee-search', '', kinds.join(','), null, 8], data)
    client.setQueryData(['team-origins'], originRows)
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AssigneeSearch, { onPick: () => {}, ...props } as any)))
  }

  it('one combobox over a listbox grouped People / Teams, people first', () => {
    const html = render({ selectedKeys: ['team:t-sp'] })
    expect(html).toMatch(/role="combobox"[^>]*aria-expanded="true"/)
    expect(html).toMatch(/aria-controls="[^"]+-list"/)
    expect(html).toContain('role="listbox"')
    const peopleAt = html.indexOf('>People<')
    const teamsAt = html.indexOf('>Teams<')
    expect(peopleAt).toBeGreaterThan(-1)
    expect(teamsAt).toBeGreaterThan(peopleAt)
    expect(html.match(/role="option"/g)).toHaveLength(5)
    // The first option is highlighted (aria-activedescendant points at it).
    const active = /aria-activedescendant="([^"]+)"/.exec(html)?.[1]
    expect(active).toBeTruthy()
    expect(html).toContain(`id="${active}" role="option" aria-selected="true"`)
    expect(html).toContain('data-assignee-option="person:u1"')
    // Picked already: said in text.
    expect(html).toMatch(/data-assignee-option="team:t-sp"[\s\S]*?Selected/)
  })

  it('every team has a text badge for its origin and its member count', () => {
    const html = render()
    for (const [origin, text] of [['internal', 'Internal'], ['active_directory', 'Active Directory'], ['entra', 'Entra ID'], ['sharepoint', 'SharePoint']]) {
      expect(html).toMatch(new RegExp(`data-team-origin="${origin}"[^>]*>(<svg[\\s\\S]*?</svg>)?<span class="truncate">${text}</span>`))
    }
    expect(html).toContain('12 members')
    expect(html).toContain('1 member<')
    expect(html).toContain('SharePoint · Finance')
  })

  it('filter chips: All plus only the origins the workspace has, as toggle buttons', () => {
    const html = render()
    expect(html).toContain('aria-label="Filter teams by source"')
    const chips = [...html.matchAll(/data-origin-filter="([^"]+)"/g)].map((m) => m[1])
    expect(chips).toEqual(['all', 'internal', 'active_directory', 'entra', 'sharepoint'])
    expect(html).toMatch(/aria-pressed="true"[^>]*data-origin-filter="all"/)
    expect(html).toMatch(/data-origin-filter="active_directory"[^>]*>AD/)
    // One origin only (every team Internal): no chips.
    expect(render({}, { people, teams: [teams[0]] }, [origins[0]])).not.toContain('data-origin-filter')
  })

  it('teams only (the User Task node, an origin filter): no People group', () => {
    const html = render({ kinds: ['team'] }, { people: [], teams })
    expect(html).not.toContain('>People<')
    expect(html).toContain('>Teams<')
    expect(html).toContain('placeholder="Search teams…"')
  })

  it('the badge is text (colour is not the only cue), with a description on hover', () => {
    const html = renderToStaticMarkup(createElement(TeamOriginBadge, { origin: 'entra' }))
    expect(html).toContain('>Entra ID<')
    expect(html).toContain('title="Synced from Microsoft Entra ID"')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(renderToStaticMarkup(createElement(TeamOriginBadge, { origin: 'bogus' }))).toContain('>Internal<')
  })
})

describe('API parity', () => {
  const spec = JSON.parse(readFileSync(join(process.cwd(), 'packages/sdk/openapi.json'), 'utf8'))

  it('GET /teams documents search, origin and limit, and origin on team objects', () => {
    const op = spec.paths['/teams'].get
    const params = Object.fromEntries((op.parameters ?? []).map((p: any) => [p.name, p]))
    expect(Object.keys(params)).toEqual(expect.arrayContaining(['search', 'origin', 'limit']))
    expect(params.origin.schema.enum).toEqual([...TEAM_ORIGINS])
    const json = JSON.stringify(op.responses['200'])
    expect(json).toContain('origin_label')
    expect(json).toContain('external_id')
    expect(JSON.stringify(spec.paths['/teams/{id}'].get.responses['200'])).toContain('origin_label')
  })

  it('the SDK and the CLI were regenerated with the filters', () => {
    const sdk = readFileSync(join(process.cwd(), 'packages/sdk/src/generated/schema.ts'), 'utf8')
    expect(sdk).toMatch(/origin\?: "internal" \| "active_directory"/)
    const cli = readFileSync(join(process.cwd(), 'packages/cli/src/generated/commands.ts'), 'utf8')
    const listTeams = cli.slice(cli.indexOf('"operationId": "listTeams"'), cli.indexOf('"operationId": "listTeams"') + 3000)
    expect(listTeams).toContain('"search"')
    expect(listTeams).toContain('"origin"')
  })

  it('MCP teams_list takes search, origin and limit and passes them to the service', async () => {
    const { registerGovernanceTools } = await import('@/lib/mcp/tools/governance')
    const tools = new Map<string, { schema: Record<string, any>; handler: (args: any) => Promise<any> }>()
    registerGovernanceTools({ tool: (name: string, _d: string, schema: any, handler: any) => { tools.set(name, { schema, handler }) } } as any, {} as any)
    const tool = tools.get('teams_list')!
    expect(Object.keys(tool.schema).sort()).toEqual(['limit', 'origin', 'search'])
    expect(tool.schema.origin.safeParse('sharepoint').success).toBe(true)
    expect(tool.schema.origin.safeParse('myspace').success).toBe(false)
    const result = await tool.handler({ search: 'fin', origin: 'entra' })
    expect(listTeamsMock).toHaveBeenCalledWith(expect.anything(), { search: 'fin', origin: 'entra', limit: undefined })
    expect(JSON.parse(result.content[0].text)).toMatchObject({ count: 1, teams: [{ origin: 'entra' }] })
  }, 30_000)
})
