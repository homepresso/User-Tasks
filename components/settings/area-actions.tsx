import Link from 'next/link'
import { Settings2, Shuffle } from 'lucide-react'
import type { AreaActionStates } from '@/lib/admin/switch-runtime'
import type { InfrastructureAddonView } from '@/lib/infrastructure/provider'
import { isFreeSettingsChange } from '@/lib/infrastructure/addon'

/**
 * Settings → Infrastructure (and the setup wizard's Services step): an
 * area's Settings / Change… controls. Never a dead button:
 *
 *  - email and sign-in settings are free: Settings opens the setup wizard's
 *    Email / Sign-in panel;
 *  - with the Infrastructure add-on licensed, Change… (and Settings for the
 *    other areas) open the add-on's page for this area;
 *  - without it, Change… leads to the add-on card on this page (what it does,
 *    how to get it); on UserTasks Cloud (paid extensions are self-hosted
 *    only) there is no Change… at all.
 *
 * A disabled control (cloud lock, no direct connection) points at the note
 * under the card that says why and what to do (AreaActionNotes).
 */

const btn = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border'

export function AreaActions({ area, label, provider, actions, addon, upsellAnchor = '#infrastructure-addon' }: {
  area: string
  label: string
  provider: string
  actions: AreaActionStates
  addon: Pick<InfrastructureAddonView, 'state' | 'href' | 'cloud'>
  upsellAnchor?: string
}) {
  const ready = addon.state === 'ready' && addon.href
  const freeSettings = (area === 'email' || area === 'auth') && isFreeSettingsChange(area, provider)
  const why = (which: 'change' | 'settings') => (actions[which].enabled ? undefined : `${area}-${which === 'change' || (!actions.change.enabled && actions.change.block?.message === actions.settings.block?.message) ? 'change' : 'settings'}-why`)
  const border = { borderColor: 'var(--theme-surface-border)' }
  const disabled = (text: React.ReactNode, which: 'change' | 'settings', aria: string) => (
    <span className={`${btn} opacity-60 cursor-not-allowed`} style={border} aria-disabled="true" aria-label={aria} aria-describedby={why(which)} title={actions[which].block?.message}>{text}</span>
  )
  const settingsLabel = <><Settings2 size={13} aria-hidden /> Settings</>
  const changeLabel = <><Shuffle size={13} aria-hidden /> Change…</>
  let settings: React.ReactNode = null
  if (freeSettings) {
    const step = area === 'email' ? 'email' : 'sign-in'
    settings = actions.settings.enabled
      ? <Link href={`/settings/setup?step=${step}`} className={btn} style={border} aria-label={`${label} settings`}>{settingsLabel}</Link>
      : disabled(settingsLabel, 'settings', `${label} settings`)
  } else if (ready && actions.settings.block?.kind !== 'no-settings') {
    settings = actions.settings.enabled
      ? <Link href={`${addon.href}?area=${encodeURIComponent(area)}&kind=settings`} className={btn} style={border} aria-label={`${label} settings`}>{settingsLabel}</Link>
      : disabled(settingsLabel, 'settings', `${label} settings`)
  }
  let change: React.ReactNode
  if (!ready && addon.cloud) {
    // UserTasks Cloud: the add-on is for self-hosted installs; the status stays read-only.
    change = null
  } else if (!ready) {
    change = (
      <Link href={upsellAnchor} className={btn} style={border} aria-label={`Change ${label} provider (Infrastructure add-on)`} title="Changing providers needs the Infrastructure add-on" data-addon-link>
        {changeLabel}<span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>add-on</span>
      </Link>
    )
  } else {
    change = actions.change.enabled
      ? <Link href={`${addon.href}?area=${encodeURIComponent(area)}`} className={btn} style={border} aria-label={`Change ${label} provider`}>{changeLabel}</Link>
      : disabled(changeLabel, 'change', `Change ${label} provider`)
  }
  return <span className="flex gap-1">{settings}{change}</span>
}
