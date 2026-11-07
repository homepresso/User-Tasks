/**
 * Page guards (lib/route-permissions) and the side menu per system role
 * (governance audit 2026-11). Every app/(dashboard) page matches a guard rule
 * or is a deliberately open page with a reason; a Viewer opens none of the
 * build / design / admin pages; the menu never shows a Viewer or a Member a
 * Build or Govern heading.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canAccessPath, OPEN_ROUTES, ROUTE_RULES } from '@/lib/route-permissions'
import { NAV_PRIMARY, NAV_SETTINGS, resolveNavGroups, type NavEntry } from '@/lib/constants'
import { SYSTEM_ROLES } from '@/lib/tenant-provisioning'
import { expandPermissions, type Permission } from '@/lib/permissions'
import { hasExtensibilityFeatureAccess } from '@/lib/extensibility-access'

const DASHBOARD = path.resolve(__dirname, '../app/(dashboard)')

/** Every page route under app/(dashboard), as its URL pattern (/automations/[id]). */
function dashboardPages(dir = DASHBOARD, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name.startsWith('_') || name.startsWith('@')) continue
      const seg = name.startsWith('(') ? '' : `/${name}`
      out.push(...dashboardPages(p, prefix + seg))
    } else if (name === 'page.tsx') out.push(prefix || '/')
  }
  return out.sort()
}

const sample = (route: string) => route.replace(/\[[^\]]+\]/g, '0a000000-0000-4000-8000-000000000001')
const hasRule = (route: string) => ROUTE_RULES.some((r) => route === r.prefix || route.startsWith(`${r.prefix}/`))
  || route.startsWith('/extensibility')
const perms = (slug: string) => expandPermissions(SYSTEM_ROLES.find((r) => r.slug === slug)!.permissions)

describe('page guards', () => {
  const pages = dashboardPages()

  it('finds the dashboard pages', () => {
    expect(pages.length).toBeGreaterThan(50)
    expect(pages).toContain('/automations/queue')
  })

  it('every page has a guard rule or is a deliberately open page (with a reason)', () => {
    const unguarded = pages.filter((p) => !hasRule(p) && !OPEN_ROUTES[p])
    expect(unguarded).toEqual([])
    for (const [route, reason] of Object.entries(OPEN_ROUTES)) {
      expect(reason.length, route).toBeGreaterThan(20)
      expect(pages, `${route} is listed as open but is not a page`).toContain(route)
    }
  })

  it('open pages really have no rule (an allowlist entry never hides a guard)', () => {
    for (const route of Object.keys(OPEN_ROUTES)) {
      if (route === '/agents/[id]/runs/[runId]') continue // matched by the explicit run-page exception
      expect(hasRule(route), route).toBe(false)
    }
  })

  const BUILD_OR_ADMIN = [
    '/automations', '/automations/[id]', '/automations/forms', '/automations/rules', '/automations/schedules', '/automations/email-templates',
    '/integrations', '/agents', '/extensibility', '/packages', '/activity', '/settings/governance', '/settings/api-keys',
    '/settings/oauth-apps', '/settings/webhooks', '/settings/mcp', '/settings/logs', '/settings/log-export', '/settings/sso',
    '/settings/github-sync', '/settings/theme', '/settings/document-ocr', '/settings/packages', '/settings/invitations',
    '/org/manage', '/tasks/assigned', '/reports/tasks', '/reports/workflows', '/reports/integrations', '/reports/business-rules',
    '/reports/retention', '/automations/queue', '/automations/runs/[id]',
  ]

  it('a Viewer opens none of the build, design or admin pages', () => {
    const viewer = perms('viewer')
    expect(BUILD_OR_ADMIN.filter((r) => canAccessPath(sample(r), viewer))).toEqual([])
  })

  it('a Viewer still opens Home, own tasks, forms they are given, reports, data and the people directory', () => {
    const viewer = perms('viewer')
    for (const r of ['/home', '/tasks', '/tasks/[id]', '/fill/[id]', '/reports', '/reports/[id]', '/data', '/data/[id]', '/org', '/team', '/settings']) {
      expect(canAccessPath(sample(r), viewer), r).toBe(true)
    }
    expect(canAccessPath('/reports/builder', viewer)).toBe(false)
    expect(canAccessPath('/tasks/new', viewer)).toBe(false)
  })

  it('a Member opens the queue and run pages (involved-only, scoped server-side) but no build page', () => {
    const member = perms('member')
    expect(canAccessPath('/automations/queue', member)).toBe(true)
    expect(canAccessPath(sample('/automations/runs/[id]'), member)).toBe(true)
    expect(canAccessPath('/reports/builder', member)).toBe(true)
    expect(BUILD_OR_ADMIN.filter((r) => canAccessPath(sample(r), member))).toEqual(['/automations/queue', '/automations/runs/[id]'])
  })

  it('Owner opens every guarded page', () => {
    const owner = perms('owner')
    expect(pages.filter((p) => hasRule(p) && !canAccessPath(sample(p), owner))).toEqual([])
  })
})

/** The sidebar's visibility rule (components/layout/sidebar.tsx), outside React. */
function menuFor(slug: string) {
  const set = new Set(perms(slug))
  const has = (p: Permission) => set.has(p)
  const visible = (item: NavEntry) => {
    if (item.href === '/extensibility') return hasExtensibilityFeatureAccess(set)
    if ('managerOnly' in item && item.managerOnly) return false
    return !('requiredPermission' in item) || !item.requiredPermission || has(item.requiredPermission as Permission)
  }
  return {
    primary: NAV_PRIMARY.filter(visible).map((i) => i.label),
    groups: Object.fromEntries(resolveNavGroups(has, visible).map((g) => [g.label, g.items.map((i) => i.label)])),
    settings: visible(NAV_SETTINGS),
  }
}

describe('side menu per system role', () => {
  it('Viewer: no Build, no Govern, no Settings — data under Operate, the directory under People', () => {
    expect(menuFor('viewer')).toEqual({
      primary: ['Home', 'My tasks'],
      groups: { Operate: ['Data', 'Reports'], People: ['Organization', 'Team'] },
      settings: false,
    })
  })

  it('Member: the same plus their queue and the forms they build with the wizard; still no Build or Govern', () => {
    expect(menuFor('member')).toEqual({
      primary: ['Home', 'My tasks', 'My forms'],
      groups: { Operate: ['Data', 'Queue', 'Reports'], People: ['Organization', 'Team'] },
      settings: false,
    })
  })

  it('Manager: Build and the tracker; Govern only for what they manage', () => {
    const m = menuFor('manager')
    expect(m.primary).toEqual(['Home', 'My tasks', 'Task tracker', 'My forms'])
    expect(m.groups.Build).toEqual(['Workflows', 'Forms', 'Data', 'Integrations', 'Agents', 'Email templates'])
    expect(m.groups.Govern).not.toContain('Retention')
    expect(m.settings).toBe(true)
  })

  it('Owner: every group', () => {
    expect(Object.keys(menuFor('owner').groups)).toEqual(['Build', 'Operate', 'Govern'])
  })
})
