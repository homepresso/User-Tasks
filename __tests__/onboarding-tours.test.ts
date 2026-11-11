/**
 * Spotlight tours (lib/onboarding/tours.ts): every checklist tour exists,
 * every step's data-tour target is really in the app, steps resolve to the
 * first visible element or fall back (centred card) when it's missing, the
 * card stays on screen, and the keyboard contract (Esc exits, arrows step,
 * Tab wraps inside the card).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TOURS, navTourId, onStepPath, placeCard, resolveStepTarget, settingsTourId, stepAnnouncement, tourById, tourKeyAction,
  tourSelector, tourSteps, trapFocusIndex, type ElementLike, type QueryRoot,
} from '@/lib/onboarding/tours'
import { ALL_ITEMS } from '@/lib/onboarding/model'
import { NAV_GROUPS, NAV_PRIMARY, NAV_SETTINGS } from '@/lib/constants'
import { SETTINGS_NAV } from '@/components/settings/settings-frame'

const ROOT = path.resolve(__dirname, '..')

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** Every data-tour name the app renders: literal attributes, the SettingsSection `tour` prop, and the derived nav / settings ids. */
function renderedTargets(): Set<string> {
  const found = new Set<string>()
  for (const file of [...sources(path.join(ROOT, 'components')), ...sources(path.join(ROOT, 'app'))]) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/data-tour(?:=\{index === 0 \? |=)["']([a-z0-9-]+)["']/g)) found.add(m[1])
    for (const m of text.matchAll(/\btour="([a-z0-9-]+)"/g)) found.add(m[1])
  }
  for (const item of [...NAV_PRIMARY, ...NAV_GROUPS.flatMap((g) => g.items), NAV_SETTINGS]) found.add(navTourId(item.href))
  for (const item of SETTINGS_NAV.flatMap((g) => g.items)) found.add(settingsTourId(item.href))
  return found
}

describe('tour data', () => {
  it('every checklist tour exists and has steps', () => {
    for (const item of ALL_ITEMS.filter((i) => i.tour)) {
      expect(tourById(item.tour), item.id).toBeDefined()
      expect(tourById(item.tour)!.steps.length, item.id).toBeGreaterThan(0)
    }
  })

  it('every step target is a valid name that the app renders', () => {
    const rendered = renderedTargets()
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        if (!step.target) continue
        expect(tourSelector(step.target), `${tour.id}: ${step.target}`).not.toBeNull()
        expect(rendered.has(step.target), `${tour.id}: [data-tour="${step.target}"] is not rendered anywhere`).toBe(true)
      }
    }
  })

  it('a hint is only ever the last step, after a step that hands over by clicking', () => {
    for (const tour of TOURS) {
      tour.steps.forEach((step, i) => {
        if (!step.hint) return
        expect(i, tour.id).toBe(tour.steps.length - 1)
        expect(tour.steps[i - 1]?.clickLabel, tour.id).toBeTruthy()
      })
    }
  })

  it('drops the Agent button step when the Agent is off (except in the Agent set-up tour)', () => {
    const build = tourById('build')!
    expect(tourSteps(build, { agentAvailable: false }).some((s) => s.target === 'agent-button')).toBe(false)
    expect(tourSteps(build, { agentAvailable: true }).some((s) => s.target === 'agent-button')).toBe(true)
    expect(tourSteps(tourById('agent')!, { agentAvailable: false }).some((s) => s.target === 'agent-button')).toBe(true)
  })

  it('nav and settings ids', () => {
    expect(navTourId('/forms/wizard')).toBe('nav-forms-wizard')
    expect(navTourId('/settings/governance?tab=retention')).toBe('nav-settings-governance')
    expect(settingsTourId('/settings?tab=general')).toBe('settings-general')
    expect(settingsTourId('/settings')).toBe('settings-profile')
    expect(settingsTourId('/settings/assistants')).toBe('settings-assistants')
    expect(tourSelector('bad"]selector')).toBeNull()
  })
})

