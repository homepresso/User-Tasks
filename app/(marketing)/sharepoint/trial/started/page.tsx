import type { Metadata } from 'next'
import { SharePointTrialStarted } from '@/components/marketing/sharepoint-trial-started'

export const metadata: Metadata = {
  title: 'Your SharePoint trial has started | UserTasks',
  description: 'Your 30-day UserTasks for SharePoint trial licence and what to do next.',
  alternates: { canonical: '/sharepoint/trial/started' },
  // A step after the form, not a landing page.
  robots: { index: false, follow: false },
}

export default function Page() {
  return <SharePointTrialStarted />
}
