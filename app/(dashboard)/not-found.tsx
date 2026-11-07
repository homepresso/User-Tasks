import { NotFoundView } from '@/components/layout/route-states'
import { pageMetadata } from '@/lib/page-title'

export const metadata = pageMetadata('Page not found')

/** notFound() inside the dashboard: the 404 within the shell. */
export default function DashboardNotFound() {
  return <NotFoundView inShell />
}
