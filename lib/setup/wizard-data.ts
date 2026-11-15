import type { InstanceConfig } from '@/lib/config'
import type { CheckStatus, DoctorCheck } from '@/lib/admin/doctor'
import type { AreaActionStates, SwitchAccess, SwitchingGate } from '@/lib/admin/switch-runtime'
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

export interface SupabaseMove {
  area: ProviderArea
  label: string
  /** page: Change… on the card runs it (with its backup); cli: the commands to run on the server. */
  how: 'page' | 'cli'
  target: string
  detail: string
  commands: string[]
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
    moves: SupabaseMove[]
  } | null
  signIn: { provider: string; source: string; idps: IdpSummary[]; refusal: string | null }
  email: { provider: string; source: string; from: string | null; values: Record<string, string>; secretsSet: string[]; pinned: string[] }
  team: { pending: number | null }
}

/** How to move each Supabase area off Supabase: on the page when it can run here safely, else the commands. */
export function supabaseMoves(areas: Array<Pick<ServiceArea, 'area' | 'label' | 'onSupabase' | 'actions'>>, access: SwitchAccess, backgroundAvailable: boolean): SupabaseMove[] {
  const order: ProviderArea[] = ['storage', 'realtime', 'secrets', 'auth', 'db']
  const moves: SupabaseMove[] = []
  for (const id of order) {
    const a = areas.find((x) => x.area === id && x.onSupabase)
    if (!a) continue
    const onPage = a.actions.change.enabled && (id !== 'db' || (access === 'direct' && backgroundAvailable))
    switch (id) {
      case 'storage':
        moves.push({ area: id, label: a.label, how: onPage ? 'page' : 'cli', target: 'a local folder or S3-compatible storage',
          detail: 'Copies every file to the new store and checks it; the files stay in Supabase too, so nothing is lost.',
          commands: ['usertasks-admin switch storage --to local --set local_root=/var/lib/usertasks/files --dry-run', 'usertasks-admin switch storage --to local --set local_root=/var/lib/usertasks/files'] })
        break
      case 'realtime':
        moves.push({ area: id, label: a.label, how: onPage ? 'page' : 'cli', target: 'built-in live updates', detail: 'A settings change only: no data moves.', commands: ['usertasks-admin switch realtime --to sse'] })
        break
      case 'secrets':
        moves.push({ area: id, label: a.label, how: onPage ? 'page' : 'cli', target: 'encrypted settings in your database', detail: 'A settings change: secrets you stored in Supabase Vault must be added again in the new store.', commands: ['usertasks-admin switch secrets --to db'] })
        break
      case 'auth':
        moves.push({ area: id, label: a.label, how: onPage ? 'page' : 'cli', target: 'built-in sign-in',
          detail: 'Copies every account with its password hash, so people keep their passwords. A backup is taken first and the switch can be rolled back.',
          commands: ['usertasks-admin switch auth --to builtin --dry-run', 'usertasks-admin switch auth --to builtin'] })
        break
      case 'db':
        moves.push({ area: id, label: a.label, how: onPage ? 'page' : 'cli', target: 'your own PostgreSQL 15+',
          detail: 'Do this last. It copies every table into the new database and verifies row counts and checksums; Supabase keeps its copy, and `usertasks-admin rollback <switch id>` goes back. Plan a quiet moment: changes made during the copy are re-checked at the end.',
          commands: [
            "usertasks-admin switch database --to postgres --target-url 'postgres://usertasks:PASSWORD@db.example.com:5432/usertasks?sslmode=require' --dry-run",
            "usertasks-admin switch database --to postgres --target-url 'postgres://usertasks:PASSWORD@db.example.com:5432/usertasks?sslmode=require'",
            'usertasks-admin history',
          ] })
        break
    }
  }
  return moves
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
