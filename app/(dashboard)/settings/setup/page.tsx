import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { loadInfrastructureView, viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { getConfig } from '@/lib/config'
import { configuredAppUrl, appUrlOrLocalhost } from '@/lib/config/bootstrap'
import { catalogueEntry } from '@/lib/admin/catalogue'
import { getInstanceSetting } from '@/lib/config/instance-settings'
import { fieldViews } from '@/lib/admin/infrastructure-settings'
import { backgroundRuntime } from '@/lib/admin/switch-runtime'
import { loadProcessingStatus } from '@/lib/admin/processing-status'
import { pageMetadata } from '@/lib/page-title'
import { AREA_PLAIN, signInSummary, type WizardPageData } from '@/lib/setup/wizard-data'
import { WIZARD_STATE_SETTING, checkAddress, isStepId, nextStep, parseProgress } from '@/lib/setup/wizard-model'
import { SetupWizard } from '@/components/setup-wizard/setup-wizard'

export const metadata = pageMetadata('Setup wizard')

/**
 * Settings → Setup wizard (/settings/setup): the guided first-run setup
 * after the admin account exists (step 1 is /setup with the setup code).
 * Instance admins only — everyone else gets a 404 — and every action
 * re-checks it (app/actions/setup-wizard.ts). Each step can be skipped and
 * picked up again here; Settings → Infrastructure has the same panels.
 */
export const dynamic = 'force-dynamic'

export default async function SetupWizardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, user } = await getSessionDbWithUser()
  if (!user || !(await viewerCanSeeInfrastructure(user))) notFound()
  const params = await searchParams
  const progress = parseProgress(await getInstanceSetting(WIZARD_STATE_SETTING).catch(() => null))
  const requested = typeof params.step === 'string' ? params.step : null
  const step = isStepId(requested) && requested !== 'account' ? requested : nextStep(progress)

  const config = await getConfig()
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https')

  // Organisation: the signed-in owner's current workspace.
  let organisation: WizardPageData['organisation'] = null
  try {
    const { fromSession } = await import('@/lib/services/context')
    const ctx = await fromSession()
    const { data } = await (ctx.supabase as any).from('tenants').select('name, slug, contact_name, contact_email').eq('id', ctx.tenantId).maybeSingle()
    if (data) organisation = { name: data.name ?? '', slug: data.slug ?? '', contactName: data.contact_name ?? '', contactEmail: data.contact_email ?? user.email ?? '' }
  } catch {
    organisation = null
  }

  // Services (the doctor checks, cached 5 minutes): only where they are shown.
  let services: WizardPageData['services'] = null
  if (step === 'services' || step === 'done') {
    const [view, processing] = await Promise.all([
      loadInfrastructureView({ refresh: params.refresh === '1' }),
      loadProcessingStatus().catch(() => null),
    ])
    const runtime = backgroundRuntime()
    const areas = view.areas.map((a) => ({
      area: a.area, label: AREA_PLAIN[a.area].label, what: AREA_PLAIN[a.area].what, provider: a.provider, providerLabel: a.providerLabel,
      source: a.source, health: a.health, checks: a.checks, actions: a.actions, onSupabase: Boolean(catalogueEntry(a.area, a.provider)?.requiresSupabase), docs: a.docs,
    }))
    services = {
      areas, checkedAt: view.checkedAt, gate: view.switching.gate, access: view.switching.access, backgroundAvailable: runtime.available,
      addon: view.addon,
      processing: processing
        ? {
            addon: processing.addon,
            mode: processing.mode,
            settings: processing.provider?.settings ?? null,
            workersOnline: (processing.provider?.workers ?? []).filter((w) => w.online).length,
          }
        : null,
    }
  }

  const email = config.providers.email
  const emailFields = fieldViews('email', email.id, config)
  let pending: number | null = null
  try {
    const { count } = await (supabase as any).from('invitations').select('id', { count: 'exact', head: true }).is('accepted_at', null)
    pending = typeof count === 'number' ? count : null
  } catch {
    pending = null
  }

  const data: WizardPageData = {
    step,
    progress,
    viewerEmail: user.email ?? '',
    appUrl: appUrlOrLocalhost().replace(/\/+$/, ''),
    address: checkAddress(configuredAppUrl() ?? null, host ? `${proto}://${host}` : null),
    organisation,
    services,
    signIn: signInSummary(config, Boolean(process.env.AUTH_SSO_PROVIDERS?.trim())),
    email: {
      provider: email.id,
      source: email.source,
      from: typeof email.options.from === 'string' ? email.options.from : null,
      values: Object.fromEntries(emailFields.filter((f) => !f.secret && f.value !== null).map((f) => [f.option, f.value!])),
      secretsSet: emailFields.filter((f) => f.secret && f.configured).map((f) => f.option),
      pinned: emailFields.filter((f) => f.envPinned).map((f) => f.option),
    },
    team: { pending },
  }
  return <SetupWizard data={data} />
}
