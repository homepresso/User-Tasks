/**
 * A ChirpMe notification to the UserTasks team for each new beta signup
 * (cloud only). Sent after the signup response via after(), so a slow or
 * failing ChirpMe never affects signing up. Unset CHIRPME_* variables: nothing
 * is sent. The password is never part of the message.
 */
import { contactDeliveryConfigured, deliverChirp, escapeHtml, type ChirpMessage } from '@/lib/contact/chirpme'
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
  }
}

export async function notifyBetaSignup(f: BetaSignupFacts): Promise<void> {
  if (!contactDeliveryConfigured()) return
  try {
    await deliverChirp(betaSignupChirp(f), 'beta-signup')
  } catch (error) {
    console.error('[beta-signup] ChirpMe notification failed', error)
  }
}
