/**
 * System role defaults (governance audit 2026-11, docs/governance/audit-2026-11.md):
 * the TS sets (lib/tenant-provisioning, which the docs table is generated
 * from) equal the SQL seed (the latest seed_tenant_roles migration), and each
 * role stays inside its intent — a Viewer is a read-only consumer, a Member
 * does work but builds nothing, the break-glass permission is Owner only.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SYSTEM_ROLES } from '@/lib/tenant-provisioning'
import { expandPermissions, holdsPermission, PERMISSION_GROUPS, PERMISSION_KEYS } from '@/lib/permissions'

const MIGRATIONS = path.resolve(__dirname, '../supabase/migrations')
const roles = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.slug, new Set<string>(r.permissions)]))

/** Areas a read-only consumer must never get: design, build and admin. */
const BUILD_AND_ADMIN = PERMISSION_KEYS.filter((p) =>
  /\.(create|edit|edit_schema|delete|activate|manage_runs|manage_references|test|install|manage|deploy|share|invite|remove|change_roles|manage_api_keys|manage_webhooks|complete_any)$/.test(p)
  || ['workflows.view', 'workflows.view_runs', 'forms.view', 'agents.view', 'integrations.view', 'extensibility.view', 'settings.view', 'sync.view', 'observability.view', 'packages.view', 'tasks.view_all'].includes(p),
)

/** The arrays of the latest seed_tenant_roles definition. */
function sqlSeed(): Record<string, string[]> {
  const file = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /CREATE OR REPLACE FUNCTION public\.seed_tenant_roles/.test(readFileSync(path.join(MIGRATIONS, f), 'utf8'))).pop()!
  const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8')
  const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.seed_tenant_roles'))
  const arr = (name: string) => {
    const m = body.match(new RegExp(`${name} text\\[\\] := ([^;]+);`))
    if (!m) throw new Error(`no ${name} in ${file}`)
    return m[1]
  }
  const list = (expr: string) => [...expr.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((x) => x[1])
  const all = list(arr('v_all'))
  const viewer = list(arr('v_viewer'))
  const owner = [...all, ...list(arr('v_owner').replace('v_all', ''))]
  // The Admin row names the array it is seeded with (v_all or v_owner).
  const adminVar = body.match(/'admin',\s*'Full administrative access',\s*(v_[a-z]+)/)?.[1]
  return {
    owner,
    admin: adminVar === 'v_owner' ? owner : all,
    manager: list(arr('v_manager')),
    viewer,
    member: [...viewer, ...list(arr('v_member').replace('v_viewer', ''))],
  }
}

describe('system role defaults', () => {
  it('lib/tenant-provisioning matches the SQL seed (seed_tenant_roles) for every system role', () => {
    const seed = sqlSeed()
    for (const role of SYSTEM_ROLES) expect([...role.permissions].sort(), role.slug).toEqual([...new Set(seed[role.slug])].sort())
  })

  it('every default is a catalogue permission, shown in the role editor', () => {
    const grouped = new Set(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key)))
    for (const role of SYSTEM_ROLES) for (const p of role.permissions) {
      expect(PERMISSION_KEYS as readonly string[]).toContain(p)
      expect(grouped.has(p), p).toBe(true)
    }
    expect([...grouped].sort()).toEqual([...PERMISSION_KEYS].sort())
  })

  it('Viewer: a read-only consumer — no build, design or admin permission', () => {
    expect([...roles.viewer].filter((p) => BUILD_AND_ADMIN.includes(p as never))).toEqual([])
    expect(roles.viewer.has('forms.wizard')).toBe(false)
    expect([...roles.viewer].sort()).toEqual(['data.view', 'forms.submit', 'org.view', 'projects.view', 'reports.view', 'tasks.complete', 'tasks.view_own', 'team.view_members'])
  })

  it('Member: does work (own tasks, rows, own reports, involved queue, own wizard forms) and builds nothing else', () => {
    const extra = [...roles.member].filter((p) => !roles.viewer.has(p)).sort()
    expect(extra).toEqual(['data.manage_rows', 'forms.wizard', 'reports.create', 'reports.edit_own', 'tasks.assign', 'tasks.create', 'workflows.view_queue'])
    // Doing work, not building: forms.wizard (20261229000000) makes only the wizard's own objects, owned by the member.
    const work = ['tasks.create', 'reports.create', 'reports.edit_own', 'forms.wizard']
    expect([...roles.member].filter((p) => BUILD_AND_ADMIN.includes(p as never) && !work.includes(p))).toEqual([])
  })

  it('Manager builds and oversees but does not administer people, roles, credentials or settings', () => {
    for (const p of ['team.change_roles', 'team.remove', 'settings.edit', 'settings.manage_api_keys', 'settings.manage_webhooks', 'org.manage', 'observability.view', 'tasks.complete_any']) {
      expect(roles.manager.has(p), p).toBe(false)
    }
    for (const p of ['workflows.create', 'forms.edit', 'data.create', 'tasks.view_all', 'projects.manage', 'workflows.view_runs']) expect(roles.manager.has(p), p).toBe(true)
  })

  it('Admin and Owner have every permission (incl. acting on behalf on any task)', () => {
    expect([...PERMISSION_KEYS].filter((p) => !roles.admin.has(p))).toEqual([])
    expect([...PERMISSION_KEYS].filter((p) => !roles.owner.has(p))).toEqual([])
  })

  it('view_runs implies view_queue (sessions, keys, tokens, MCP) without editing custom roles', () => {
    expect(expandPermissions(['workflows.view_runs'])).toEqual(['workflows.view_runs', 'workflows.view_queue'])
    expect(holdsPermission(new Set(['workflows.view_runs']), 'workflows.view_queue')).toBe(true)
    expect(holdsPermission(new Set(['workflows.view_queue']), 'workflows.view_runs')).toBe(false)
  })
})
