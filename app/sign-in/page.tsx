import type { Metadata } from 'next'
import { signInRoute, type SignInQuery } from '@/components/forms/sign-in/sign-in-route'

/**
 * The workspace sign-in page for forms and apps: /sign-in?redirect=<app or
 * form path>[&org=<workspace>][&embed=1]. Apps send visitors here; form
 * links use /form-login, the same page (components/forms/sign-in/sign-in-route.tsx).
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function SignInPage({ searchParams }: { searchParams: Promise<SignInQuery> }) {
  return signInRoute(await searchParams)
}
