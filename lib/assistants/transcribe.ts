/**
 * The Agent's dictation, server side (server only): which transcription
 * provider a workspace's dictation uses, and one transcription.
 *
 * The provider is (first that applies):
 *   1. the media connection chosen in Settings → Agent → Dictation
 *      (dictation.integration_id: an Integrations connection made from a
 *      media connector with transcription — OpenAI, Gemini, Azure AI Speech,
 *      AWS, Deepgram, AssemblyAI, ElevenLabs);
 *   2. the Agent's own Integrations connection, when it is such a connector
 *      (an OpenAI connection transcribes with Whisper on the same key);
 *   3. the Agent's own saved OpenAI key (Whisper via the same key / base URL).
 * The calls are the media steps' own (lib/media/providers/*), through the
 * egress-guarded integration transport (lib/media/http). The audio is held in
 * memory for the call only — never written to storage or logged.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret } from '@/lib/secret-crypto'
import { mediaProviderForType, type MediaProviderInfo } from '@/lib/media/catalog'
import { isAsyncJob, type MediaBlob, type MediaCost, type MediaCredentials, type MediaProvider, type TranscriptResult } from '@/lib/media/types'
import type { AssistantSettingsRow } from './settings'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped integration rows */

export class DictationUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'DictationUnavailableError' }
}

export interface TranscriptionSource { provider: MediaProviderInfo; credentials: MediaCredentials }

const transcribes = (p: MediaProviderInfo | null): boolean => Boolean(p?.capabilities.includes('transcribe'))

/**
 * Is a transcription provider configured (without decrypting anything)?
 * `agentIntegrationType` is the type of the Agent's own Integrations
 * connection, when it uses one (the caller looks it up only when needed).
 */
export function transcriptionConfigured(row: AssistantSettingsRow | null, agentIntegrationType?: string | null): boolean {
  if (!row) return false
  if (row.agent.dictation.integration_id) return true
  if (row.key_source === 'integration') return Boolean(row.integration_id) && transcribes(mediaProviderForType(agentIntegrationType))
  return row.provider === 'openai' && Boolean(row.api_key)
}

/** The provider and decrypted credentials dictation transcribes with. Throws DictationUnavailableError. */
export async function resolveTranscriptionSource(db: SupabaseClient, row: AssistantSettingsRow): Promise<TranscriptionSource> {
  const { loadMediaCredentials, MediaCredentialsError } = await import('@/lib/media/credentials')
  const load = async (id: string, allowUnsupported: boolean): Promise<TranscriptionSource | null> => {
    try {
      const loaded = await loadMediaCredentials(db, row.tenant_id, id)
      if (!transcribes(loaded.provider)) {
        if (allowUnsupported) return null
        throw new DictationUnavailableError(`${loaded.provider.label} can't transcribe audio — pick another connection in Settings → Agent → Dictation`)
      }
      return loaded
    } catch (error) {
      if (error instanceof DictationUnavailableError) throw error
      if (allowUnsupported && error instanceof MediaCredentialsError && error.code === 'unsupported') return null
      const message = error instanceof MediaCredentialsError ? error.message : 'The transcription connection could not be loaded'
      throw new DictationUnavailableError(`${message} — check Settings → Agent → Dictation`)
    }
  }
  const chosen = row.agent.dictation.integration_id
  if (chosen) return (await load(chosen, false))!
  if (row.key_source === 'integration' && row.integration_id) {
    const own = await load(row.integration_id, true)
    if (own) return own
  } else if (row.key_source === 'key' && row.provider === 'openai' && row.api_key) {
    let apiKey: string
    try { apiKey = decryptSecret(row.api_key) } catch { throw new DictationUnavailableError('The Agent\'s saved API key could not be decrypted') }
    const provider = mediaProviderForType('openai')!
    return { provider, credentials: { provider: 'openai', integrationId: 'assistant', baseUrl: row.base_url || 'https://api.openai.com', apiKey, extra: {} } }
  }
  throw new DictationUnavailableError('No transcription provider is set up for dictation — an admin can pick one in Settings → Agent → Dictation')
}

export interface DictationTranscript { text: string; provider: string; model: string | null; cost: MediaCost | null }

/**
 * One recording → text. Async providers (AssemblyAI, AWS) are polled within
 * `timeoutMs` and cleaned up. The audio is never kept.
 */
export async function transcribeRecording(source: TranscriptionSource, audio: MediaBlob, options: {
  language?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** Tests: the provider implementation. */
  impl?: MediaProvider
} = {}): Promise<DictationTranscript> {
  const { providerContext } = await import('@/lib/media/http')
  const impl = options.impl ?? (await import('@/lib/media/providers')).getMediaProvider(source.provider.id)
  if (!impl.transcribe) throw new DictationUnavailableError(`${source.provider.label} can't transcribe audio`)
  const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000)
  const ctx = providerContext(source.credentials, { signal, fetchImpl: options.fetchImpl, requestTimeoutMs: Math.min(options.timeoutMs ?? 60_000, 55_000) })
  let result: TranscriptResult
  const first = await impl.transcribe(audio, { language: options.language || undefined }, ctx)
  if (isAsyncJob(first)) {
    try {
      let wait = Math.min(first.pollAfterMs || 1000, 2000)
      for (;;) {
        if (signal.aborted) throw new DictationUnavailableError('The transcription took too long — try a shorter recording')
        await new Promise((r) => setTimeout(r, wait))
        const polled = await impl.poll!(first, ctx)
        if (polled.done) { result = polled.result as TranscriptResult; break }
        wait = Math.min(polled.pollAfterMs ?? 1500, 2000)
      }
    } finally {
      await impl.cleanup?.(first, ctx).catch(() => undefined)
    }
  } else {
    result = first
  }
  let cost: MediaCost | null = null
  if (result.usage) {
    try {
      const { priceMediaUsage, mediaPricesFromEnv } = await import('@/lib/media/pricing')
      cost = priceMediaUsage(source.provider.id, result.usage, mediaPricesFromEnv())
    } catch { cost = null }
  }
  return { text: String(result.text ?? '').replace(/\s+/g, ' ').trim(), provider: source.provider.id, model: result.model ?? null, cost }
}

/** The type of the Agent's own Integrations connection (null when it uses a key, or the connection is gone). */
export async function agentIntegrationType(db: SupabaseClient, row: AssistantSettingsRow): Promise<string | null> {
  if (row.key_source !== 'integration' || !row.integration_id) return null
  const { data } = await (db as any).from('integrations').select('type, is_active').eq('id', row.integration_id).eq('tenant_id', row.tenant_id).maybeSingle()
  return data && data.is_active !== false ? String(data.type ?? '') : null
}
