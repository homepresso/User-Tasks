/**
 * App shell (docs/design/ui-polish-spec.md §4, Workstream B): the side menu's
 * Build / Operate / Govern grouping, route breadcrumbs and tab titles, the
 * notifications day groups, toast timing, the ⌘K palette's create actions
 * and the 240px / 48px chrome defaults.
 */
import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, NAV_ITEMS, NAV_ITEMS_ADMIN, NAV_ITEMS_WORKFLOW, NAV_PRIMARY, NAV_SETTINGS } from '@/lib/constants'
import { APP_NAME, documentTitle, pageMetadata, pageTitle, routeBreadcrumbs, routeLabel, ROUTES, titlePartsFromCrumbs } from '@/lib/page-title'
import { visiblePageShortcuts } from '@/lib/search/pages'
import { themeVars } from '@/lib/theme/to-css'
import { defaultWorkspaceTheme } from '@/lib/theme/presets'
import { CREATE_ACTIONS } from '@/components/layout/create-actions'
import { groupNotificationsByDay } from '@/components/layout/notification-bell'
import { toastTimeout } from '@/components/jobs/jobs-provider'

describe('side menu', () => {
  const grouped = [...NAV_PRIMARY, ...NAV_GROUPS.flatMap((g) => g.items), NAV_SETTINGS].map((i) => i.href)

  it('groups by job: primary items, then Build / Operate / Govern, Settings pinned', () => {
    expect(NAV_PRIMARY.map((i) => i.label)).toEqual(['Home', 'My tasks', 'My team', 'Task tracker', 'My forms'])
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Build', 'Operate', 'Govern'])
    expect(NAV_GROUPS[0].items.map((i) => i.label)).toEqual(['Workflows', 'Forms', 'Data', 'Integrations', 'Agents', 'Email templates'])
    expect(NAV_GROUPS[1].items.map((i) => i.label)).toEqual(['Queue', 'Schedules', 'Activity', 'Reports'])
    expect(NAV_GROUPS[2].items.map((i) => i.label)).toEqual(['Business rules', 'Retention', 'Packages', 'Extensibility', 'Organization', 'Team', 'MCP access'])
    expect(NAV_SETTINGS.href).toBe('/settings')
  })

  it('keeps every destination (URLs unchanged), each exactly once', () => {
    const all = [...NAV_ITEMS, ...NAV_ITEMS_WORKFLOW, ...NAV_ITEMS_ADMIN].map((i) => i.href)
    expect([...grouped].sort()).toEqual([...all].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('labels are sentence case', () => {
    for (const item of [...NAV_ITEMS, ...NAV_ITEMS_WORKFLOW, ...NAV_ITEMS_ADMIN]) {
      expect(item.label.slice(1)).not.toMatch(/ [A-Z][a-z]/)
    }
  })
})

describe('page titles and breadcrumbs', () => {
  it('joins parts most specific first, with the product last', () => {
    expect(pageTitle('Invoice approval', 'Workflows')).toBe('Invoice approval · Workflows')
    expect(pageTitle(null, '', 'Data')).toBe('Data')
    expect(pageMetadata('Workflows')).toEqual({ title: 'Workflows' })
    expect(documentTitle(['Invoice approval', 'Workflows'])).toBe(`Invoice approval · Workflows · ${APP_NAME}`)
    expect(documentTitle(['Home'], 3)).toBe('(3) Home · UserTasks')
    expect(documentTitle(['Home'], 250)).toBe('(99+) Home · UserTasks')
  })

  it('derives the trail from the route', () => {
    expect(routeBreadcrumbs('/automations')).toEqual([{ label: 'Workflows' }])
    expect(routeBreadcrumbs('/automations/abc/runs')).toEqual([
      { label: 'Workflows', href: '/automations' },
      { label: 'Workflow', href: '/automations/abc' },
      { label: 'Runs' },
    ])
    expect(routeBreadcrumbs('/automations/runs/r1')).toEqual([{ label: 'Workflows', href: '/automations' }, { label: 'Run' }])
    // Sections that live under another section's URL start their own trail.
    expect(routeBreadcrumbs('/automations/forms')).toEqual([{ label: 'Forms' }])
    // The form designer page (and a new form) sit under the Forms library, not under Workflows.
    expect(routeBreadcrumbs('/automations/forms/f1')).toEqual([{ label: 'Forms', href: '/automations/forms' }, { label: 'Form' }])
    expect(routeBreadcrumbs('/automations/forms/new')).toEqual([{ label: 'Forms', href: '/automations/forms' }, { label: 'New form' }])
    expect(routeBreadcrumbs('/automations/rules/r1')).toEqual([{ label: 'Business rules', href: '/automations/rules' }, { label: 'Business rule' }])
    expect(routeBreadcrumbs('/tasks/t1')).toEqual([{ label: 'My tasks', href: '/tasks' }, { label: 'Task' }])
    expect(routeBreadcrumbs('/settings/governance', 'tab=retention')).toEqual([
      { label: 'Settings', href: '/settings' },
      { label: 'Governance', href: '/settings/governance' },
      { label: 'Retention policies' },
    ])
    expect(routeBreadcrumbs('/nope')).toEqual([])
    expect(titlePartsFromCrumbs(routeBreadcrumbs('/agents/a1/runs/r1'))).toEqual(['Run', 'Runs', 'Agent'])
  })

  it('names every dashboard page (unique tab titles)', () => {
    const pages = ROUTES.filter((r) => !r.hidden)
    const titles = pages.filter((r) => !r.pattern.includes('[id]')).map((r) => documentTitle(titlePartsFromCrumbs(routeBreadcrumbs(r.pattern))))
    expect(new Set(titles).size).toBe(titles.length)
    for (const r of pages) expect(routeLabel(r.pattern.replace(/\[id\]/g, 'x1'))).toBeTruthy()
  })
})

describe('notifications panel', () => {
  it('groups into Today and Earlier, keeping order and dropping empty groups', () => {
    const now = new Date('2026-11-04T15:00:00')
    const items = [
      { id: 'a', created_at: '2026-11-04T14:00:00' },
      { id: 'b', created_at: '2026-11-04T00:30:00' },
      { id: 'c', created_at: '2026-11-03T23:59:00' },
    ]
    expect(groupNotificationsByDay(items, now).map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([['Today', ['a', 'b']], ['Earlier', ['c']]])
    expect(groupNotificationsByDay(items.slice(2), now).map((g) => g.label)).toEqual(['Earlier'])
  })
})

describe('toasts', () => {
  it('5s, 8s with an action; running jobs and errors stay', () => {
    expect(toastTimeout({ tone: 'success', timeout: 0 }, { running: false, hasAction: false })).toBe(5_000)
    expect(toastTimeout({ tone: 'success', timeout: 0 }, { running: false, hasAction: true })).toBe(8_000)
    expect(toastTimeout({ tone: 'info', timeout: 0 }, { running: true, hasAction: true })).toBe(0)
    expect(toastTimeout({ tone: 'error', timeout: 0 }, { running: false, hasAction: true })).toBe(0)
    expect(toastTimeout({ tone: 'info', timeout: 3_000 }, { running: false, hasAction: false })).toBe(3_000)
  })
})

describe('create actions and palette pages', () => {
  it('each create action is permission-gated and goes to an existing page', () => {
    expect(CREATE_ACTIONS.map((a) => a.id)).toEqual(['task', 'workflow', 'form_wizard', 'form', 'table', 'report'])
    for (const a of CREATE_ACTIONS) {
      expect(a.requires).toBeTruthy()
      expect(routeLabel(a.href.split('?')[0])).toBeTruthy()
    }
  })

  it('page shortcuts follow the permissions', () => {
    expect(visiblePageShortcuts([]).some((p) => p.href === '/settings/api-keys')).toBe(false)
    expect(visiblePageShortcuts(['workflows.view']).some((p) => p.href === '/automations')).toBe(true)
  })
})

describe('chrome sizes', () => {
  it('sidebar 240px and top bar 48px; the old untouched defaults follow, a chosen size wins', () => {
    const t = defaultWorkspaceTheme()
    expect(t.layout.sidebarWidth).toBe(240)
    expect(t.layout.topbarHeight).toBe(48)
    t.layout.sidebarWidth = 256
    t.layout.topbarHeight = 56
    expect(themeVars(t, 'light')['--theme-sidebar-width']).toBe('240px')
    expect(themeVars(t, 'light')['--theme-topbar-height']).toBe('48px')
    t.layout.sidebarWidth = 280
    t.layout.topbarHeight = 60
    expect(themeVars(t, 'light')['--theme-sidebar-width']).toBe('280px')
    expect(themeVars(t, 'light')['--theme-topbar-height']).toBe('60px')
  })
})
