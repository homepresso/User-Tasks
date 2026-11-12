import { DraftPreviewPage } from '@/components/forms/draft-preview-page'

/**
 * A form draft's preview (/forms/<id>/draft-preview): editors (forms.edit)
 * and the people / teams the draft was shared with ("Share draft") fill it
 * in as a test — nothing is submitted. Open to every signed-in member at
 * the route level (OPEN_ROUTES); the read (forms.draftPreview →
 * getDraftPreview) answers 404 to anyone else, and once the draft is
 * published or discarded.
 */
export default async function FormDraftPreviewRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DraftPreviewPage formId={id} />
}
