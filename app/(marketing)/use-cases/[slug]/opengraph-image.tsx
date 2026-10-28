import { OG_CONTENT_TYPE, OG_SIZE, renderHomeOgImage, renderOgImage } from '@/lib/brand/og'
import { getUseCase } from '@/lib/use-cases'

type Params = { slug: string }

/** Per-use-case link-preview card (see lib/brand/og.tsx). */
export async function generateImageMetadata({ params }: { params: Params | Promise<Params> }) {
  const useCase = getUseCase((await params).slug)
  return [{ id: 'card', alt: useCase ? `${useCase.metaTitle} — UserTasks` : 'UserTasks use case', size: OG_SIZE, contentType: OG_CONTENT_TYPE }]
}

export default async function Image({ params }: { params: Promise<Params> }) {
  const useCase = getUseCase((await params).slug)
  if (!useCase) return renderHomeOgImage()
  return renderOgImage({ eyebrow: useCase.eyebrow, title: useCase.title, subtitle: useCase.summary })
}
