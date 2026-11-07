import { Suspense } from 'react'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { OrgManagePage } from '@/components/org/manage/org-manage-page'

/** /org/manage — edit people attributes, org units, teams and projects; import / export (?tab=). */
export default function ManageOrganizationPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="settings" />}>
      <OrgManagePage />
    </Suspense>
  )
}
