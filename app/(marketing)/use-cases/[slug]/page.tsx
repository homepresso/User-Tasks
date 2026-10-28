import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { UseCasePage } from '@/components/marketing/use-case-page'
import { getUseCase, USE_CASES } from '@/lib/use-cases'

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return USE_CASES.map((useCase) => ({ slug: useCase.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const useCase = getUseCase((await params).slug)
  if (!useCase) return {}
  const url = `/use-cases/${useCase.slug}`
  return {
    title: `${useCase.metaTitle} | UserTasks`,
    description: useCase.description,
    keywords: useCase.keywords,
    alternates: { canonical: url },
    openGraph: { title: useCase.metaTitle, description: useCase.description, url, type: 'article' },
  }
}

export default async function UseCaseRoute({ params }: Props) {
  const useCase = getUseCase((await params).slug)
  if (!useCase) notFound()
  return <UseCasePage useCase={useCase} />
}
