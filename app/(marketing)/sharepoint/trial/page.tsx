import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { SHAREPOINT_TRIAL } from '@/lib/seo/sharepoint-facts'
import { SharePointTrialPage } from '@/components/marketing/sharepoint-trial-page'
import { trialSigner } from '@/lib/licensing/trial-issuer'
import { TRIAL_REQUEST_PREFIX } from '@/lib/licensing/trial-request'

export const metadata: Metadata = pageMetadata({
  path: SHAREPOINT_TRIAL.path,
  title: SHAREPOINT_TRIAL.metaTitle,
  description: SHAREPOINT_TRIAL.description,
  socialTitle: SHAREPOINT_TRIAL.title,
  keywords: ['SharePoint workflow free trial', 'SharePoint Server forms trial', 'InfoPath replacement trial', 'SharePoint 2010 workflow replacement trial'],
})

/**
 * /sharepoint/trial: the self-serve trial form (POST /api/public/trials/sharepoint).
 * `?code=UTTRIAL1-…` pre-fills an installation's request code (offline farms).
 * Without the trial key configured, the form is replaced by "Contact us".
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { code } = await searchParams
  const prefill = typeof code === 'string' && code.startsWith(TRIAL_REQUEST_PREFIX) ? code.slice(0, 4000) : ''
  return <SharePointTrialPage available={trialSigner().available} defaultCode={prefill} />
}
