/**
 * Daily licence check (job registry `licence-check`, 06:00 UTC; also
 * /api/cron/licence-check).
 *
 * For every installed licence it works out the current notice — 30 / 14 / 7
 * / 1 days before expiry, expired (the extensions stop in under 24 hours),
 * stopped (24 hours after expiry) — and, the first time each one applies,
 * emails the instance admins (INSTANCE_ADMIN_EMAILS + instance.admin_emails)
 * and records a licence event. Notices already sent are kept in the
 * `instance.licence_notices` setting (per licence id and expiry), so a re-run (or a second replica) does
 * not send twice. Re-checking also refreshes every process's cached licence
 * state within a minute.
 */

import { getLicenceStatus, invalidateLicenceCache, licensingDeps, type LicenceSummary } from '@/lib/licensing/service'
import { warningThreshold } from '@/lib/licensing/format'
import { LICENCE_NOTICES_SETTING } from '@/lib/licensing/store'

export type NoticeKey = `d${number}` | 'cutoff_pending' | 'expired'

/** The notice that applies to a licence now (null: none). */
export function noticeFor(l: Pick<LicenceSummary, 'valid' | 'timeState' | 'daysLeft'>): NoticeKey | null {
  if (!l.valid) return null
  if (l.timeState === 'expired') return 'expired'
  if (l.timeState === 'cutoff_pending') return 'cutoff_pending'
  if (l.timeState === 'expiring') {
    const threshold = warningThreshold(l.daysLeft)
    return threshold === null ? null : `d${threshold}`
  }
  return null
}

export type Notices = Record<string, Partial<Record<NoticeKey, string>>>

export interface LicenceCheckDeps {
  readNotices: () => Promise<Notices>
  writeNotices: (notices: Notices) => Promise<void>
  adminEmails: () => Promise<string[]>
  sendEmail: (to: string[], subject: string, body: string) => Promise<boolean>
  appUrl: () => string
}

async function defaultDeps(): Promise<LicenceCheckDeps> {
  const { getInstanceSetting, setInstanceSetting } = await import('@/lib/config/instance-settings')
  const { INSTANCE_ADMINS_SETTING, instanceAdminEmails } = await import('@/lib/admin/instance-admins')
  const { appUrlOrLocalhost } = await import('@/lib/config/bootstrap')
  return {
    readNotices: async () => {
      const value = await getInstanceSetting(LICENCE_NOTICES_SETTING)
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Notices) : {}
    },
    writeNotices: (notices) => setInstanceSetting(LICENCE_NOTICES_SETTING, notices),
    adminEmails: async () => [...instanceAdminEmails(await getInstanceSetting(INSTANCE_ADMINS_SETTING))],
    sendEmail: async (to, subject, body) => {
      const { sendEmail } = await import('@/lib/email')
      return (await sendEmail({ to, subject, body })).success
    },
    appUrl: appUrlOrLocalhost,
  }
}

function subjectFor(key: NoticeKey, l: LicenceSummary): string {
  const exts = l.extensions.map((e) => e.id).join(', ')
  if (key === 'expired') return `UserTasks licence ${l.licenceId} expired: ${exts} stopped`
  if (key === 'cutoff_pending') return `UserTasks licence ${l.licenceId} expired: ${exts} stop within 24 hours`
  return `UserTasks licence ${l.licenceId} expires in ${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'}`
}

function bodyFor(key: NoticeKey, l: LicenceSummary, appUrl: string): string {
  const exts = l.extensions.map((e) => e.id).join(', ')
  const lines = [
    `Licence: ${l.licenceId} (${l.customer ?? 'unknown customer'})`,
    `Extensions: ${exts}`,
    `Expires: ${l.expiresAt}`,
    `Extensions stop at: ${l.cutoffAt} (24 hours after expiry)`,
    '',
  ]
  if (key === 'expired') {
    lines.push('The licence has expired and the licensed extensions have stopped: their triggers no longer start runs, their API returns a licence error, and workflow steps that use them fail with a retryable "licence expired" error. Nothing has been deleted.')
    lines.push('Install a renewed licence, then retry the failed jobs from the workflow queue.')
  } else if (key === 'cutoff_pending') {
    lines.push('The licence has expired. The licensed extensions keep working for 24 hours after expiry and then stop. Install a renewed licence now to avoid an interruption.')
  } else {
    lines.push('Renew the licence before it expires. The licensed extensions stop 24 hours after the expiry time.')
  }
  lines.push('', `Settings → Licence: ${appUrl.replace(/\/$/, '')}/settings/licence`, 'Or on the server: usertasks-admin licence status')
  return lines.join('\n')
}

export interface LicenceCheckResult {
  licences: number
  notices: Array<{ licence_id: string; notice: NoticeKey; emailed: number }>
}

export async function runLicenceCheck(deps?: Partial<LicenceCheckDeps>): Promise<LicenceCheckResult> {
  const d = { ...(await defaultDeps()), ...deps }
  invalidateLicenceCache()
  const status = await getLicenceStatus({ fresh: true })
  const notices = await d.readNotices()
  const result: LicenceCheckResult = { licences: status.licences.length, notices: [] }
  let changed = false
  const live = new Set<string>()
  for (const l of status.licences) {
    if (!l.licenceId) continue
    // Keyed by licence and expiry, so a re-issued licence (same id, new date) warns again.
    const slot = `${l.licenceId}|${l.expiresAt ?? ''}`
    live.add(slot)
    const key = noticeFor(l)
    if (!key || notices[slot]?.[key]) continue
    const to = await d.adminEmails()
    let emailed = 0
    if (to.length && (await d.sendEmail(to, subjectFor(key, l), bodyFor(key, l, d.appUrl())).catch(() => false))) emailed = to.length
    await licensingDeps.audit({
      event: key === 'expired' || key === 'cutoff_pending' ? 'expired' : 'expiring',
      licenceId: l.licenceId,
      actor: 'job',
      summary: subjectFor(key, l),
      detail: { notice: key, expires_at: l.expiresAt, cutoff_at: l.cutoffAt, emailed },
    })
    notices[slot] = { ...notices[slot], [key]: status.now }
    result.notices.push({ licence_id: l.licenceId, notice: key, emailed })
    changed = true
  }
  // Forget licences that are no longer installed.
  for (const id of Object.keys(notices)) if (!live.has(id)) { delete notices[id]; changed = true }
  if (changed) await d.writeNotices(notices)
  return result
}
