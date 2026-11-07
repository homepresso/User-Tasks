/**
 * Media providers (server-only): one module per vendor, each implementing
 * MediaProvider (lib/media/types.ts) with exactly the capabilities listed
 * in lib/media/catalog.ts (checked by __tests__/media-providers-*.test.ts).
 */

import type { MediaProvider, MediaProviderId } from '../types'
import { assemblyaiProvider } from './assemblyai'
import { awsProvider } from './aws'
import { azureSpeechProvider } from './azure-speech'
import { azureVisionProvider } from './azure-vision'
import { deepgramProvider } from './deepgram'
import { elevenlabsProvider } from './elevenlabs'
import { geminiProvider } from './gemini'
import { openaiProvider } from './openai'
import { stabilityProvider } from './stability'

export const MEDIA_PROVIDER_IMPLS: Record<MediaProviderId, MediaProvider> = {
  openai: openaiProvider,
  gemini: geminiProvider,
  azure_speech: azureSpeechProvider,
  azure_vision: azureVisionProvider,
  aws: awsProvider,
  deepgram: deepgramProvider,
  assemblyai: assemblyaiProvider,
  elevenlabs: elevenlabsProvider,
  stability: stabilityProvider,
}

export function getMediaProvider(id: MediaProviderId): MediaProvider {
  const provider = MEDIA_PROVIDER_IMPLS[id]
  if (!provider) throw new Error(`Unknown media provider "${id}"`)
  return provider
}
