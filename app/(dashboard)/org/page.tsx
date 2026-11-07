import { Suspense } from 'react'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { OrgPage } from '@/components/org/org-page'

/** /org — Organization: org chart, org units, teams, projects (?view=, ?layout=). */
export default function OrganizationPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <OrgPage />
    </Suspense>
  )
}
