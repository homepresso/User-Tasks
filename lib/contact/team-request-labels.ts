/**
 * Team request kinds, statuses and their labels (client-safe: no server
 * imports). Shared by notifyTeam (lib/contact/team-requests), the service
 * (lib/services/team-requests) and Settings → Requests.
 */

export const TEAM_REQUEST_KINDS = ['contact', 'feedback', 'docs_feedback', 'beta_signup', 'trial', 'other'] as const
export type TeamRequestKind = (typeof TEAM_REQUEST_KINDS)[number]

export const TEAM_REQUEST_STATUSES = ['new', 'in_progress', 'handled', 'spam'] as const
export type TeamRequestStatus = (typeof TEAM_REQUEST_STATUSES)[number]

/** "Open" = new + in progress (the page's default filter). */
export const OPEN_STATUSES: TeamRequestStatus[] = ['new', 'in_progress']

export const TEAM_REQUEST_KIND_LABELS: Record<TeamRequestKind, string> = {
  contact: 'Contact',
  feedback: 'Feedback',
  docs_feedback: 'Docs feedback',
  beta_signup: 'Beta signup',
  trial: 'Trial',
  other: 'Other',
}

export const TEAM_REQUEST_STATUS_LABELS: Record<TeamRequestStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  handled: 'Handled',
  spam: 'Spam',
}
