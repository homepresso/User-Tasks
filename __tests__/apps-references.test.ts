import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { SLUG_RE, WIDGET_CONFIG_SCHEMAS, appCreateSchema, pageCreateSchema } from '@/lib/apps/schema'
import {
  OBJECT_REF_KEYS, PAGE_REF_KEYS, PRINCIPAL_REF_KEYS, appEmbedOrigins, appReferenceIds, brokenPageLinks, collectAppReferences, rewriteAppReferences,
} from '@/lib/apps/references'

/* eslint-disable @typescript-eslint/no-explicit-any -- zod internals are walked untyped */

const UUID_SOURCE = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

/**
 * Every string leaf of a zod schema that is an id (the schema's uuid regex)
 * or a page slug (SLUG_RE), with the object key that holds it.
 */
function idLeaves(schema: z.ZodType, path: string[] = [], key = '', seen = new Set<unknown>()): Array<{ path: string; key: string; kind: 'uuid' | 'slug' }> {
  const def = (schema as any)?._zod?.def
  if (!def || seen.has(schema)) return []
  seen.add(schema)
  const out: Array<{ path: string; key: string; kind: 'uuid' | 'slug' }> = []
  const recurse = (s: unknown, p: string[] = path, k = key) => out.push(...idLeaves(s as z.ZodType, p, k, seen))
  switch (def.type) {
    case 'string':
      for (const check of def.checks ?? []) {
        const pattern = check?._zod?.def?.pattern as RegExp | undefined
        if (pattern?.source === UUID_SOURCE) out.push({ path: path.join('.'), key, kind: 'uuid' })
        if (pattern?.source === SLUG_RE.source) out.push({ path: path.join('.'), key, kind: 'slug' })
      }
      break
    case 'object':
      for (const [k, s] of Object.entries(def.shape ?? {})) recurse(s, [...path, k], k)
      break
    case 'optional': case 'nullable': case 'default': case 'prefault': case 'catch': case 'readonly': case 'nonoptional':
      recurse(def.innerType)
      break
    case 'pipe':
      recurse(def.in); recurse(def.out)
      break
    case 'union':
      for (const o of def.options ?? []) recurse(o)
      break
    case 'intersection':
      recurse(def.left); recurse(def.right)
      break
    case 'array':
      recurse(def.element, [...path, '[]'])
      break
    case 'record':
      recurse(def.valueType, [...path, '{}'])
      break
    case 'lazy':
      recurse(def.getter())
      break
    default:
      break
  }
  return out
}

describe('app reference walker: coverage of the widget catalogue and app / page schemas', () => {
  const schemas: Array<[string, z.ZodType]> = [
    ...Object.entries(WIDGET_CONFIG_SCHEMAS).map(([type, s]) => [`widget ${type}`, s as unknown as z.ZodType] as [string, z.ZodType]),
    ['page', pageCreateSchema as unknown as z.ZodType],
    // Audience and editors never travel: the installer chooses them.
    ['app', (appCreateSchema as any).omit({ audience: true, editors: true }) as z.ZodType],
  ]

  it('finds id-bearing fields in the schemas (the probe itself works)', () => {
    const leaves = schemas.flatMap(([, s]) => idLeaves(s))
    expect(leaves.some((l) => l.key === 'form_id')).toBe(true)
    expect(leaves.some((l) => l.kind === 'slug' && l.key === 'page_slug')).toBe(true)
  })

  it.each(schemas)('%s: every id field is a known reference key', (_name, schema) => {
    const unknown = idLeaves(schema).filter((l) => l.kind === 'uuid' && !OBJECT_REF_KEYS[l.key] && !PRINCIPAL_REF_KEYS[l.key])
    // A new id-bearing field: add its key to OBJECT_REF_KEYS / PRINCIPAL_REF_KEYS in lib/apps/references.ts.
    expect(unknown.map((l) => l.path)).toEqual([])
  })

  it.each(schemas)('%s: every page slug field is a known page link key', (_name, schema) => {
    const unknown = idLeaves(schema).filter((l) => l.kind === 'slug' && !PAGE_REF_KEYS.includes(l.key) && l.key !== 'slug')
    expect(unknown.map((l) => l.path)).toEqual([])
  })
})

