/**
 * The Forms dropdown at the top of the side menu
 * (components/layout/header-forms-menu.tsx) and the workspace switcher that
 * moved to the avatar menu (components/layout/workspace-switcher.tsx):
 *
 * - search thresholds: the dropdown searches with 10 or more forms, the
 *   sidebar's Forms item with more than 10 (unchanged);
 * - the "Forms" trigger (menu button semantics) and the empty state;
 * - the switcher still lists every workspace and switches.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/tasks' }))
vi.mock('@/app/actions/session', () => ({ switchWorkspace: vi.fn(async () => ({ ok: true, data: null })) }))
vi.mock('@/lib/get-user-id', () => ({ clearCurrentTenantCache: vi.fn() }))

import {
  AVAILABLE_FORMS_SEARCH_THRESHOLD, HEADER_FORMS_SEARCH_MIN, SIDEBAR_FORMS_SEARCH_MIN, showsAvailableFormsSearch, type AvailableForm,
} from '@/lib/forms/available-forms'
import { AvailableFormsList } from '@/components/layout/available-forms-menu'
import { HEADER_FORMS_EMPTY_TEXT, HeaderFormsMenu, HeaderFormsPanelBody, HeaderFormsTrigger } from '@/components/layout/header-forms-menu'
import { WorkspaceMenuItems } from '@/components/layout/workspace-switcher'
import { PermissionsProvider } from '@/lib/permissions-context'
import { performWorkspaceSwitch, workspaceMenuEntries } from '@/lib/workspace-memberships'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

const forms = (n: number): AvailableForm[] => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `Form ${String(i).padStart(2, '0')}`, description: null }))
const wrap = (el: any, client = new QueryClient()) => renderToStaticMarkup(createElement(QueryClientProvider, { client }, el))

describe('search thresholds', () => {
  it('the Forms dropdown searches with 10 or more; the sidebar item with more than 10', () => {
    expect(HEADER_FORMS_SEARCH_MIN).toBe(10)
    expect(SIDEBAR_FORMS_SEARCH_MIN).toBe(AVAILABLE_FORMS_SEARCH_THRESHOLD + 1)
    expect(showsAvailableFormsSearch(9, HEADER_FORMS_SEARCH_MIN)).toBe(false)
    expect(showsAvailableFormsSearch(10, HEADER_FORMS_SEARCH_MIN)).toBe(true)
    // The sidebar's rule is the default and is unchanged.
    expect(showsAvailableFormsSearch(10)).toBe(false)
    expect(showsAvailableFormsSearch(11)).toBe(true)
  })

  it('the dropdown shows the search box at exactly 10 forms, not at 9', () => {
    const nine = wrap(createElement(HeaderFormsPanelBody, { forms: forms(9), onClose: () => {} }))
    expect(nine).not.toContain('role="combobox"')
    expect(nine).toContain('role="listbox"')
    expect(nine.match(/role="option"/g)).toHaveLength(9)
    // Without the search box the listbox itself takes focus and tracks the highlighted option.
    expect(nine).toMatch(/role="listbox"[^>]*tabindex="0"/)
    expect(nine).toContain('aria-activedescendant=')

    const ten = wrap(createElement(HeaderFormsPanelBody, { forms: forms(10), onClose: () => {} }))
    expect(ten).toContain('role="combobox"')
    expect(ten).toContain('placeholder="Search 10 forms"')
    expect(ten.match(/role="option"/g)).toHaveLength(10)
  })

  it('the sidebar list keeps its own rule: plain list at 10, search at 11', () => {
    const ten = wrap(createElement(AvailableFormsList, { forms: forms(10), variant: 'sidebar' }))
    expect(ten).not.toContain('role="combobox"')
    expect(ten).not.toContain('role="listbox"')
    expect(ten).toContain('data-available-forms-list')
    const eleven = wrap(createElement(AvailableFormsList, { forms: forms(11), variant: 'sidebar' }))
    expect(eleven).toContain('role="combobox"')
  })

  it('lists forms in the order given (the RPC / service sorts them) and links to their pages', () => {
    const html = wrap(createElement(HeaderFormsPanelBody, { forms: forms(3), onClose: () => {} }))
    expect(html.indexOf('Form 00')).toBeLessThan(html.indexOf('Form 01'))
    expect(html).toContain('href="/fill/f0"')
  })
})

describe('the Forms trigger and the empty state', () => {
  it('reads "Forms" and is a popup button (aria-haspopup, aria-expanded)', () => {
    const closed = renderToStaticMarkup(createElement(HeaderFormsTrigger, { open: false, collapsed: false, panelId: 'p', count: 3, onClick: () => {} }))
    expect(closed).toContain('>Forms<')
    expect(closed).toContain('aria-haspopup="dialog"')
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).not.toContain('aria-controls')
    const open = renderToStaticMarkup(createElement(HeaderFormsTrigger, { open: true, collapsed: false, panelId: 'p', count: 3, onClick: () => {} }))
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('aria-controls="p"')
  })

  it('collapsed: icon only, named by aria-label', () => {
    const html = renderToStaticMarkup(createElement(HeaderFormsTrigger, { open: false, collapsed: true, panelId: 'p', count: 4, onClick: () => {} }))
    expect(html).not.toContain('>Forms<')
    expect(html).toContain('aria-label="Forms (4)"')
  })

  it('no available forms: a friendly empty state (and a loading line while loading)', () => {
    const empty = wrap(createElement(HeaderFormsPanelBody, { forms: [], onClose: () => {} }))
    expect(empty).toContain(HEADER_FORMS_EMPTY_TEXT)
    expect(empty).toContain('role="status"')
    expect(empty).not.toContain('role="listbox"')
    const loading = wrap(createElement(HeaderFormsPanelBody, { forms: [], loading: true, onClose: () => {} }))
    expect(loading).toContain('Loading forms')
  })

  it('the control always renders, even for someone who cannot submit forms', () => {
    const html = wrap(createElement(PermissionsProvider, { permissions: [], userId: 'u1', children: createElement(HeaderFormsMenu, {}) } as any))
    expect(html).toContain('data-header-forms-trigger')
    expect(html).toContain('>Forms<')
  })
})

const membership = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id: `m-${id}`, user_id: 'u1', tenant_id: id, is_active: true, is_home: false, tenant: { id, name, slug: id, branding: {} }, ...extra }) as any

describe('the workspace switcher (avatar menu)', () => {
  const memberships = [membership('t1', 'Northwind', { is_home: true }), membership('t2', 'Acme Corp', { tenant: { id: 't2', name: 'Acme Corp', slug: 'acme', branding: { primary_color: '#123456' } } }), { id: 'gone', tenant: null } as any]

  it('lists All organizations then every readable workspace, marking the current one', () => {
    const entries = workspaceMenuEntries(memberships, 't2')
    expect(entries.map((e) => e.name)).toEqual(['All organizations', 'Northwind', 'Acme Corp'])
    expect(entries.map((e) => e.current)).toEqual([false, false, true])
    expect(entries[1]).toMatchObject({ tenantId: 't1', isHome: true, initials: 'N' })
    expect(entries[2]).toMatchObject({ initials: 'AC', color: '#123456' })
    expect(workspaceMenuEntries(memberships, null)[0].current).toBe(true)
    expect(workspaceMenuEntries(undefined, null)).toHaveLength(1)
  })

  it('switching calls switch_tenant, then clears the caches and refreshes', async () => {
    const calls: string[] = []
    const ok = await performWorkspaceSwitch('t2', {
      switchWorkspace: async (id) => { calls.push(`switch:${id}`); return { ok: true } },
      clearCurrentTenantCache: () => { calls.push('clear') },
      invalidateQueries: async () => { calls.push('invalidate') },
      refreshProfile: async () => { calls.push('profile') },
      refresh: () => { calls.push('refresh') },
    })
    expect(ok).toBe(true)
    expect(calls).toEqual(['switch:t2', 'clear', 'invalidate', 'profile', 'refresh'])
  })

  it('a refused switch changes nothing', async () => {
    const refresh = vi.fn()
    const ok = await performWorkspaceSwitch(null, {
      switchWorkspace: async () => ({ ok: false }), clearCurrentTenantCache: vi.fn(), invalidateQueries: vi.fn(async () => {}), refresh,
    })
    expect(ok).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('renders every workspace as a menu item in the avatar menu', () => {
    const client = new QueryClient()
    client.setQueryData(['memberships'], memberships)
    const html = wrap(createElement(DropdownMenu.Root, { open: true, modal: false },
      createElement(DropdownMenu.Trigger, {}, 'me'),
      createElement(DropdownMenu.Content, {}, createElement(WorkspaceMenuItems, { currentTenantId: 't1' }))), client)
    expect(html).toContain('Workspaces')
    expect(html).toContain('data-workspace-option="all"')
    expect(html).toContain('data-workspace-option="t1"')
    expect(html).toContain('data-workspace-option="t2"')
    expect(html).toMatch(/data-workspace-option="t1"[^>]*>|aria-current="true"[^>]*data-workspace-option="t1"/)
    expect(html.match(/role="menuitem"/g)).toHaveLength(3)
  })
})
