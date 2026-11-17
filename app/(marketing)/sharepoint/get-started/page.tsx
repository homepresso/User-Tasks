import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { SHAREPOINT_GET_STARTED } from '@/lib/seo/sharepoint-facts'
import { SharePointGetStartedPage } from '@/components/marketing/sharepoint-get-started-page'
import { trialSigner } from '@/lib/licensing/trial-issuer'

export const metadata: Metadata = pageMetadata({
  path: SHAREPOINT_GET_STARTED.path,
  title: SHAREPOINT_GET_STARTED.metaTitle,
  description: SHAREPOINT_GET_STARTED.description,
  socialTitle: SHAREPOINT_GET_STARTED.title,
  keywords: ['SharePoint workflow setup', 'install SharePoint add-in on premises', 'SharePoint Server forms replacement setup', 'UserTasks SharePoint get started'],
})

export default function Page() {
  // The trial button links to the form once the trial key is configured (else "Contact us").
  return <SharePointGetStartedPage trialsAvailable={trialSigner().available} />
}
