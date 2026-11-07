import Link from 'next/link'
import { ArrowLeft, BookOpen, Database, Info, Lock, LockOpen, RefreshCw } from 'lucide-react'
import type { InfrastructureView as View } from '@/lib/admin/infrastructure'
import type { CheckStatus } from '@/lib/admin/doctor'
import { InlineNotice } from '@/components/ui/inline-notice'
import { HousekeepingCard } from './housekeeping-card'
import { AiPricesCard } from './ai-prices-card'
import type { ModelPrice } from '@/lib/agents/pricing'
import { RollbackWindowWarning } from './provider-switch-wizard'
import { AreaActions, SwitchLogPanel } from './switch-log-panel'
import { AreaActionNotes, DatabaseUrlHelp, UiLockButton } from './infrastructure-actions'

/**
 * Settings → Infrastructure body (server-rendered). Each area can be
 * switched to another provider (Change…) or have its provider's settings
 * edited (Settings) — the same engine as `usertasks-admin switch`, through
 * server actions that re-check instance-admin access. Both buttons are
 * always there: a disabled one says why and what to do (the cloud lock with
 * its Unlock control, a missing DATABASE_URL with how to add it). The switch
 * log follows running switches live and offers Cancel / Retry / Rollback.
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

/** How changes from this page work here: the cloud lock (Unlock / Lock), the connection they use, and what needs DATABASE_URL. */
function SwitchingStatus({ switching }: { switching: View['switching'] }) {
  const box = 'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs'
  const border = { borderColor: 'var(--theme-surface-border)' }
  const { gate, access } = switching
  return (
    <div className="space-y-2" aria-label="Provider changes from this page">
      {access === 'none' && <InlineNotice tone="warning" message={gate.reason ?? 'Provider changes cannot be made from this page.'} />}
      {access !== 'none' && gate.code === 'flag-off' && <InlineNotice tone="warning" message={gate.reason ?? 'Changes from this page are turned off.'} />}
      {access !== 'none' && gate.code === 'unavailable' && <InlineNotice tone="warning" message={gate.reason ?? 'Changes from this page are unavailable.'} />}
      {gate.code === 'cloud-locked' && (
        <div className={`${box} flex-wrap`} style={{ ...border, backgroundColor: 'var(--status-warning-bg)' }} role="note" data-lock="locked">
          <Lock size={14} className="shrink-0 mt-px" aria-hidden />
          <span className="flex-1 min-w-[14rem]">{gate.reason}</span>
          <UiLockButton allow />
        </div>
      )}
      {gate.enabled && gate.lockable && (
        <div className={`${box} flex-wrap`} style={border} role="note" data-lock="unlocked">
          <LockOpen size={14} className="shrink-0 mt-px" aria-hidden />
          <span className="flex-1 min-w-[14rem]">Unlocked: instance admins can change providers and settings from this page on this cloud deployment. Lock it again when you are done.</span>
          <UiLockButton allow={false} variant="outline" />
        </div>
      )}
      {access === 'api' && (
        <div className={box} style={{ ...border, color: 'var(--theme-muted-text)' }} role="note" data-access="api">
          <Database size={14} className="shrink-0 mt-px" aria-hidden />
          <div className="space-y-1 min-w-0">
            <p>
              No direct database connection (DATABASE_URL): configuration changes — realtime, email, secrets, cache, scheduler (without pg_cron),
              the KMS provider (before any data key exists), storage settings — and their rollback run through the Supabase service-role API.
              Switching the database, auth or storage copies data and needs DATABASE_URL.
            </p>
            <DatabaseUrlHelp compact />
          </div>
        </div>
      )}
    </div>
  )
}

export function InfrastructureView({ view, aiPrices = [] }: { view: View; aiPrices?: ModelPrice[] }) {
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

      <SwitchingStatus switching={view.switching} />
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
                  <AreaActions area={area.area} label={area.label} actions={area.actions} />
                  <Pill color={health.color} bg={health.bg}>{health.label}</Pill>
                </span>
              </div>
              <p className="text-xs mt-1" style={muted}>
                Set by {SOURCE_LABELS[area.source] ?? area.source} · <Link href={area.docs} className="underline">docs</Link>
              </p>
              <AreaActionNotes area={area.area} actions={area.actions} />
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

      <AiPricesCard initial={aiPrices} />

      <SwitchLogPanel initial={view.switches} error={view.switchLogError} busy={view.switching.busy} />
    </div>
  )
}
