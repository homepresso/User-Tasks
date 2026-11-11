/**
 * The getting-started guide's rules (lib/onboarding/model.ts): who sees it
 * and when, "Remind me later" timing, "Don't show again", permission
 * filtering, progress, the welcome (beta wording on / off) and which screen
 * shows first.
 */
import { describe, expect, it } from 'vitest'
import {
  ADMIN_ITEMS, MEMBER_ITEMS, NEW_WINDOW_DAYS, REMIND_AFTER_DAYS, WELCOME_QUICK_STARTS,
  applicableItems, applyChoice, audienceFor, compactStored, decideVisibility, initialView, parseStored, progressOf,
  storedFor, visitedItemForPath, welcomeCopy, type StoredOnboarding, type VisibilityInput,
} from '@/lib/onboarding/model'
import { betaWelcomeOn } from '@/lib/onboarding/beta'
import { expandPermissions, PERMISSION_KEYS, type Permission } from '@/lib/permissions'
import { SYSTEM_ROLES } from '@/lib/tenant-provisioning'

const NOW = new Date('2026-11-11T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const roleCan = (slug: string) => {
  const perms = new Set(expandPermissions(SYSTEM_ROLES.find((r) => r.slug === slug)!.permissions))
  return (p: Permission) => perms.has(p)
}
const progress = (done: number, total = 6) => ({ done, total, complete: total > 0 && done === total, percent: Math.round((done / total) * 100) })

function input(over: Partial<VisibilityInput> = {}): VisibilityInput {
  return {
    audience: 'admin', tenantCreatedAt: daysAgo(1), joinedAt: daysAgo(1), showToMembers: true,
    stored: {}, progress: progress(1), sessionDismissed: false, now: NOW, ...over,
  }
}

describe('who sees the guide', () => {
  it('opens for an admin of a new workspace', () => {
    const v = decideVisibility(input())
    expect(v).toMatchObject({ eligible: true, autoOpen: true, launcher: true, celebrate: false })
  })

  it('stays closed for an admin of a workspace older than the window', () => {
    const v = decideVisibility(input({ tenantCreatedAt: daysAgo(NEW_WINDOW_DAYS + 1) }))
    expect(v).toMatchObject({ eligible: false, autoOpen: false, launcher: false })
    expect(decideVisibility(input({ tenantCreatedAt: daysAgo(NEW_WINDOW_DAYS - 1) })).autoOpen).toBe(true)
  })

  it('opens the member checklist for someone who joined recently, even in an old workspace', () => {
    const v = decideVisibility(input({ audience: 'member', tenantCreatedAt: daysAgo(400), joinedAt: daysAgo(2) }))
    expect(v).toMatchObject({ eligible: true, autoOpen: true })
  })

  it('not for members who joined long ago, nor when the workspace turned it off', () => {
    expect(decideVisibility(input({ audience: 'member', joinedAt: daysAgo(90) })).eligible).toBe(false)
    const off = decideVisibility(input({ audience: 'member', joinedAt: daysAgo(1), showToMembers: false }))
    expect(off).toMatchObject({ eligible: false, autoOpen: false, launcher: false, reason: 'turned off for members' })
    // The member setting never hides the admin checklist.
    expect(decideVisibility(input({ showToMembers: false })).autoOpen).toBe(true)
  })

  it('a missing date never qualifies', () => {
    expect(decideVisibility(input({ tenantCreatedAt: null })).eligible).toBe(false)
    expect(decideVisibility(input({ audience: 'member', joinedAt: null })).eligible).toBe(false)
  })

  it('"Dismiss" closes it for this session but keeps the launcher', () => {
    expect(decideVisibility(input({ sessionDismissed: true }))).toMatchObject({ autoOpen: false, launcher: true })
  })

  it('celebrates once everything is done, then hides after completion is recorded', () => {
    expect(decideVisibility(input({ progress: progress(6) }))).toMatchObject({ autoOpen: true, celebrate: true, launcher: true })
    expect(decideVisibility(input({ progress: progress(6), stored: { completed_at: daysAgo(0) } }))).toMatchObject({ autoOpen: false, launcher: false })
  })
})

