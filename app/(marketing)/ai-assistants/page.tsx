import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { AiAssistantsPage } from '@/components/marketing/ai-assistants-page'
import { AI_ASSISTANTS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = pageMetadata({
  path: '/ai-assistants',
  title: AI_ASSISTANTS_PAGE.metaTitle,
  description: AI_ASSISTANTS_PAGE.description,
  socialTitle: AI_ASSISTANTS_PAGE.title,
  keywords: ['ai co-worker', 'in-app ai agent', 'ai form filling assistant', 'ai task summary', 'ai workflow builder', 'bring your own ai key', 'self-hosted llm assistant', 'ollama assistant', 'openai compatible assistant', 'ai approvals human in the loop', 'ai assistant cost cap', 'open source ai assistant forms'],
})

export default function Page() {
  return <AiAssistantsPage />
}