const F = '11111111-1111-4111-8111-111111111111'
const W = '22222222-2222-4222-8222-222222222222'
const T = '33333333-3333-4333-8333-333333333333'
const R = '44444444-4444-4444-8444-444444444444'
const REF = '55555555-5555-4555-8555-555555555555'
const A = '66666666-6666-4666-8666-666666666666'
const TEAM = '77777777-7777-4777-8777-777777777777'
const ROLE = '88888888-8888-4888-8888-888888888888'
const USER = '99999999-9999-4999-8999-999999999999'
const ICON = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const app = {
  icon: `svg:${ICON}`,
  menu: [
    { kind: 'form', label: 'New', form_id: F, open: 'modal', params: { table_id: { from: 'static', value: T } } },
    { kind: 'group', label: 'More', items: [{ kind: 'report', label: 'Report', report_id: R }, { kind: 'url', label: 'Other app', url: '/apps/other-app/home' }], visibility: { app_roles: [], teams: [TEAM], roles: [ROLE] } },
  ],
  settings: { nav: { style: 'tabs' }, access_issues: 2 },
  pages: [
    {
      slug: 'home', title: 'Home', icon: null,
      filters: [{ id: 'wf', kind: 'workflow', label: 'Workflow', default: W }, { id: 'who', kind: 'user', label: 'Who', default: USER }, { id: 'tbl', kind: 'table', label: 'Table' }],
      layout: {
        widgets: [
          { id: 'a', type: 'actions', w: 4, h: 2, config: { buttons: [
            { label: 'Start', action: { kind: 'start_workflow', workflow_id: W } },
            { label: 'Go', icon: `svg:${ICON}`, action: { kind: 'open_page', page_slug: 'detail', filters: { tbl: T, team: TEAM } } },
            { label: 'Pick', action: { kind: 'set_filter', filter: 'wf', value: W } },
          ] } },
          { id: 'b', type: 'card_view', w: 6, h: 4, config: { source: 'reference', reference_id: REF, reference_inputs: { form_id: 'literal' }, template: { title: 'name', fields: [{ key: 'x', icon: `svg:${ICON}` }] } } },
          { id: 'c', type: 'agent_chat', w: 4, h: 4, config: { agent_id: A } },
          { id: 'd', type: 'data_grid', w: 12, h: 6, config: { table_id: { filter: 'tbl' } } },
          { id: 'e', type: 'embed', w: 6, h: 4, config: { url: 'https://example.com/dash?x=1' } },
          { id: 'f', type: 'tabs', w: 12, h: 6, config: { tabs: [{ label: 'Form', target: { kind: 'form', form_id: F } }, { label: 'Site', target: { kind: 'url', url: 'https://docs.example.org/a' } }, { label: 'Gone', target: { kind: 'page', page_slug: 'missing' } }] } },
          { id: 'g', type: 'task_list', w: 6, h: 4, config: { team: TEAM, assignee: 'me' } },
        ],
      },
    },
    { slug: 'detail', title: 'Detail', filters: [{ id: 'tbl', kind: 'table', label: 'Table' }, { id: 'team', kind: 'team', label: 'Team' }], layout: { widgets: [] } },
  ],
}

describe('collectAppReferences', () => {
  const ids = appReferenceIds(app)
  it('finds objects at any depth', () => {
    expect(ids.form).toEqual([F])
    expect(ids.workflow).toEqual([W])
    expect(ids.data_table).toEqual([T])
    expect(ids.report).toEqual([R])
    expect(ids.reference).toEqual([REF])
    expect(ids.agent).toEqual([A])
  })
  it('types literal filter values by the target filter (pass-through filters, set_filter, defaults)', () => {
    const refs = collectAppReferences(app)
    expect(refs.find((r) => r.kind === 'data_table')?.path).toEqual(['pages', 0, 'layout', 'widgets', 0, 'config', 'buttons', 1, 'action', 'filters', 'tbl'])
    expect(refs.filter((r) => r.kind === 'workflow').length).toBe(3) // button, set_filter value, filter default
  })
  it('does not treat parameter names or reference inputs as config keys', () => {
    expect(collectAppReferences(app).some((r) => r.path.includes('params') || r.path.includes('reference_inputs'))).toBe(false)
  })
  it('reports people, pages, other apps and uploaded icons', () => {
    expect(ids.team).toEqual([TEAM])
    expect(ids.role).toEqual([ROLE])
    expect(ids.user).toEqual([USER])
    expect(ids.icon).toEqual([ICON])
    expect(ids.app).toEqual(['other-app'])
    expect(ids.page.sort()).toEqual(['detail', 'missing'])
    expect(brokenPageLinks(app).map((r) => r.id)).toEqual(['missing'])
  })
  it('skips filter-bound inputs', () => {
    expect(collectAppReferences(app).some((r) => r.path.join('.').includes('widgets.3'))).toBe(false)
  })
  it('lists embed origins', () => {
    expect(appEmbedOrigins(app)).toEqual(['https://docs.example.org', 'https://example.com'])
  })
})

describe('rewriteAppReferences', () => {
  const NEW = (s: string) => s.replace(/^./, 'f')
  const out = rewriteAppReferences(app, (ref) => {
    if (['form', 'workflow', 'data_table', 'report', 'reference', 'agent', 'icon'].includes(ref.kind)) return NEW(ref.id)
    if (ref.kind === 'app') return 'other-app-2'
    if (ref.kind === 'team' || ref.kind === 'role' || ref.kind === 'user') return null
    return undefined
  })
  it('maps every object and icon, leaving no source id behind', () => {
    const text = JSON.stringify(out)
    for (const id of [F, W, R, REF, A, ICON]) expect(text).not.toContain(id)
    expect(out.icon).toBe(`svg:${NEW(ICON)}`)
    expect((out.pages![0].layout as any).widgets[0].config.buttons[1].action.filters.tbl).toBe(NEW(T))
  })
  it('keeps non-reference config untouched', () => {
    expect((out.pages![0].layout as any).widgets[1].config.reference_inputs).toEqual({ form_id: 'literal' })
    expect((out.menu as any)[0].params).toEqual({ table_id: { from: 'static', value: T } })
    expect((out.pages![0].layout as any).widgets[3].config.table_id).toEqual({ filter: 'tbl' })
  })
  it('drops people (lists lose the entry, scalars become null) and rewrites app links', () => {
    expect((out.menu as any)[1].visibility).toEqual({ app_roles: [], teams: [], roles: [] })
    expect((out.pages![0].layout as any).widgets[6].config.team).toBeNull()
    expect((out.pages![0].filters as any)[1].default).toBeNull()
    expect((out.menu as any)[1].items[1].url).toBe('/apps/other-app-2/home')
  })
  it('does not mutate the input', () => {
    expect(app.icon).toBe(`svg:${ICON}`)
  })
})