describe('"Remind me later"', () => {
  it('closes now, keeps the launcher, and comes back after the reminder', () => {
    const snoozed = applyChoice({}, { kind: 'snooze' }, NOW)
    expect(snoozed.status).toBe('snoozed')
    expect(Date.parse(snoozed.remind_at!) - NOW.getTime()).toBe(REMIND_AFTER_DAYS * 86_400_000)
    const soon = new Date(NOW.getTime() + 60 * 60 * 1000)
    expect(decideVisibility(input({ stored: snoozed, now: soon }))).toMatchObject({ autoOpen: false, launcher: true, reason: 'saved for later' })
    const later = new Date(NOW.getTime() + (REMIND_AFTER_DAYS * 24 + 1) * 60 * 60 * 1000)
    expect(decideVisibility(input({ stored: snoozed, now: later }))).toMatchObject({ autoOpen: true, reason: 'reminder due' })
  })

  it('takes a number of days, clamped to 0–30', () => {
    const week = applyChoice({}, { kind: 'snooze', days: 7 }, NOW)
    expect(Date.parse(week.remind_at!) - NOW.getTime()).toBe(7 * 86_400_000)
    const huge = applyChoice({}, { kind: 'snooze', days: 999 }, NOW)
    expect(Date.parse(huge.remind_at!) - NOW.getTime()).toBe(30 * 86_400_000)
  })
})

describe('"Don\'t show again"', () => {
  it('never opens by itself, and the launcher goes away', () => {
    const never = applyChoice({ status: 'snoozed', remind_at: daysAgo(3) }, { kind: 'never' }, NOW)
    expect(never).toMatchObject({ status: 'never', never_at: NOW.toISOString() })
    expect(never.remind_at).toBeUndefined()
    const v = decideVisibility(input({ stored: never, now: new Date(NOW.getTime() + 20 * 86_400_000) }))
    expect(v).toMatchObject({ autoOpen: false, launcher: false, reason: 'never show again' })
  })

  it('persists through storage per workspace (JSON round trip) and can be undone', () => {
    const stored = compactStored(applyChoice({}, { kind: 'never' }, NOW))
    const prefs = JSON.parse(JSON.stringify({ queue_rules: { v: 2 }, onboarding: { 'tenant-a': stored } }))
    expect(storedFor(prefs, 'tenant-a').status).toBe('never')
    expect(storedFor(prefs, 'tenant-b')).toEqual({})
    const resumed = applyChoice(storedFor(prefs, 'tenant-a'), { kind: 'resume' }, NOW)
    expect(resumed.status).toBeUndefined()
    expect(decideVisibility(input({ stored: resumed })).autoOpen).toBe(true)
  })

  it('parseStored drops junk', () => {
    expect(parseStored({ status: 'hacked', remind_at: 'not a date', visited: ['tasks', 'nope', 'tasks'], tours: ['gallery', 'Bad Tour!'], extra: 1 }))
      .toEqual({ visited: ['tasks'], tours: ['gallery'] })
    expect(parseStored(null)).toEqual({})
    expect(parseStored([1])).toEqual({})
  })

  it('visits and tours are recorded once', () => {
    let s: StoredOnboarding = {}
    s = applyChoice(s, { kind: 'visit', item: 'tasks' }, NOW)
    expect(applyChoice(s, { kind: 'visit', item: 'tasks' }, NOW)).toBe(s)
    s = applyChoice(s, { kind: 'tour', tour: 'gallery' }, NOW)
    expect(s).toMatchObject({ visited: ['tasks'], tours: ['gallery'] })
  })
})

