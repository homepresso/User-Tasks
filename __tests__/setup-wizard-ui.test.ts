/**
 * The setup wizard's steps, rendered on the server (renderToStaticMarkup):
 * plain language, the step rail, what each step shows for a given
 * configuration, and that nothing secret reaches the page.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => '/settings/setup', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/app/actions/setup-wizard', () => ({
  setupWizardStep: vi.fn(), setupWizardTestIdp: vi.fn(), setupWizardSaveIdp: vi.fn(), setupWizardRemoveIdp: vi.fn(), setupWizardSaveEmail: vi.fn(),
  setupWizardSendTestEmail: vi.fn(), setupWizardAddressCheck: vi.fn(), setupWizardOrganisation: vi.fn(), setupWizardInvite: vi.fn(),
}))
vi.mock('@/app/actions/infrastructure', () => ({
  allowPrivateHost: vi.fn(), setUiSwitching: vi.fn(), loadSwitchWizard: vi.fn(), testProviderChange: vi.fn(), planProviderChange: vi.fn(), applyProviderChange: vi.fn(),
  saveProviderSettings: vi.fn(), getProviderSwitch: vi.fn(), listProviderSwitches: vi.fn(), rollbackProviderSwitch: vi.fn(), cancelProviderSwitch: vi.fn(),
  retryProviderSwitch: vi.fn(), checkSecretReference: vi.fn(), canViewInfrastructureAction: vi.fn(),
}))

const { SetupWizard } = await import('@/components/setup-wizard/setup-wizard')
const { summariseIdp, checkAddress } = await import('@/lib/setup/wizard-model')
import type { WizardPageData } from '@/lib/setup/wizard-data'

const on = { enabled: true, block: null }
function data(step: WizardPageData['step'], extra: Partial<WizardPageData> = {}): WizardPageData {
  return {
    step,
    progress: { steps: { organisation: 'done', email: 'skipped' }, finishedAt: null },
    viewerEmail: 'owner@example.com',
    appUrl: 'http://localhost:3490',
    address: checkAddress('http://localhost:3490', 'http://localhost:3490'),
    organisation: { name: 'Acme Inc', slug: 'acme-inc', contactName: '', contactEmail: 'owner@example.com' },
    services: {
      areas: [
        { area: 'db', label: 'Database', what: 'Where all your data is stored.', provider: 'postgres', providerLabel: 'PostgreSQL 15+', source: 'env', health: 'ok', checks: [{ area: 'db', name: 'connection', status: 'ok', detail: 'PostgreSQL 16' }], actions: { change: on, settings: on }, onSupabase: false, docs: '/docs' },
        { area: 'email', label: 'Email', what: 'Invitations.', provider: 'smtp', providerLabel: 'SMTP relay', source: 'settings', health: 'fail', checks: [{ area: 'email', name: 'config', status: 'fail', detail: 'EMAIL_FROM is required' }], actions: { change: on, settings: on }, onSupabase: false, docs: '/docs' },
        { area: 'storage', label: 'Files', what: 'Files.', provider: 'supabase', providerLabel: 'Supabase Storage', source: 'default', health: 'warn', checks: [], actions: { change: on, settings: on }, onSupabase: true, docs: '/docs' },
      ],
      checkedAt: '2026-11-14T00:00:00.000Z',
      gate: { enabled: true, reason: null },
      access: 'direct',
      backgroundAvailable: true,
      addon: { state: 'ready', href: '/x/infrastructure', reason: null },
    },
    signIn: { provider: 'builtin', source: 'settings', idps: [summariseIdp({ id: 'kc', type: 'oidc', preset: 'keycloak', name: 'Keycloak', baseUrl: 'http://localhost:55493', realm: 'usertasks', clientId: 'usertasks', clientSecret: 'super-secret-value' })], refusal: null },
    email: { provider: 'console', source: 'settings', from: 'UserTasks <noreply@usertasks.local>', values: { from: 'UserTasks <noreply@usertasks.local>' }, secretsSet: [], pinned: [] },
    team: { pending: 2 },
    ...extra,
  }
}

const render = (d: WizardPageData) => renderToStaticMarkup(createElement(SetupWizard, { data: d }))

describe('setup wizard steps (rendered)', () => {
  it('the rail: seven steps, done and skipped marked, the current step', () => {
    const html = render(data('services'))
    expect(html).toContain('step 3 of 7')
    for (const title of ['Admin account', 'Your organisation', 'Services', 'Sign-in and SSO', 'Email', 'Invite your team', 'Done']) expect(html).toContain(title)
    expect(html).toContain('Skipped')
    expect(html).toMatch(/aria-current="step"[^>]*>.*Services/)
    expect(html).toContain('Skip for now')
  })

  it('organisation: the form and the web address check', () => {
    const html = render(data('organisation', { address: checkAddress('https://tasks.example.com', 'http://10.0.0.5:3490') }))
    expect(html).toContain('value="Acme Inc"')
    expect(html).toContain('value="acme-inc"')
    expect(html).toContain('You opened http://10.0.0.5:3490, but APP_URL is https://tasks.example.com')
    expect(html).toContain('Save and continue')
    expect(html).not.toContain('>Back<')
  })

  it('services: green / amber / red per area, change with the add-on, moving off Supabase', () => {
    const html = render(data('services'))
    expect(html).toContain('1 service is not working.')
    expect(html).toContain('data-health="ok"')
    expect(html).toContain('data-health="warn"')
    expect(html).toContain('data-health="fail"')
    expect(html).toContain('EMAIL_FROM is required')
    expect(html).toContain('Change Database provider')
    expect(html).toContain('href="/x/infrastructure?area=db"')
    expect(html).toContain('Moving off Supabase (optional)')
    expect(html).toContain('href="/x/infrastructure?section=move-off-supabase"')
    expect(html).toContain('Set in the server environment.')
  })

  it('services without the Infrastructure add-on: the add-on card instead of the move, Change… leads to it', () => {
    const d = data('services')
    d.services!.addon = { state: 'missing', href: null, reason: 'needs the add-on' }
    const html = render(d)
    expect(html).toContain('Moving off Supabase (optional)')
    expect(html).toContain('data-addon-upsell="infrastructure"')
    expect(html).toContain('href="/settings/extensions"')
    expect(html).toContain('href="#move-off-supabase"')
    expect(html).not.toContain('/x/infrastructure')
    expect(html).not.toContain('usertasks-admin switch')
  })

  it('sign-in: providers listed without secrets, test sign-in link, redirect URIs', () => {
    const html = render(data('sign-in'))
    expect(html).toContain('Keycloak')
    expect(html).not.toContain('super-secret-value')
    expect(html).toContain('http://localhost:3490/auth/sso/kc/start?redirect=%2Fhome')
    expect(html).toContain('private (incognito) window')
    const add = render(data('sign-in', { signIn: { provider: 'builtin', source: 'default', idps: [], refusal: null } }))
    expect(add).toContain('Microsoft Entra ID (Azure AD, Microsoft 365)')
    expect(add).toContain('http://localhost:3490/auth/sso/entra/callback')
    expect(add).toContain('Check connection')
    const supabase = render(data('sign-in', { signIn: { provider: 'supabase', source: 'default', idps: [], refusal: 'Sign-in runs on Supabase Auth here.' } }))
    expect(supabase).toContain('Sign-in runs on Supabase Auth here.')
    expect(supabase).not.toContain('Save identity provider')
  })

  it('email: console warns, choices offered, secrets write-only, test send', () => {
    const html = render(data('email'))
    expect(html).toContain('nobody receives invitations or password resets')
    expect(html).toContain('Microsoft 365 / Exchange Online')
    expect(html).toContain('Amazon SES (Infrastructure add-on)')
    expect(html).toContain('Send test email')
    expect(html).toContain('value="owner@example.com"')
    const smtp = render(data('email', { email: { provider: 'smtp', source: 'settings', from: 'a@b.co', values: { from: 'a@b.co', smtp_host: 'mail.example.com' }, secretsSet: ['smtp_password'], pinned: [] } }))
    expect(smtp).toContain('value="mail.example.com"')
    expect(smtp).toContain('Now: <strong>Your mail server (SMTP, on-premises Exchange)</strong>')
    expect(smtp).toContain('Saved. Leave blank to keep it.')
    const pinned = render(data('email', { email: { provider: 'smtp', source: 'env', from: null, values: {}, secretsSet: [], pinned: [] } }))
    expect(pinned).toContain('set by EMAIL_PROVIDER in the server environment')
    expect(pinned).not.toContain('Save email settings')
  })

  it('team and done', () => {
    const team = render(data('team'))
    expect(team).toContain('2 invitations are waiting to be accepted.')
    expect(team).toContain('invitations are only written to the server log')
    const done = render(data('done'))
    expect(done).toContain('Finish')
    expect(done).toContain('You skipped:')
    expect(done).not.toContain('Skip for now')
  })
})
