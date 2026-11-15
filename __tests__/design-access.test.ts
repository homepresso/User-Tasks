/**
 * Object-level design access (lib/services/design-access.ts): the role
 * permission, or an explicit Edit grant on that one workflow / form — for the
 * person directly, a role they hold or a team of the workspace — and only for
 * people signed in (API keys / OAuth keep their scopes). View grants, grants
 * on other objects or in other workspaces don't count. The designer's writes
 * (save, restore, test runs, form drafts) use it; publishing does not.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- query builder fake */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canDesignObject, holdsEditGrant, requireDesignAccess } from '@/lib/services/design-access'
import type { ServiceContext } from '@/lib/services/context'

const T = '11111111-1111-4111-8111-111111111111'
const OTHER_T = '22222222-2222-4222-8222-222222222222'
const U = '33333333-3333-4333-8333-333333333333'
const WF = '44444444-4444-4444-8444-444444444444'
const WF2 = '55555555-5555-4555-8555-555555555555'
const ROLE = '66666666-6666-4666-8666-666666666666'
const TEAM = '77777777-7777-4777-8777-777777777777'

type Row = Record<string, unknown>

/** A tiny in-memory stand-in for the query builder: from().select().eq().in() → { data, error }. */
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      const q: any = {
        select: () => q,
        eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return q },
        in: (col: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[col])); return q },
        then: (resolve: (v: unknown) => void) => resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }),
      }
      return q
    },
  }
}

function grant(extra: Row): Row {
  return { tenant_id: T, object_type: 'workflow', object_id: WF, user_id: null, role_id: null, team_id: null, can_view: true, can_edit: true, ...extra }
}

function ctx(db: unknown, over: Partial<ServiceContext> = {}): ServiceContext {
  return { supabase: db, db, tenantId: T, actorId: U, permissions: new Set(['workflows.view', 'forms.view']), authKind: 'session', source: 'ui', ...over } as unknown as ServiceContext
}

describe('holdsEditGrant', () => {
  it('a grant to the person, a role they hold in the workspace, or a team of the workspace', async () => {
    const base = { user_roles: [{ tenant_id: T, user_id: U, role_id: ROLE }], user_teams: [{ user_id: U, team_id: TEAM }], teams: [{ id: TEAM, tenant_id: T }] }
    expect(await holdsEditGrant(fakeDb({ ...base, object_permissions: [grant({ user_id: U })] }), T, U, 'workflow', WF)).toBe(true)
    expect(await holdsEditGrant(fakeDb({ ...base, object_permissions: [grant({ role_id: ROLE })] }), T, U, 'workflow', WF)).toBe(true)
    expect(await holdsEditGrant(fakeDb({ ...base, object_permissions: [grant({ team_id: TEAM })] }), T, U, 'workflow', WF)).toBe(true)
  })

  it('not: View only, another object, another type, another workspace, a team of another workspace, a role held elsewhere', async () => {
    const roles = { user_roles: [{ tenant_id: OTHER_T, user_id: U, role_id: ROLE }] }
    const cases: Array<Record<string, Row[]>> = [
      { object_permissions: [grant({ user_id: U, can_edit: false })] },
      { object_permissions: [grant({ user_id: U, object_id: WF2 })] },
      { object_permissions: [grant({ user_id: U, object_type: 'form' })] },
      { object_permissions: [grant({ user_id: U, tenant_id: OTHER_T })] },
      { object_permissions: [grant({ team_id: TEAM })], user_teams: [{ user_id: U, team_id: TEAM }], teams: [{ id: TEAM, tenant_id: OTHER_T }] },
      { object_permissions: [grant({ role_id: ROLE })], ...roles },
    ]
    for (const tables of cases) expect(await holdsEditGrant(fakeDb(tables), T, U, 'workflow', WF), JSON.stringify(tables)).toBe(false)
    expect(await holdsEditGrant(fakeDb({ object_permissions: [grant({ user_id: U })] }), T, U, 'workflow', 'not-a-uuid')).toBe(false)
  })
})

describe('canDesignObject / requireDesignAccess', () => {
  const withGrant = fakeDb({ object_permissions: [grant({ user_id: U })] })
  const none = fakeDb({})

  it('the role permission is enough, with or without a grant', async () => {
    expect(await canDesignObject(ctx(none, { permissions: new Set(['workflows.edit']) }), 'workflow', WF)).toBe(true)
    expect(await canDesignObject(ctx(none, { permissions: null }), 'form', WF)).toBe(true)
  })

  it('an Edit grant on this object lets a signed-in person design it, and only it', async () => {
    expect(await canDesignObject(ctx(withGrant), 'workflow', WF)).toBe(true)
    expect(await canDesignObject(ctx(withGrant), 'workflow', WF2)).toBe(false)
    expect(await canDesignObject(ctx(withGrant), 'form', WF)).toBe(false)
    await expect(requireDesignAccess(ctx(none), 'workflow', WF)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(requireDesignAccess(ctx(withGrant), 'workflow', WF)).resolves.toBeUndefined()
  })

  it('API keys and OAuth tokens keep their scopes (no grants)', async () => {
    for (const authKind of ['api_key', 'oauth', 'mcp', 'job', 'anonymous'] as const) {
      expect(await canDesignObject(ctx(withGrant, { authKind }), 'workflow', WF), authKind).toBe(false)
    }
  })
})

describe('where the designers use it', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
  it('save / restore / test runs / form drafts follow the grant; publishing keeps its permission', () => {
    const actions = src('app/actions/automations.ts')
    expect(actions).toMatch(/export async function saveWorkflow\([^)]*\{[^}]*\}\) \{\n {2}await requireWorkflowDesign\(workflowId\)/)
    expect(actions).toMatch(/export async function revertToVersion\(workflowId: string, versionId: string\) \{\n {2}await requireWorkflowDesign\(workflowId\)/)
    expect(src('lib/services/workflow-designer-runs.ts')).toContain("permission === DESIGN_PERMISSION.workflow && await canDesignObject(ctx, 'workflow'")
    const drafts = src('lib/services/form-design-drafts.ts')
    expect(drafts).toMatch(/export async function saveDesignDraft[^\n]*\n {2}await requireDesignAccess\(ctx, 'form', formId\)/)
    expect(drafts).toMatch(/export async function publishDesignDraft[^\n]*\n {2}requirePerm\(ctx, 'forms.edit'\)/)
    expect(src('lib/services/workflows.ts')).toMatch(/await requireDesignAccess\(ctx, 'workflow', workflowId\)\n {2}if \(input.publish\) requirePerm\(ctx, 'workflows.activate'\)/)
  })
})