describe('step resolution', () => {
  const el = (width: number, height: number, id: string): ElementLike & { id: string } => ({ id, getBoundingClientRect: () => ({ width, height, top: 10, left: 10 }) })
  const root = (map: Record<string, ElementLike[]>): QueryRoot => ({ querySelectorAll: (sel) => map[sel] ?? [] })

  it('finds the first visible match (hidden phone copies are skipped)', () => {
    const hidden = el(0, 0, 'phone'), shown = el(120, 32, 'desktop')
    const found = resolveStepTarget<typeof shown>({ target: 'nav-tasks' }, root({ '[data-tour="nav-tasks"]': [hidden, shown] }))
    expect(found?.id).toBe('desktop')
  })

  it('a missing element resolves to null: the card is centred', () => {
    expect(resolveStepTarget({ target: 'nav-tasks' }, root({}))).toBeNull()
    expect(resolveStepTarget({ target: 'nav-tasks' }, root({ '[data-tour="nav-tasks"]': [el(0, 0, 'x')] }))).toBeNull()
    expect(resolveStepTarget({}, root({}))).toBeNull()
    const pos = placeCard(null, { width: 340, height: 180 }, { width: 1440, height: 900 })
    expect(pos).toEqual({ top: 360, left: 550, placement: 'center' })
  })

  it('places the card beside the element, flips when there is no room, and stays on screen', () => {
    const vp = { width: 1440, height: 900 }
    const card = { width: 340, height: 180 }
    const nav = { top: 400, left: 6, width: 228, height: 44 }
    expect(placeCard(nav, card, vp, 'right')).toMatchObject({ placement: 'right', left: 6 + 228 + 14 })
    const topRight = { top: 60, left: 1300, width: 120, height: 36 }
    const flipped = placeCard(topRight, card, vp, 'right')
    expect(flipped.placement).toBe('left')
    expect(flipped.left + card.width).toBeLessThanOrEqual(vp.width - 12)
    const bottomEdge = { top: 860, left: 600, width: 200, height: 30 }
    const up = placeCard(bottomEdge, card, vp, 'bottom')
    expect(up.placement).toBe('top')
    expect(up.top).toBeGreaterThanOrEqual(12)
  })

  it('matches the step page including its query', () => {
    expect(onStepPath({ path: '/settings?tab=general' }, '/settings', 'tab=general&x=1')).toBe(true)
    expect(onStepPath({ path: '/settings?tab=general' }, '/settings', '')).toBe(false)
    expect(onStepPath({ path: '/packages' }, '/packages/', '')).toBe(true)
    expect(onStepPath({}, '/anything', '')).toBe(true)
  })

  it('announces each step, and says when its part of the page is missing', () => {
    const tour = tourById('gallery')!
    expect(stepAnnouncement(tour, 0, 2, tour.steps[0], true)).toBe(`Install from the Gallery, step 1 of 2: Packages. ${tour.steps[0].body}`)
    expect(stepAnnouncement(tour, 0, 2, tour.steps[0], false)).toMatch(/isn’t showing right now/)
  })
})

describe('keyboard', () => {
  it('Esc exits, arrows step; Enter and Space stay with the focused button', () => {
    expect(tourKeyAction('Escape')).toBe('exit')
    expect(tourKeyAction('Esc')).toBe('exit')
    expect(tourKeyAction('ArrowRight')).toBe('next')
    expect(tourKeyAction('ArrowLeft')).toBe('back')
    expect(tourKeyAction('Enter')).toBeNull()
    expect(tourKeyAction(' ')).toBeNull()
  })

  it('Tab wraps inside the card (focus trap)', () => {
    expect(trapFocusIndex(2, 3, false)).toBe(0)
    expect(trapFocusIndex(0, 3, true)).toBe(2)
    expect(trapFocusIndex(1, 3, false)).toBe(2)
    expect(trapFocusIndex(-1, 3, false)).toBe(0)
    expect(trapFocusIndex(-1, 3, true)).toBe(2)
    expect(trapFocusIndex(0, 0, false)).toBe(-1)
  })
})
