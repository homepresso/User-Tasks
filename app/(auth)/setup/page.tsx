import { notFound, redirect } from 'next/navigation'
import { after } from 'next/server'
import { isCloud } from '@/lib/deployment'
import { pageMetadata } from '@/lib/page-title'
import { setupDb, setupNeeded } from '@/lib/setup/server'
import { announceSetupCode } from '@/lib/setup/state'
import { SetupForm } from './setup-form'

export const metadata = { ...pageMetadata('Create your admin account'), robots: { index: false, follow: false } }

// Whether setup is needed is a runtime fact about the database.
export const dynamic = 'force-dynamic'

/**
 * First-run setup (self-hosted, a brand-new install with no workspaces and no
 * users): create the first workspace and its owner. Cloud: 404. Once set up:
 * /login. Each visit while setup is needed logs the setup code again (at most
 * every 30 s), so the operator can find it in the newest log lines.
 */
export default async function SetupPage() {
  if (isCloud()) notFound()
  if (!(await setupNeeded())) redirect('/login')
  after(() => announceSetupCode(setupDb(), { startup: false }))
  return <SetupForm />
}
