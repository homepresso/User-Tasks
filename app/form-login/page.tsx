import type { Metadata } from 'next'
import { signInRoute, type SignInQuery } from '@/components/forms/sign-in/sign-in-route'

/**
 * The sign-in page of form links: /form-login?redirect=<form path>[&embed=1].
 * The same page as /sign-in (the workspace sign-in page for forms and apps,
 * components/forms/sign-in/sign-in-route.tsx); form links keep this address
 * so existing links and embeds keep working, and it stays frameable by any
 * site (lib/forms/embed.ts).
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function FormLoginPage({ searchParams }: { searchParams: Promise<SignInQuery> }) {
  return signInRoute(await searchParams)
}
