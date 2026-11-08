import type { Metadata } from 'next'
import { AiAssistantsPage } from '@/components/marketing/ai-assistants-page'
import { AI_ASSISTANTS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = {
  title: AI_ASSISTANTS_PAGE.metaTitle,
  description: AI_ASSISTANTS_PAGE.description,
  keywords: ['ai co-worker', 'in-app ai agent', 'ai form filling assistant', 'ai task summary', 'ai workflow builder', 'bring your own ai key', 'self-hosted llm assistant', 'ollama assistant', 'openai compatible assistant', 'ai approvals human in the loop', 'ai assistant cost cap', 'open source ai assistant forms'],
  alternates: { canonical: '/ai-assistants' },
  openGraph: { title: AI_ASSISTANTS_PAGE.title, description: AI_ASSISTANTS_PAGE.description, url: '/ai-assistants', type: 'website' },
}

export default function Page() {
  return <AiAssistantsPage />
}
