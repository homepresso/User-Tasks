import { getAuthProvider } from '@/lib/providers/auth'
import { SsoDoneReporter } from '@/components/embed/embed-sign-in'

/**
 * Where an automatic sign-in started from a frame or a popup ends
 * (lib/providers/auth/sso/auto.ts SSO_DONE_PATH). Under /embed/ so the
 * approved sites may frame it (it runs in a hidden frame inside the
 * embedded page). Tells the page that started it — the parent frame or the
 * popup's opener, same origin only — whether this browser is signed in now,
 * then closes (popup). Carries no identity: the page simply reloads.
 */
export const dynamic = 'force-dynamic'

export default async function SsoDonePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams
  const raw = typeof query.sso_error === 'string' ? query.sso_error : null
  const error = raw && /^[a-z_]{1,40}$/.test(raw) ? raw : null
  const user = await (await getAuthProvider()).getSessionUser().catch(() => null)
  return <SsoDoneReporter ok={Boolean(user) && !error} error={error ?? (user ? null : 'not_signed_in')} />
}
