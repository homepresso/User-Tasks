import type { InstanceConfig } from '@/lib/config'
import type { CheckStatus, DoctorCheck } from '@/lib/admin/doctor'
import type { AreaActionStates, SwitchAccess, SwitchingGate } from '@/lib/admin/switch-runtime'
import type { InfrastructureAddonView } from '@/lib/infrastructure/provider'
import type { ProcessingAddonView } from '@/lib/processing/addon'
import type { ProcessingSettingsView } from '@/lib/extensions/sdk'
import type { ProviderArea } from '@/lib/config/schema'
import { checkAddress, nextStep, parseStoredIdps, summariseIdp, type AddressCheck, type IdpSummary, type WizardProgress, type WizardStepId } from './wizard-model'

/**
 * What the setup wizard page renders (server → client): nothing secret.
 * Secret options only say whether they are set; identity providers come as
 * summaries without their client secrets.
 */

/** Plain-language names and one-line explanations per area (the wizard talks to beginners). */
export const AREA_PLAIN: Record<ProviderArea, { label: string; what: string }> = {
  db: { label: 'Database', what: 'Where all your data is stored.' },
  auth: { label: 'Sign-in', what: 'How people prove who they are.' },
  storage: { label: 'Files', what: 'Uploaded files, logos and attachments.' },
  email: { label: 'Email', what: 'Invitations, notifications and password resets.' },
  scheduler: { label: 'Background jobs', what: 'Timers, reminders and scheduled workflows.' },
  realtime: { label: 'Live updates', what: 'Pages update by themselves when something changes.' },
  cache: { label: 'Cache', what: 'Speeds things up and shares limits between servers.' },
  secrets: { label: 'Secret store', what: 'Where passwords and keys for your connections are kept.' },
  kms: { label: 'Key management', what: 'The keys that encrypt stored secrets.' },
}

export interface ServiceArea {
  area: ProviderArea
  label: string
  what: string
  provider: string
  providerLabel: string
  source: string
  health: CheckStatus
  checks: DoctorCheck[]
  actions: AreaActionStates
  onSupabase: boolean
  docs: string
}

export interface WizardPageData {
  step: WizardStepId
  progress: WizardProgress
  viewerEmail: string
  appUrl: string
  address: AddressCheck
  organisation: { name: string; slug: string; contactName: string; contactEmail: string } | null
  services: {
    areas: ServiceArea[]
    checkedAt: string
    gate: SwitchingGate
    access: SwitchAccess
    backgroundAvailable: boolean
    /** The Infrastructure add-on (moving areas off Supabase); missing / unlicensed: the wizard shows the add-on card. */
    addon: InfrastructureAddonView
    /** Processing (optional): the Processing add-on's switch when licensed, else its card. */
    processing?: WizardProcessing | null
  } | null
  signIn: { provider: string; source: string; idps: IdpSummary[]; refusal: string | null }
  email: { provider: string; source: string; from: string | null; values: Record<string, string>; secretsSet: string[]; pinned: string[] }
  team: { pending: number | null }
}

export interface WizardProcessing {
  addon: ProcessingAddonView
  /** web: the web app runs queued work; queue: separate workers do. */
  mode: 'web' | 'queue'
  /** The add-on's switches (ready only). */
  settings: ProcessingSettingsView | null
  workersOnline: number
}

export function signInSummary(config: InstanceConfig, envPinned: boolean): WizardPageData['signIn'] {
  const auth = config.providers.auth
  const idps = parseStoredIdps(auth.options.sso_providers).map(summariseIdp)
  const refusal = auth.id === 'supabase'
    ? 'Sign-in runs on Supabase Auth here. To add Entra ID, AD FS or another identity provider from this page, first move sign-in to built-in (Services → Sign-in → Change…), or set up SSO in your Supabase project.'
    : envPinned ? 'Identity providers are set by the AUTH_SSO_PROVIDERS environment variable on this server: change them there and restart UserTasks.' : null
  return { provider: auth.id, source: auth.source, idps, refusal }
}

export { checkAddress, nextStep }