describe('permission filtering', () => {
  const ids = (audience: 'admin' | 'member', slug: string, agent = false) => applicableItems(audience, roleCan(slug), agent).map((i) => i.id)

  it('owners and admins get the workspace checklist; others the member one', () => {
    expect(audienceFor(roleCan('owner'))).toBe('admin')
    expect(audienceFor(roleCan('admin'))).toBe('admin')
    expect(audienceFor(roleCan('manager'))).toBe('member')
    expect(audienceFor(roleCan('member'))).toBe('member')
  })

  it('an owner sees every admin item, the Agent and the Gallery first', () => {
    expect(ids('admin', 'owner')).toEqual(ADMIN_ITEMS.map((i) => i.id))
    expect(ids('admin', 'owner').slice(0, 2)).toEqual(['agent', 'gallery'])
    expect(WELCOME_QUICK_STARTS).toEqual(['agent', 'gallery'])
  })

  it('hides what a person cannot do', () => {
    const noSso = (p: Permission) => p !== 'settings.edit' && PERMISSION_KEYS.includes(p)
    const items = applicableItems('admin', noSso, false).map((i) => i.id)
    expect(items).not.toContain('sso')
    expect(items).not.toContain('theme')
    expect(items).not.toContain('selftest')
    expect(items).toContain('gallery')
    const nothing = applicableItems('admin', () => false, false).map((i) => i.id)
    expect(nothing).toEqual(['tutorials'])
  })

  it('the member checklist: "Meet the Agent" only when the Agent is available', () => {
    expect(ids('member', 'member')).toEqual(['tasks', 'form', 'notifications'])
    expect(ids('member', 'member', true)).toEqual(['tasks', 'form', 'meet_agent', 'notifications'])
    expect(MEMBER_ITEMS).toHaveLength(4)
  })

  it('progress counts required items only', () => {
    const items = applicableItems('admin', roleCan('owner'), true)
    const p = progressOf(items, { agent: true, gallery: true, tutorials: true, selftest: true })
    expect(p).toEqual({ done: 2, total: 6, complete: false, percent: 33 })
    expect(progressOf(items, Object.fromEntries(items.map((i) => [i.id, !i.optional]))).complete).toBe(true)
  })
})

describe('visiting pages', () => {
  it('maps the pages that complete an item', () => {
    expect(visitedItemForPath('/tasks')).toBe('tasks')
    expect(visitedItemForPath('/tasks/123')).toBeNull()
    expect(visitedItemForPath('/settings', 'tab=preferences')).toBe('notifications')
    expect(visitedItemForPath('/settings', 'tab=general')).toBeNull()
    expect(visitedItemForPath('/docs/tutorials/first-form')).toBe('tutorials')
  })
})

describe('the welcome', () => {
  it('shows first, then the checklist once seen; the celebration when everything is done', () => {
    expect(initialView({}, { celebrate: false })).toBe('welcome')
    const seen = applyChoice({}, { kind: 'welcomed' }, NOW)
    expect(initialView(seen, { celebrate: false })).toBe('checklist')
    expect(initialView(seen, { celebrate: true })).toBe('celebrate')
    expect(initialView(seen, { celebrate: false, requested: 'welcome' })).toBe('welcome')
  })

  it('beta wording on and off', () => {
    const beta = welcomeCopy(true, 'admin')
    expect(beta.heading).toBe('Welcome to UserTasks, and thank you for joining the beta')
    expect(beta.body).toMatch(/general release.*feedback/)
    const ga = welcomeCopy(false, 'admin')
    expect(ga.heading).toBe('Welcome to UserTasks')
    expect(`${ga.heading} ${ga.body}`).not.toMatch(/beta|general release/i)
  })

  it('USERTASKS_BETA: explicit on / off, else on in cloud mode only', () => {
    expect(betaWelcomeOn({ USERTASKS_BETA: 'off', DEPLOYMENT_MODE: 'cloud' })).toBe(false)
    expect(betaWelcomeOn({ USERTASKS_BETA: 'on', DEPLOYMENT_MODE: 'self_hosted' })).toBe(true)
    expect(betaWelcomeOn({ USERTASKS_BETA: 'false' })).toBe(false)
  })
})
