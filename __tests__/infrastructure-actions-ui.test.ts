/**
 * Settings → Infrastructure: every area card always shows Change… and
 * Settings. A button that can't be used here is disabled, and the card says
 * why and what to do — per state:
 *
 *   cloud locked          both disabled, "Locked on this cloud deployment" + Unlock…
 *   cloud unlocked        enabled (and the page offers Lock again…)
 *   no DATABASE_URL (api) config-only areas enabled; database / auth / storage
 *                         Change… disabled with the DATABASE_URL how-to (Session pooler)
 *   DATABASE_URL (direct) everything enabled
 *   INFRA_UI_SWITCHING=false, neither DATABASE_URL nor a service key, a provider
 *                         without settings: disabled with their own remedy
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PROVIDER_AREAS } from '@/lib/config/schema'
import { AREA_LABELS } from '@/lib/admin/catalogue'
import { areaActionStates, switchingGate, type SwitchAccess, type SwitchingGate } from '@/lib/admin/switch-runtime'
import type { InfrastructureView as View } from '@/lib/admin/infrastructure'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/settings/infrastructure' }))
vi.mock('@/app/actions/infrastructure', () => ({
  setUiSwitching: vi.fn(), cancelProviderSwitch: vi.fn(), listProviderSwitches: vi.fn(), retryProviderSwitch: vi.fn(), rollbackProviderSwitch: vi.fn(),
  applyProviderChange: vi.fn(), checkSecretReference: vi.fn(), loadSwitchWizard: vi.fn(), planProviderChange: vi.fn(), saveProviderSettings: vi.fn(),
  testProviderChange: vi.fn(), getProviderSwitch: vi.fn(),
}))
vi.mock('@/app/actions/housekeeping', () => ({ runHousekeepingNow: vi.fn(), saveHousekeepingSettings: vi.fn() }))

import { InfrastructureView } from '@/components/settings/infrastructure-view'

const LOCKED = switchingGate({ flag: undefined, deploymentMode: 'cloud', allowSetting: undefined })
const UNLOCKED = switchingGate({ flag: undefined, deploymentMode: 'cloud', allowSetting: true })
const SELF_HOSTED = switchingGate({ flag: undefined, deploymentMode: 'self_hosted', allowSetting: undefined })
const FLAG_OFF = switchingGate({ flag: 'false', deploymentMode: 'cloud', allowSetting: true })
const PROVIDERS: Record<string, [string, string]> = {
  db: ['supabase', 'Supabase'], auth: ['supabase', 'Supabase Auth'], storage: ['supabase', 'Supabase Storage'], realtime: ['supabase', 'Supabase Realtime'],
  scheduler: ['pg_cron', 'pg_cron'], email: ['resend', 'Resend'], secrets: ['env', 'Environment'], cache: ['memory', 'Memory'], kms: ['env', 'ENCRYPTION_KEY'],
}

function view(gate: SwitchingGate, access: SwitchAccess): View {
  return {
    areas: PROVIDER_AREAS.map((area) => ({
      area, name: area, label: AREA_LABELS[area], provider: PROVIDERS[area][0], providerLabel: PROVIDERS[area][1], source: 'default', badges: [],
      health: 'ok', checks: [], docs: `/docs/self-hosting/infrastructure#${area}`,
      actions: areaActionStates({ area, label: AREA_LABELS[area], providerLabel: PROVIDERS[area][1], hasSettings: area !== 'kms', gate, access }),
    })),
    checkedAt: '2026-10-29T00:00:00.000Z', switches: [], switchLogError: null,
    switching: { gate, runtime: { available: false, reason: 'Vercel functions stop when the request ends' }, access, directError: null, busy: false, recentSwitchArea: null },
    housekeeping: null, housekeepingError: 'not installed', appVersion: '1.0.0',
  }
}

/** Each area section's two buttons: [label, disabled]. */
function buttons(html: string, label: string): Array<[string, boolean]> {
  const section = html.slice(html.indexOf(`aria-label="${label}"`))
  const end = section.indexOf('</section>')
  const body = section.slice(0, end)
  return [...body.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>/g)]
    .filter((m) => /settings$|^Change /.test(m[1]))
    .map((m) => [m[1], /\sdisabled=""/.test(m[0])])
}

function sectionOf(html: string, label: string): string {
  const section = html.slice(html.indexOf(`aria-label="${label}"`))
  return section.slice(0, section.indexOf('</section>'))
}

