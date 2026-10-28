import { redirect } from 'next/navigation'
import { getConsentRequest } from '@/app/actions/oauth-consent'
import { SCOPE_DESCRIPTIONS } from '@/lib/oauth/scopes'
import { ConsentForm } from './consent-form'

export const dynamic = 'force-dynamic'

/**
 * OAuth consent screen — the human authorization step of the authorization_code
 * flow. The request is loaded server-side by its opaque id and verified to
 * belong to the logged-in user; the form carries only that id.
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>
}) {
  const { request } = await searchParams
  if (!request) redirect('/tasks')

  const consent = await getConsentRequest(request)
  if (!consent) {
    return (
      <main style={{ fontFamily: 'system-ui', maxWidth: '32rem', margin: '4rem auto', padding: '0 1rem' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Authorization request expired</h1>
        <p style={{ color: '#64748b' }}>
          This request is no longer valid. Please start again from the application you were connecting.
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--theme-surface, #f8fafc)' }}>
      <div
        className="w-full max-w-md rounded-2xl border p-6"
        style={{ backgroundColor: 'var(--theme-card-bg, #fff)', borderColor: 'var(--theme-surface-border, #e2e8f0)' }}
      >
        <h1 className="text-lg font-semibold" style={{ color: 'var(--theme-card-text, #0f172a)' }}>
          Authorize {consent.clientName}
        </h1>
        {consent.clientKind === 'first_party' && (
          <p
            className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: 'var(--theme-success-bg, #dcfce7)', color: 'var(--theme-success-text, #166534)' }}
          >
            <span aria-hidden>✓</span> Verified · made by UserTasks
          </p>
        )}
        {consent.clientKind === 'unverified' && (
          <p
            className="mt-2 rounded-lg px-3 py-2 text-xs"
            style={{ backgroundColor: 'var(--theme-warning-bg, #fef3c7)', color: 'var(--theme-warning-text, #92400e)' }}
          >
            <strong>Unverified app.</strong> This app registered itself and its name has not been checked. Only continue if you started this connection yourself.
          </p>
        )}
        <p className="text-sm mt-1" style={{ color: 'var(--theme-muted-text, #64748b)' }}>
          <strong>{consent.clientName}</strong> is requesting access to
          {consent.tenantName ? <> your <strong>{consent.tenantName}</strong> workspace</> : ' your workspace'} with:
        </p>

        <ul className="mt-4 space-y-2">
          {consent.scopes.map((scope) => (
            <li key={scope} className="flex items-start gap-2 text-sm" style={{ color: 'var(--theme-card-text, #0f172a)' }}>
              <span aria-hidden style={{ color: 'var(--theme-primary, #0d9488)' }}>✓</span>
              <span>{SCOPE_DESCRIPTIONS[scope] ?? scope}</span>
            </li>
          ))}
        </ul>

        <p className="text-xs mt-4" style={{ color: 'var(--theme-muted-text, #94a3b8)' }}>
          Access is limited to your own permissions and can be revoked at any time in Settings → OAuth Apps.
        </p>

        <ConsentForm requestId={request} />
      </div>
    </main>
  )
}
