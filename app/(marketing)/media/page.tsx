import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { MediaPage } from '@/components/marketing/media-page'
import { MEDIA_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = pageMetadata({
  path: '/media',
  title: MEDIA_PAGE.metaTitle,
  description: MEDIA_PAGE.description,
  socialTitle: MEDIA_PAGE.title,
  keywords: ['ai transcription workflow', 'transcribe audio workflow', 'speaker diarization srt vtt', 'redact faces in images', 'blur license plates video', 'redact pii from audio', 'bleep sensitive speech', 'image analysis workflow', 'text to speech workflow', 'bring your own ai key media'],
})

export default function Page() {
  return <MediaPage />
}
