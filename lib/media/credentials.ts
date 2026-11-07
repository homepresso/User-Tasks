/**
 * Media provider credentials (server-only).
 *
 * A media step / agent tool names a workspace integration (made from a
 * connector: OpenAI, Google Gemini, Azure AI Speech, …). It is loaded for
 * the run's tenant only (another workspace's id is "not found"), must be
 * active and of a media type, is decrypted (lib/secret-fields) and its
 * `secret://` values are resolved from the secret store — only references
 * under the workspace's own prefix (lib/config/tenant-secret-refs).
 *
 * credentialsFromIntegration() is pure: it maps the stored integration
 * config (what the connector presets build) to MediaCredentials. A
 * base_url override is honoured (local mock servers, proxies, EU hosts).
 * Nothing here logs; credentials never reach a log line or an error.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { resolveTenantSecretRefs } from '@/lib/config/tenant-secret-refs'
import { mediaProviderForType, type MediaProviderInfo } from './catalog'
import type { MediaCredentials, MediaProviderId } from './types'

export class MediaCredentialsError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'inactive' | 'unsupported' | 'no_key' | 'invalid' = 'invalid') {
    super(message)
    this.name = 'MediaCredentialsError'
  }
}

/** Public endpoints (used when the integration has no base_url). */
export const DEFAULT_BASE_URLS: Record<MediaProviderId, string> = {
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  azure_speech: '',
  azure_vision: '',
  aws: '',
  deepgram: 'https://api.deepgram.com',
  assemblyai: 'https://api.assemblyai.com',
  elevenlabs: 'https://api.elevenlabs.io',
  stability: 'https://api.stability.ai',
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** "Bearer x" / "Token x" → "x". */
function stripScheme(value: string): string {
  return value.replace(/^(bearer|token|basic)\s+/i, '').trim()
}

/** Non-secret auth_config keys copied into `extra` (default models, voice, organisation, …). */
const EXTRA_KEYS = ['default_model', 'transcribe_model', 'vision_model', 'video_model', 'image_model', 'tts_model', 'voice', 'language', 'organization', 'project', 'api_version', 'speech_region']

/**
 * Integration (decrypted, secrets resolved) → MediaCredentials. Throws when
 * the type is not a media provider.
 */
export function credentialsFromIntegration(integration: { id: string; type: string; config: any }): MediaCredentials {
  const provider = mediaProviderForType(integration.type)
  if (!provider) throw new MediaCredentialsError(`Integration type "${integration.type}" is not a media AI provider`, 'unsupported')
  const config = integration.config && typeof integration.config === 'object' ? integration.config : {}
  const auth = config.auth_config && typeof config.auth_config === 'object' ? config.auth_config : {}
  const headers: Record<string, unknown> = config.headers && typeof config.headers === 'object' ? config.headers : {}

  const rawKey = str(auth.token) || str(auth.key_value) || str(auth.api_key) || str(auth.apiKey) || str(auth.subscription_key)
  const apiKey = rawKey ? stripScheme(rawKey) : undefined
  const region = str(auth.region) || str(config.region) || undefined
  let endpoint = (str(auth.endpoint) || str(config.endpoint)).replace(/\/+$/, '') || undefined
  let baseUrl = str(config.base_url).replace(/\/+$/, '') || DEFAULT_BASE_URLS[provider.id]

  const extra: Record<string, string> = {}
  for (const key of EXTRA_KEYS) {
    const v = str(auth[key]) || str(config[key])
    if (v) extra[key] = v
  }
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string' || !value) continue
    if (name.toLowerCase() === 'openai-organization') extra.organization = value
    if (name.toLowerCase() === 'openai-project') extra.project = value
  }

  if (provider.id === 'azure_vision') {
    endpoint = endpoint || baseUrl || undefined
    baseUrl = baseUrl || endpoint || ''
  }
  if (provider.id === 'azure_speech') {
    if (!baseUrl) baseUrl = endpoint || (region ? `https://${region}.api.cognitive.microsoft.com` : '')
  }
  if (provider.id === 'aws' && !baseUrl && region) baseUrl = `https://transcribe.${region}.amazonaws.com`

  const credentials: MediaCredentials = {
    provider: provider.id,
    integrationId: String(integration.id),
    baseUrl,
    extra,
  }
  if (apiKey) credentials.apiKey = apiKey
  if (region) credentials.region = region
  if (endpoint) credentials.endpoint = endpoint
  const accessKeyId = str(auth.access_key_id)
  const secretAccessKey = str(auth.secret_access_key)
  const sessionToken = str(auth.session_token)
  const bucket = str(auth.bucket) || str(config.bucket)
  if (accessKeyId) credentials.accessKeyId = accessKeyId
  if (secretAccessKey) credentials.secretAccessKey = secretAccessKey
  if (sessionToken) credentials.sessionToken = sessionToken
  if (bucket) credentials.bucket = bucket
  return credentials
}

