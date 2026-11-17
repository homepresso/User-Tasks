/**
 * Team notification for each self-serve trial issued or re-sent (cloud only):
 * one team_requests row and one ChirpMe notification through notifyTeam
 * (lib/contact/team-requests.ts), sub-tab "Trials", reply-to the requester. Sent after the response (after()), so a slow or failing
 * notification never affects the trial.
 */
import { escapeHtml, type ChirpMessage } from '@/lib/contact/chirpme'
import { notifyTeam } from '@/lib/contact/team-requests'
import { publicBaseUrl } from '@/lib/deployment'

export interface TrialFacts {
  name: string
  email: string
  company: string
  farmId: string
  instanceId?: string | null
  sku: string
  licenceId: string
  expiresAt: string
  /** new: a trial was issued; resent: the existing trial's licence was sent again. */
  kind: 'new' | 'resent'
  source: 'website' | 'product'
}

export const TRIALS_SUBTAB = 'Trials'
export const TRIALS_SUBTAB_COLOR = '#F59E0B'

function day(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : iso
}

export function trialChirp(f: TrialFacts, baseUrl: string = publicBaseUrl()): ChirpMessage {
  const row = (label: string, value: string | null | undefined) => (value ? `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>` : '')
  const what = f.kind === 'new' ? 'New SharePoint trial' : 'SharePoint trial licence re-sent'
  return {
    title: `${what} — ${f.company}`,
    body: f.kind === 'new'
      ? `${f.name} (${f.email}) started a 30-day ${f.sku} trial for ${f.company} (expires ${day(f.expiresAt)}).`
      : `${f.name} (${f.email}) asked again for ${f.company}'s existing ${f.sku} trial licence (expires ${day(f.expiresAt)}).`,
    url: `${baseUrl}/settings/licence`,
    detail:
      `<h2>${escapeHtml(what)}</h2>` +
      row('Status', f.kind === 'new' ? 'New trial issued' : 'Existing trial re-sent') +
      row('Name', f.name) +
      row('Company', f.company) +
      row('Email', f.email) +
      row('Farm ID', f.farmId) +
      row('Instance ID', f.instanceId ?? null) +
      row('Product', f.sku) +
      row('Licence', f.licenceId) +
      row('Expires', day(f.expiresAt)) +
      row('Requested from', f.source === 'product' ? 'Inside the product (online activation)' : 'usertasks.com trial form'),
    notificationIcon: 'rocket_launch',
    subTab: TRIALS_SUBTAB,
    subTabColor: TRIALS_SUBTAB_COLOR,
    replyTo: f.email,
  }
}

/** The facts recorded with the request in the owner's team_requests inbox (kind 'trial'). */
export function trialTeamFacts(f: TrialFacts): { farm_id: string; expires_at: string; new_or_resent: 'new' | 'resent'; sku: string } {
  return { farm_id: f.farmId, expires_at: f.expiresAt, new_or_resent: f.kind, sku: f.sku }
}

/**
 * One team_requests row plus one ChirpMe notification (notifyTeam; never
 * deliverChirp as well). Never throws; runs inside after()
 * (lib/licensing/trial-service.ts), so the response never waits for it.
 */
export async function notifyTrial(f: TrialFacts): Promise<void> {
  try {
    await notifyTeam({ kind: 'trial', name: f.name, email: f.email, company: f.company, facts: trialTeamFacts(f), message: trialChirp(f), logTag: 'sp-trial' })
  } catch (error) {
    console.error('[sp-trial] team notification failed', error)
  }
}
