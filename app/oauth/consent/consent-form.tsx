'use client'

import { useState } from 'react'
import { approveOAuthConsent, denyOAuthConsent } from '@/app/actions/oauth-consent'

export function ConsentForm({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(kind: 'approve' | 'deny') {
    setBusy(kind)
    setError(null)
    try {
      const { redirectTo } = kind === 'approve'
        ? await approveOAuthConsent(requestId)
        : await denyOAuthConsent(requestId)
      // Return to the third-party app (an off-origin, client-validated URI).
      window.location.href = redirectTo
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong')
      setBusy(null)
    }
  }

  return (
    <div className="mt-6">
      {error && <p className="text-xs mb-3" style={{ color: 'var(--theme-danger, #dc2626)' }}>{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => decide('deny')}
          disabled={busy !== null}
          className="flex-1 rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ borderColor: 'var(--theme-surface-border, #e2e8f0)', color: 'var(--theme-card-text, #0f172a)' }}
        >
          {busy === 'deny' ? 'Denying…' : 'Deny'}
        </button>
        <button
          type="button"
          onClick={() => decide('approve')}
          disabled={busy !== null}
          className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: 'var(--theme-primary, #0d9488)' }}
        >
          {busy === 'approve' ? 'Authorizing…' : 'Authorize'}
        </button>
      </div>
    </div>
  )
}