describe('area action states', () => {
  it('cloud locked: both disabled with the lock reason', () => {
    for (const area of PROVIDER_AREAS) {
      const s = areaActionStates({ area, label: AREA_LABELS[area], providerLabel: 'X', hasSettings: true, gate: LOCKED, access: 'api' })
      expect(s.change).toMatchObject({ enabled: false, block: { kind: 'cloud-locked', message: expect.stringMatching(/Locked on this cloud deployment.*unlock it here/) } })
      expect(s.settings.block?.kind).toBe('cloud-locked')
    }
  })

  it('unlocked without DATABASE_URL: config-only areas enabled; data-moving Change… needs a direct connection', () => {
    const states = Object.fromEntries(PROVIDER_AREAS.map((area) => [area, areaActionStates({ area, label: AREA_LABELS[area], providerLabel: 'X', hasSettings: true, gate: UNLOCKED, access: 'api' })]))
    for (const area of ['realtime', 'scheduler', 'email', 'secrets', 'cache', 'kms'] as const) {
      expect(states[area].change.enabled).toBe(true)
      expect(states[area].settings.enabled).toBe(true)
    }
    for (const area of ['db', 'auth', 'storage'] as const) {
      expect(states[area].change).toMatchObject({ enabled: false, block: { kind: 'needs-direct-db', message: expect.stringMatching(/add DATABASE_URL \(Supabase → Project Settings → Database → Connection string, Session pooler\).*redeploy/) } })
    }
    expect(states.storage.settings.enabled).toBe(true)
    expect(states.db.settings.block?.kind).toBe('needs-direct-db')
    expect(states.auth.settings.block?.kind).toBe('needs-direct-db')
  })

  it('a direct connection enables everything; the other states say their own remedy', () => {
    for (const gate of [UNLOCKED, SELF_HOSTED]) {
      for (const area of PROVIDER_AREAS) {
        const s = areaActionStates({ area, label: AREA_LABELS[area], providerLabel: 'X', hasSettings: true, gate, access: 'direct' })
        expect([s.change.enabled, s.settings.enabled]).toEqual([true, true])
      }
    }
    expect(areaActionStates({ area: 'email', label: 'Email', providerLabel: 'X', hasSettings: true, gate: FLAG_OFF, access: 'direct' }).change)
      .toMatchObject({ enabled: false, block: { kind: 'flag-off', message: expect.stringMatching(/INFRA_UI_SWITCHING=false.*redeploy/) } })
    expect(areaActionStates({ area: 'email', label: 'Email', providerLabel: 'X', hasSettings: true, gate: SELF_HOSTED, access: 'none' }).change)
      .toMatchObject({ enabled: false, block: { kind: 'no-access', message: expect.stringMatching(/SUPABASE_SERVICE_ROLE_KEY/) } })
    expect(areaActionStates({ area: 'kms', label: 'Key management', providerLabel: 'ENCRYPTION_KEY', hasSettings: false, gate: SELF_HOSTED, access: 'direct' }))
      .toMatchObject({ change: { enabled: true }, settings: { enabled: false, block: { kind: 'no-settings', message: expect.stringMatching(/ENCRYPTION_KEY has no settings/) } } })
  })
})

describe('Settings → Infrastructure page: the buttons are always there', () => {
  it('cloud locked (production today): every card shows Change… and Settings, disabled, with the reason and Unlock…', () => {
    const html = renderToStaticMarkup(createElement(InfrastructureView, { view: view(LOCKED, 'api') }))
    for (const area of PROVIDER_AREAS) {
      const label = AREA_LABELS[area]
      expect(buttons(html, label)).toEqual([[`${label} settings`, true], [`Change ${label} provider`, true]])
      const section = sectionOf(html, label)
      expect(section).toMatch(/Locked on this cloud deployment/)
      expect(section).toMatch(/Unlock…/)
    }
    expect(html).toMatch(/data-lock="locked"/)
    expect(html).toMatch(/data-access="api"/)
  })

  it('unlocked without DATABASE_URL: config-only enabled; data-moving disabled with the DATABASE_URL snippet', () => {
    const html = renderToStaticMarkup(createElement(InfrastructureView, { view: view(UNLOCKED, 'api') }))
    expect(buttons(html, AREA_LABELS.email)).toEqual([[`${AREA_LABELS.email} settings`, false], [`Change ${AREA_LABELS.email} provider`, false]])
    expect(buttons(html, AREA_LABELS.storage)).toEqual([[`${AREA_LABELS.storage} settings`, false], [`Change ${AREA_LABELS.storage} provider`, true]])
    expect(buttons(html, AREA_LABELS.db)).toEqual([[`${AREA_LABELS.db} settings`, true], [`Change ${AREA_LABELS.db} provider`, true]])
    const db = sectionOf(html, AREA_LABELS.db)
    expect(db).toMatch(/needs a direct database connection/)
    expect(db).toMatch(/DATABASE_URL=postgresql:\/\/postgres\.&lt;project-ref&gt;/)
    expect(sectionOf(html, AREA_LABELS.email)).not.toMatch(/data-block=/)
    expect(html).toMatch(/data-lock="unlocked"/)
    expect(html).toMatch(/Lock again…/)
  })

  it('with DATABASE_URL: everything enabled, no notes; a provider without settings says so', () => {
    const html = renderToStaticMarkup(createElement(InfrastructureView, { view: view(SELF_HOSTED, 'direct') }))
    for (const area of PROVIDER_AREAS.filter((a) => a !== 'kms')) {
      const label = AREA_LABELS[area]
      expect(buttons(html, label)).toEqual([[`${label} settings`, false], [`Change ${label} provider`, false]])
    }
    expect(buttons(html, AREA_LABELS.kms)).toEqual([[`${AREA_LABELS.kms} settings`, true], [`Change ${AREA_LABELS.kms} provider`, false]])
    expect(sectionOf(html, AREA_LABELS.kms)).toMatch(/has no settings to edit here/)
    expect(html).not.toMatch(/data-lock=|data-access="api"/)
  })
})
