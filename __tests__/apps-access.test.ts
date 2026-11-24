import { describe, expect, it } from 'vitest'
import { appAccessLevel, appsPageSections, inAudience, isAppDesigner, pushRecent, searchApps, showsAppsMenu, withRecentFirst, type AppViewer } from '@/lib/apps/access'

const viewer = (perms: string[], over: Partial<AppViewer> = {}): AppViewer => ({ userId: 'u1', teamIds: ['t1'], roleIds: ['r1'], can: (p) => perms.includes(p), ...over })

describe('app access', () => {
  const facts = { audience: [{ type: 'team' as const, id: 't1' }], editors: ['u9'] }

  it('audience by user, team or role (with apps.view) opens the app', () => {
    expect(appAccessLevel(viewer(['apps.view']), facts)).toBe('view')
    expect(appAccessLevel(viewer(['apps.view'], { teamIds: [] }), facts)).toBeNull()
    expect(appAccessLevel(viewer(['apps.view'], { teamIds: [] }), { audience: [{ type: 'role', id: 'r1' }], editors: [] })).toBe('view')
    expect(appAccessLevel(viewer(['apps.view'], { teamIds: [] }), { audience: [{ type: 'user', id: 'u1' }], editors: [] })).toBe('view')
  })

  it('non-audience users, and audience members without apps.view, can’t open it', () => {
    expect(appAccessLevel(viewer(['apps.view'], { userId: 'u2', teamIds: ['t2'], roleIds: [] }), facts)).toBeNull()
    expect(appAccessLevel(viewer([]), facts)).toBeNull()
  })

  it('editors and apps.manage edit; a user-less credential needs apps.manage', () => {
    expect(appAccessLevel(viewer([], { userId: 'u9' }), facts)).toBe('edit')
    expect(appAccessLevel(viewer(['apps.manage'], { userId: 'u5', teamIds: [] }), facts)).toBe('edit')
    expect(appAccessLevel(viewer(['apps.view'], { userId: null }), facts)).toBeNull()
    expect(appAccessLevel(viewer(['apps.manage'], { userId: null }), facts)).toBe('edit')
    expect(inAudience({ userId: null, teamIds: ['t1'], roleIds: [] }, facts.audience)).toBe(false)
  })
})

describe('Apps menu and Apps page', () => {
  const app = (id: string, access: 'view' | 'edit', shared: boolean, name = id) => ({ id, name, subtitle: null, description: `${name} app`, access, in_audience: shared })

  it('the Apps item: designers always, others only with an app shared with them', () => {
    expect(showsAppsMenu({ appCount: 0, canManage: false })).toBe(false)
    expect(showsAppsMenu({ appCount: 1, canManage: false })).toBe(true)
    expect(showsAppsMenu({ appCount: 0, canManage: true })).toBe(true)
    expect(showsAppsMenu({ appCount: 0, canManage: false, editsAny: true })).toBe(true)
  })

  it('My apps lists shared apps (one card even when also designed); Apps I design lists editable ones for designers', () => {
    const apps = [app('b', 'edit', true, 'Beta'), app('a', 'view', true, 'Alpha'), app('c', 'edit', false, 'Gamma')]
    const s = appsPageSections(apps, false)
    expect(s.designer).toBe(true)
    expect(s.use.map((x) => x.id)).toEqual(['a', 'b'])
    expect(s.design.map((x) => x.id)).toEqual(['b', 'c'])
    expect(new Set(s.use.map((x) => x.id)).size).toBe(s.use.length)
    const viewerOnly = appsPageSections([app('a', 'view', true)], false)
    expect(viewerOnly).toMatchObject({ designer: false, design: [] })
    expect(isAppDesigner([], true)).toBe(true)
    expect(appsPageSections([], true)).toMatchObject({ designer: true, use: [], design: [] })
  })

  it('search by name, subtitle and description; recent first', () => {
    const apps = [{ id: '1', name: 'Claims', subtitle: 'Insurance desk', description: null }, { id: '2', name: 'HR', subtitle: null, description: 'Onboarding requests' }]
    expect(searchApps(apps, 'insur').map((a) => a.id)).toEqual(['1'])
    expect(searchApps(apps, 'onboarding').map((a) => a.id)).toEqual(['2'])
    expect(searchApps(apps, '  ').length).toBe(2)
    expect(withRecentFirst(apps, ['2', 'zz'])).toEqual({ recent: [apps[1]], rest: [apps[0]] })
    expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a'])
  })
})
