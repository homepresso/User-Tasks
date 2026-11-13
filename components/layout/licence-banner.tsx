'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { InlineNotice } from '@/components/ui/inline-notice'
import { licenceBannerAction } from '@/app/actions/licence'
import type { LicenceWarning } from '@/lib/licensing/service'

/**
 * Licence banner in the app shell, for instance admins only: from 30 days
 * before a licence expires, after expiry (extensions stop 24 hours later),
 * and for an invalid licence. Fetched once per shell mount; dismissing hides
 * it for this browser tab session.
 */
const DISMISS_KEY = 'usertasks:licence-banner-dismissed'

export function LicenceBanner() {
  const [warnings, setWarnings] = useState<LicenceWarning[]>([])
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    try { setDismissed(sessionStorage.getItem(DISMISS_KEY)) } catch { /* private mode */ }
    licenceBannerAction().then((w) => { if (live) setWarnings(w) }).catch(() => undefined)
    return () => { live = false }
  }, [])

  if (!warnings.length) return null
  const top = warnings.find((w) => w.level === 'error') ?? warnings.find((w) => w.level === 'warn') ?? warnings[0]
  const signature = `${top.code}:${top.licenceId}:${top.daysLeft ?? ''}`
  // Errors (expired, invalid) can't be dismissed.
  if (top.level !== 'error' && dismissed === signature) return null
  return (
    <div className="shrink-0 px-4 pt-3 md:px-6">
      <InlineNotice
        banner
        tone={top.level === 'error' ? 'danger' : top.level === 'warn' ? 'warning' : 'info'}
        message={<>{top.message} <Link href="/settings/licence" className="font-medium underline">Settings → Licence</Link>{warnings.length > 1 ? ` (${warnings.length - 1} more)` : ''}</>}
        onDismiss={top.level === 'error' ? undefined : () => { try { sessionStorage.setItem(DISMISS_KEY, signature) } catch { /* ignore */ } setDismissed(signature) }}
      />
    </div>
  )
}
