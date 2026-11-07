import type { Metadata } from 'next'
import { MediaPage } from '@/components/marketing/media-page'
import { MEDIA_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = {
  title: MEDIA_PAGE.metaTitle,
  description: MEDIA_PAGE.description,
  keywords: ['ai transcription workflow', 'transcribe audio workflow', 'speaker diarization srt vtt', 'redact faces in images', 'blur license plates video', 'redact pii from audio', 'bleep sensitive speech', 'image analysis workflow', 'text to speech workflow', 'bring your own ai key media'],
  alternates: { canonical: '/media' },
  openGraph: { title: MEDIA_PAGE.title, description: MEDIA_PAGE.description, url: '/media', type: 'website' },
}

export default function Page() {
  return <MediaPage />
}
