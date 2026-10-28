import { redirect } from 'next/navigation'

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; invite?: string }>
}) {
  // Signup is handled by the unified login page (self-signup there follows
  // the deployment mode). Redirect with any org/invite params preserved.
  const { org, invite } = await searchParams
  const params = new URLSearchParams()
  if (typeof org === 'string' && org) params.set('org', org)
  if (typeof invite === 'string' && invite) params.set('invite', invite)
  const query = params.toString()
  redirect(query ? `/login?${query}` : '/login')
}