/** What a provider needs before it can be called (clear messages, no secrets). */
export function missingCredentials(credentials: MediaCredentials): string | null {
  switch (credentials.provider) {
    case 'aws':
      if (!credentials.accessKeyId || !credentials.secretAccessKey) return 'The AWS integration needs an access key ID and secret access key'
      if (!credentials.region) return 'The AWS integration needs a region'
      return null
    case 'azure_speech':
      if (!credentials.apiKey) return 'The Azure AI Speech integration has no key'
      if (!credentials.region && !credentials.endpoint && !credentials.baseUrl) return 'The Azure AI Speech integration needs a region or endpoint'
      return null
    case 'azure_vision':
      if (!credentials.apiKey) return 'The Azure AI Vision integration has no key'
      if (!credentials.endpoint) return 'The Azure AI Vision integration needs the resource endpoint'
      return null
    default:
      return credentials.apiKey ? null : 'The integration has no API key'
  }
}

/** Keys in auth_config that may hold `secret://` references. */
const SECRET_REF_KEYS = ['token', 'key_value', 'api_key', 'apiKey', 'subscription_key', 'access_key_id', 'secret_access_key', 'session_token']

/**
 * The tenant's media integration, decrypted with secrets resolved. Another
 * workspace's integration id → not found; inactive / non-media → refused.
 */
export async function loadMediaCredentials(db: SupabaseClient, tenantId: string, integrationId: string): Promise<{ provider: MediaProviderInfo; credentials: MediaCredentials }> {
  const id = String(integrationId ?? '').trim()
  if (!id) throw new MediaCredentialsError('Choose an AI provider integration for this step', 'not_found')
  const { data: row } = await (db as any).from('integrations').select('id, type, config, tenant_id, is_active')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (!row) throw new MediaCredentialsError('The media AI provider integration was not found in this workspace', 'not_found')
  if (row.is_active === false) throw new MediaCredentialsError('The media AI provider integration is inactive', 'inactive')
  const provider = mediaProviderForType(row.type)
  if (!provider) throw new MediaCredentialsError(`Integration type "${row.type}" is not a media AI provider (use OpenAI, Google Gemini, Azure AI Speech, Azure AI Vision, AWS media, Deepgram, AssemblyAI, ElevenLabs or Stability AI)`, 'unsupported')
  const config = (decryptSensitiveFields(row.config ?? {}) ?? {}) as Record<string, any>
  const auth = config.auth_config && typeof config.auth_config === 'object' ? config.auth_config as Record<string, unknown> : {}
  const refs: Record<string, unknown> = {}
  for (const key of SECRET_REF_KEYS) if (auth[key] !== undefined) refs[key] = auth[key]
  let resolved: Record<string, unknown>
  try {
    resolved = await resolveTenantSecretRefs(tenantId, refs, `${provider.label} integration`)
  } catch (error: any) {
    throw new MediaCredentialsError(String(error?.message ?? 'Could not resolve a secret reference'), 'invalid')
  }
  const credentials = credentialsFromIntegration({ id: row.id, type: row.type, config: { ...config, auth_config: { ...auth, ...resolved } } })
  const missing = missingCredentials(credentials)
  if (missing) throw new MediaCredentialsError(missing, 'no_key')
  return { provider, credentials }
}
