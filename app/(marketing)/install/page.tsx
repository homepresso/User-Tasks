import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { INSTALL_PAGE } from '@/lib/seo/public-pages'
import { InstallPage as InstallContent } from '@/components/marketing/install-page'

export const metadata: Metadata = pageMetadata({
  path: '/install',
  title: INSTALL_PAGE.title,
  description: INSTALL_PAGE.description,
  socialTitle: 'Install UserTasks with one command',
})

export default function InstallPage() {
  return <InstallContent />
}
