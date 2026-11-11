import { redirect } from 'next/navigation'
import { FormsLibrary } from '@/components/forms/forms-library'
import { legacyFormsRedirect } from '@/lib/forms/designer-links'

/**
 * Automations → Forms: the library renders its own PageHeader (its actions
 * and tabs are client state). Old links into its designer dialog —
 * ?open=<id>, ?new=1 — go to the designer page.
 */
export default async function FormsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const to = legacyFormsRedirect(await searchParams)
  if (to) redirect(to)
  return <FormsLibrary />
}
