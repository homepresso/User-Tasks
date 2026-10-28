import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Wordmark } from '@/components/brand/logo'

export default async function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  // Look up invitation by token
  const { data: invite } = await (supabase as any)
    .from('invitations')
    .select('*, tenant:tenants(id, name, slug)')
    .eq('token', token)
    .is('accepted_at', null)
    .single()

  if (!invite) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-full max-w-md text-center space-y-4">
          <h1 className="flex justify-center" aria-label="UserTasks">
            <Wordmark size={32} />
          </h1>
          <div className="rounded-xl border p-8 bg-white" style={{ borderColor: '#e2e8f0' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: '#1e293b' }}>Invitation not found</h2>
            <p className="text-sm" style={{ color: '#64748b' }}>
              This invitation may have expired, been revoked, or already been accepted.
            </p>
          </div>
          <Link href="/login" className="text-sm font-medium" style={{ color: '#977443' }}>
            Go to login
          </Link>
        </div>
      </div>
    )
  }

  // Check if expired
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6" style={{ backgroundColor: '#FAF8F3' }}>
        <div className="w-full max-w-md text-center space-y-4">
          <h1 className="flex justify-center" aria-label="UserTasks">
            <Wordmark size={32} />
          </h1>
          <div className="rounded-xl border p-8 bg-white" style={{ borderColor: '#e2e8f0' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: '#1e293b' }}>Invitation expired</h2>
            <p className="text-sm" style={{ color: '#64748b' }}>
              This invitation has expired. Please ask your administrator to send a new one.
            </p>
          </div>
          <Link href="/login" className="text-sm font-medium" style={{ color: '#977443' }}>
            Go to login
          </Link>
        </div>
      </div>
    )
  }

  const tenantSlug = invite.tenant?.slug ?? ''
  const tenantName = invite.tenant?.name ?? 'an organisation'

  // Redirect to login with tenant pre-filled and invite token
  redirect(`/login?org=${encodeURIComponent(tenantSlug)}&invite=${token}`)
}
