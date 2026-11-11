import type { Metadata } from 'next'
import { StartPage } from '@/components/marketing/start-page'

export const metadata: Metadata = {
  title: 'Start free | UserTasks',
  description: 'Create your own UserTasks workspace: workflows, forms, tasks and the AI Agent, free during the beta.',
  alternates: { canonical: '/start' },
  // A sign-up step, not a landing page: kept out of search results and the sitemap.
  robots: { index: false, follow: true },
}

/** Cloud self-signup (the betaSignup server action). `?email=` comes from the email fields on the homepage. */
export default async function Start({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { email, next } = await searchParams
  const value = typeof email === 'string' ? email.trim().slice(0, 254) : ''
  return <StartPage email={value} next={next === 'infopath' ? 'infopath' : null} />
}
