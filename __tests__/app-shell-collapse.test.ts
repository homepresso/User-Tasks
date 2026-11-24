/**
 * The UserTasks side menu around apps (lib/apps/shell-collapse.ts): folded on
 * entering an app, the person's own preference restored on leaving, a
 * session-only override per app visit, the app's own opt-out.
 */
import { describe, expect, it } from 'vitest'
import { appPageSwitchPlaceholder, appSlugFromPath, effectiveSidebarCollapsed, reconcileOverride, shellContentKey, toggleShellMenu, type ShellMenuOverride } from '@/lib/apps/shell-collapse'

describe('appSlugFromPath', () => {
  it('finds the app of an app address', () => {
    expect(appSlugFromPath('/apps/hr-desk')).toBe('hr-desk')
    expect(appSlugFromPath('/apps/hr-desk/requests')).toBe('hr-desk')
    expect(appSlugFromPath('/apps/hr-desk/')).toBe('hr-desk')
  })
  it('is null for the Apps list and everything else', () => {
    expect(appSlugFromPath('/apps')).toBeNull()
    expect(appSlugFromPath('/apps/')).toBeNull()
    expect(appSlugFromPath('/tasks')).toBeNull()
    expect(appSlugFromPath('/embed/apps/hr-desk')).toBeNull()
    expect(appSlugFromPath('/application/x')).toBeNull()
    expect(appSlugFromPath(null)).toBeNull()
  })
})

describe('shellContentKey', () => {
  it('gives every page of one app the same key (the app stays mounted)', () => {
    expect(shellContentKey('/apps/hr')).toBe('/apps/hr')
    expect(shellContentKey('/apps/hr/requests')).toBe('/apps/hr')
    expect(shellContentKey('/apps/hr/people')).toBe(shellContentKey('/apps/hr/requests'))
  })
  it('keeps other addresses (and other apps) apart', () => {
    expect(shellContentKey('/apps/crm/home')).not.toBe(shellContentKey('/apps/hr/home'))
    expect(shellContentKey('/tasks/123')).toBe('/tasks/123')
    expect(shellContentKey('/apps')).toBe('/apps')
  })
})

describe('effectiveSidebarCollapsed', () => {
  it('outside apps: the person’s preference', () => {
    expect(effectiveSidebarCollapsed({ preference: false, appSlug: null })).toBe(false)
    expect(effectiveSidebarCollapsed({ preference: true, appSlug: null })).toBe(true)
    // An override never leaks outside its app.
    expect(effectiveSidebarCollapsed({ preference: false, appSlug: null, override: { appSlug: 'hr', collapsed: true } })).toBe(false)
  })
  it('entering an app folds the menu (also before the app has loaded its settings)', () => {
    expect(effectiveSidebarCollapsed({ preference: false, appSlug: 'hr' })).toBe(true)
    expect(effectiveSidebarCollapsed({ preference: false, appSlug: 'hr', autoCollapse: true })).toBe(true)
  })
  it('an app that turned the setting off keeps the preference', () => {
    expect(effectiveSidebarCollapsed({ preference: false, appSlug: 'hr', autoCollapse: false })).toBe(false)
    expect(effectiveSidebarCollapsed({ preference: true, appSlug: 'hr', autoCollapse: false })).toBe(true)
  })
  it('the visit’s override wins inside its own app only', () => {
    const override: ShellMenuOverride = { appSlug: 'hr', collapsed: false }
    expect(effectiveSidebarCollapsed({ preference: false, appSlug: 'hr', override })).toBe(false)
    expect(effectiveSidebarCollapsed({ preference: false, appSlug: 'crm', override })).toBe(true)
  })
})

describe('toggle, leave and restore', () => {
  it('expanding inside an app is a visit override; the preference is untouched', () => {
    const r = toggleShellMenu({ preference: false, appSlug: 'hr' })
    expect(r).toEqual({ preference: false, override: { appSlug: 'hr', collapsed: false } })
    expect(effectiveSidebarCollapsed({ preference: r.preference, appSlug: 'hr', override: r.override })).toBe(false)
    // Collapse again within the same visit.
    const again = toggleShellMenu({ preference: r.preference, appSlug: 'hr', override: r.override })
    expect(again.override).toEqual({ appSlug: 'hr', collapsed: true })
    expect(again.preference).toBe(false)
  })
  it('outside apps the toggle flips the preference', () => {
    expect(toggleShellMenu({ preference: false, appSlug: null })).toEqual({ preference: true, override: null })
    expect(toggleShellMenu({ preference: true, appSlug: null })).toEqual({ preference: false, override: null })
  })
  it('leaving the app forgets the override and restores the previous state; the next visit folds again', () => {
    const preference = false
    const inApp = toggleShellMenu({ preference, appSlug: 'hr' })
    // Leave to My tasks: the override is dropped, the menu is as the person left it.
    const afterLeave = reconcileOverride(inApp.override, null)
    expect(afterLeave).toBeNull()
    expect(effectiveSidebarCollapsed({ preference, appSlug: null, override: afterLeave })).toBe(false)
    // Come back: folded again.
    expect(effectiveSidebarCollapsed({ preference, appSlug: 'hr', override: reconcileOverride(afterLeave, 'hr') })).toBe(true)
  })
  it('a collapsed preference stays collapsed after leaving', () => {
    expect(effectiveSidebarCollapsed({ preference: true, appSlug: null, override: reconcileOverride({ appSlug: 'hr', collapsed: false }, null) })).toBe(true)
  })
  it('switching to another app also ends the visit', () => {
    expect(reconcileOverride({ appSlug: 'hr', collapsed: false }, 'crm')).toBeNull()
    const same = { appSlug: 'hr', collapsed: false }
    expect(reconcileOverride(same, 'hr')).toBe(same)
  })
})

describe('appPageSwitchPlaceholder (the shell stays while the next page loads)', () => {
  const prev = { app: { id: 'a' }, page: { slug: 'one' } }
  it('keeps the previous page within the same app and mode', () => {
    expect(appPageSwitchPlaceholder(prev, ['apps', 'page', 'hr', 'one', 'view', null], { appSlug: 'hr', mode: 'view', asRole: null })).toBe(prev)
  })
  it('never across apps, modes or preview roles', () => {
    expect(appPageSwitchPlaceholder(prev, ['apps', 'page', 'crm', 'one', 'view', null], { appSlug: 'hr', mode: 'view', asRole: null })).toBeUndefined()
    expect(appPageSwitchPlaceholder(prev, ['apps', 'page', 'hr', 'one', 'view', null], { appSlug: 'hr', mode: 'edit', asRole: null })).toBeUndefined()
    expect(appPageSwitchPlaceholder(prev, ['apps', 'page', 'hr', 'one', 'preview', 'viewer'], { appSlug: 'hr', mode: 'preview', asRole: null })).toBeUndefined()
    expect(appPageSwitchPlaceholder(undefined, ['apps', 'page', 'hr', 'one', 'view', null], { appSlug: 'hr', mode: 'view', asRole: null })).toBeUndefined()
  })
})
