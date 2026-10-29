import Link from 'next/link'
import { ArrowLeft, BookOpen, Info, RefreshCw } from 'lucide-react'
import type { InfrastructureView as View } from '@/lib/admin/infrastructure'
import type { CheckStatus } from '@/lib/admin/doctor'
import { providerFields } from '@/lib/config/provider-forms'
import { InlineNotice } from '@/components/ui/inline-notice'
import { HousekeepingCard } from './housekeeping-card'
import { RollbackWindowWarning } from './provider-switch-wizard'
import { AreaActions, SwitchLogPanel } from './switch-log-panel'

/**
 * Settings → Infrastructure body (server-rendered). Each area can be
 * switched to another provider (Change…) or have its provider's settings
 * edited (Settings) — the same engine as `usertasks-admin switch`, through
 * server actions that re-check instance-admin access. The switch log
 * follows running switches live and offers Cancel / Retry / Rollback.
 */


const HEALTH: Record<CheckStatus, { label: string; color: string; bg: string }> = {
  ok: { label: 'Healthy', color: 'var(--status-done)', bg: 'var(--status-done-bg)' },
  warn: { label: 'Warning', color: 'var(--status-progress)', bg: 'var(--status-progress-bg)' },
  fail: { label: 'Failing', color: 'var(--status-blocked)', bg: 'var(--status-blocked-bg)' },
  skip: { label: 'Not checked', color: 'var(--status-todo)', bg: 'var(--status-todo-bg)' },
}

// Per-check status text: a check that doesn't apply (or can't run here) is information, not a problem.
const CHECK_LABELS: Record<CheckStatus, string> = { ok: 'OK', warn: 'WARN', fail: 'FAIL', skip: 'INFO' }

/** Info icon with the explanation as its tooltip (and its accessible name). */
function NoteTip({ note }: { note: string }) {
  return (
    <span className="inline-flex align-middle ml-1 cursor-help" title={note} aria-label={note} role="img" tabIndex={0} style={{ color: 'var(--theme-muted-text)' }}>
      <Info size={13} aria-hidden />
    </span>
  )
}

const BADGE_LABELS: Record<string, string> = { 'on-prem': 'On-prem', aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud', supabase: 'Supabase', cloud: 'Cloud' }
const SOURCE_LABELS: Record<string, string> = { env: 'environment', settings: 'instance setting', default: 'default' }

function Pill({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ color, backgroundColor: bg }}>{children}</span>
}

export function InfrastructureView({ view }: { view: View }) {
  const muted = { color: 'var(--theme-muted-text)' }
  const card = { backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm mb-2" style={muted}><ArrowLeft size={14} /> Settings</Link>
        <h1 className="text-2xl font-semibold">Infrastructure</h1>
        <p className="text-sm mt-1" style={muted}>
          The provider each area of this instance runs on, with health checks. Change a provider or its settings here, or
          with <code>usertasks-admin switch</code> on the server — both use the same checks, backups, switch log and rollback.
        </p>
      </div>

      {!view.switching.gate.enabled && (view.switching.hasDb
        ? <InlineNotice tone="warning" message={view.switching.gate.reason ?? 'Changing providers from this page is turned off.'} />
        : (
          // No DATABASE_URL is a supported setup (Supabase provider): information, not a warning.
          <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }} role="note">
            <Info size={14} className="shrink-0 mt-px" aria-hidden />
            <span>{view.switching.gate.reason ?? 'Changing providers from this page is turned off.'}</span>
          </div>
        ))}
      {view.switching.gate.enabled && view.switching.recentSwitchArea && <RollbackWindowWarning area={view.switching.recentSwitchArea} />}

      <div className="flex flex-wrap items-center gap-3 text-xs" style={muted}>
        <span>Version {view.appVersion}</span>
        <span>Checked {new Date(view.checkedAt).toLocaleString()}</span>
        <Link href="/settings/infrastructure?refresh=1" className="inline-flex items-center gap-1 underline"><RefreshCw size={12} /> Re-run checks</Link>
        <Link href="/docs/self-hosting/switching-providers" className="inline-flex items-center gap-1 underline"><BookOpen size={12} /> Switching providers</Link>
      </div>

      <div className="grid gap-3">
        {view.areas.map((area) => {
          const health = HEALTH[area.health]
          return (
            <section key={area.area} className="rounded-xl border p-4" style={card} aria-label={area.label}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold mr-1">{area.label}</h2>
                <span className="text-sm">{area.providerLabel}</span>
                <code className="text-xs" style={muted}>{area.provider}</code>
                {area.badges.map((badge) => (
                  <Pill key={badge} color="var(--theme-muted-text)" bg="var(--theme-surface-border)">{BADGE_LABELS[badge] ?? badge}</Pill>
                ))}
                <span className="ml-auto flex items-center gap-2">
                  <AreaActions area={area.area} label={area.label} hasSettings={providerFields(area.area, area.provider).length > 0} enabled={view.switching.gate.enabled} />
                  <Pill color={health.color} bg={health.bg}>{health.label}</Pill>
                </span>
              </div>
              <p className="text-xs mt-1" style={muted}>
                Set by {SOURCE_LABELS[area.source] ?? area.source} · <Link href={area.docs} className="underline">docs</Link>
              </p>
              {area.checks.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {area.checks.map((check, i) => (
                    <li key={check.name} className="flex gap-2">
                      <span className="shrink-0 w-24 text-xs font-medium pt-0.5" style={{ color: HEALTH[check.status].color }}>{CHECK_LABELS[check.status]}</span>
                      <span className="shrink-0 w-28 text-xs pt-0.5" style={muted}>{check.name}</span>
                      <span className="min-w-0 break-words">{check.detail}{check.note && check.note !== area.checks[i - 1]?.note && <NoteTip note={check.note} />}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <HousekeepingCard initial={view.housekeeping} error={view.housekeepingError} />

      <SwitchLogPanel initial={view.switches} error={view.switchLogError} busy={view.switching.busy} />
    </div>
  )
}
