/**
 * A team request (Settings → Requests) and ChirpMe notification for each new
 * beta signup (cloud only), through notifyTeam. Sent after the signup
 * response via after(), so a slow or failing ChirpMe never affects signing
 * up. With team requests off and no channel configured nothing is sent. The
 * password is never part of the message.
 */
import { escapeHtml, type ChirpMessage } from '@/lib/contact/chirpme'
import { notifyTeam, teamNotifyAvailable } from '@/lib/contact/team-requests'
import { publicBaseUrl } from '@/lib/deployment'

export interface BetaSignupFacts {
  fullName: string
  email: string
  company: string
  companySize?: string | null
  useCase?: string | null
  slug?: string | null
}

export function betaSignupChirp(f: BetaSignupFacts, baseUrl: string = publicBaseUrl()): ChirpMessage {
  const row = (label: string, value: string | null | undefined) =>
    value ? `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>` : ''
  return {
    title: `New beta signup — ${f.company}`,
    body: `${f.fullName} (${f.email}) signed up ${f.company} for the beta.`,
    url: `${baseUrl}/start`,
    detail:
      '<h2>New beta signup</h2>' +
      row('Name', f.fullName) +
      row('Email', f.email) +
      row('Company', f.company) +
      row('Company size', f.companySize) +
      row('Workspace', f.slug) +
      (f.useCase ? `<h3>What they want to use it for</h3><p>${escapeHtml(f.useCase).replace(/\n/g, '<br>')}</p>` : ''),
    notificationIcon: 'person_add',
    subTab: 'Signups',
    subTabColor: '#22C55E',
    replyTo: f.email,
  }
}

export async function notifyBetaSignup(f: BetaSignupFacts): Promise<void> {
  if (!teamNotifyAvailable()) return
  try {
    await notifyTeam({
      kind: 'beta_signup',
      name: f.fullName,
      email: f.email,
      company: f.company,
      facts: { company_size: f.companySize ?? null, workspace: f.slug ?? null, use_case: f.useCase ?? null },
      message: betaSignupChirp(f),
      logTag: 'beta-signup',
    })
  } catch (error) {
    console.error('[beta-signup] team notification failed', error)
  }
}
