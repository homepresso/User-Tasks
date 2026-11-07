/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

import { getConnectorDefinition } from '@/lib/connectors/registry'
import { credentialsFromIntegration } from '@/lib/media/credentials'
import { assertNoSecretInUrls, runConnectorTemplate } from './helpers/connector-contract'

/**
 * Contract tests for the media AI connector presets: their reference
 * templates as the runtime sends them (lib/reference-executor →
 * lib/integrations/http), and the stored integration config each preset
 * builds read back by the media steps' credential loader.
 */

const KEYS: Record<string, string> = {
  deepgram: 'dg-fake-key-0001',
  assemblyai: 'aai-fake-key-0001',
  elevenlabs: 'xi-fake-key-0001',
  stability_ai: 'sk-stability-fake-0001',
  azure_ai_vision: 'az-vision-fake-0001',
}

describe('media connector templates', () => {
  it('Deepgram: list projects with Token auth', async () => {
    const { call, requests } = await runConnectorTemplate({ connector: 'deepgram', template: 'list_projects', credentials: { api_key: KEYS.deepgram } })
    expect(call).toMatchObject({ method: 'GET', url: 'https://api.deepgram.com/v1/projects' })
    expect(call.headers.authorization).toBe('Token ***')
    assertNoSecretInUrls(requests, [KEYS.deepgram])
  })

  it('AssemblyAI ships no reference template (the shared runtime adds a Bearer scheme its raw-key Authorization header does not use); the media steps call it directly', () => {
    expect(getConnectorDefinition('assemblyai')!.referenceTemplates).toEqual([])
  })

  it('ElevenLabs: voices with xi-api-key and a page size', async () => {
    const { call, requests } = await runConnectorTemplate({ connector: 'elevenlabs', template: 'list_voices', credentials: { api_key: KEYS.elevenlabs }, inputs: { page_size: 10 } })
    expect(call.url).toBe('https://api.elevenlabs.io/v2/voices?page_size=10')
    expect(Object.keys(call.headers)).toContain('xi-api-key')
    assertNoSecretInUrls(requests, [KEYS.elevenlabs])
  })

  it('Stability AI: balance with a bearer token', async () => {
    const { call } = await runConnectorTemplate({ connector: 'stability_ai', template: 'account_balance', credentials: { api_key: KEYS.stability_ai } })
    expect(call).toMatchObject({ method: 'GET', url: 'https://api.stability.ai/v1/user/balance' })
    expect(call.headers.authorization).toBe('Bearer ***')
  })

  it('Azure AI Vision: analyze a URL with the subscription key header and a JSON body', async () => {
    const { call, requests } = await runConnectorTemplate({
      connector: 'azure_ai_vision', template: 'analyze_image_url',
      config: { endpoint: 'https://acme-vision.cognitiveservices.azure.com/' }, credentials: { api_key: KEYS.azure_ai_vision },
      inputs: { image_url: 'https://example.com/a "quoted" image.png' },
    })
    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://acme-vision.cognitiveservices.azure.com/computervision/imageanalysis:analyze?api-version=2024-02-01&features=tags,read')
    expect(call.headers['ocp-apim-subscription-key']).toBe('***')
    expect(JSON.parse(call.body!)).toEqual({ url: 'https://example.com/a "quoted" image.png' })
    assertNoSecretInUrls(requests, [KEYS.azure_ai_vision])
  })
})

describe('presets → media credentials', () => {
  const cases: Array<[string, Record<string, any>, Record<string, any>, Record<string, unknown>]> = [
    ['deepgram', {}, { api_key: KEYS.deepgram }, { provider: 'deepgram', apiKey: KEYS.deepgram }],
    ['assemblyai', { data_region: 'eu' }, { api_key: KEYS.assemblyai }, { provider: 'assemblyai', apiKey: KEYS.assemblyai, baseUrl: 'https://api.eu.assemblyai.com' }],
    ['elevenlabs', {}, { api_key: KEYS.elevenlabs }, { provider: 'elevenlabs', apiKey: KEYS.elevenlabs }],
    ['stability_ai', {}, { api_key: KEYS.stability_ai }, { provider: 'stability', apiKey: KEYS.stability_ai }],
    ['azure_ai_vision', { endpoint: 'https://acme.cognitiveservices.azure.com' }, { api_key: KEYS.azure_ai_vision }, { provider: 'azure_vision', apiKey: KEYS.azure_ai_vision, endpoint: 'https://acme.cognitiveservices.azure.com' }],
    ['azure_speech', { region: 'westeurope' }, { api_key: 'az-speech-fake' }, { provider: 'azure_speech', apiKey: 'az-speech-fake', region: 'westeurope' }],
    ['aws_media', { region: 'eu-west-1', bucket: 'media-staging' }, { access_key_id: 'AKIAFAKE00000000', secret_access_key: 'fake-secret' }, { provider: 'aws', region: 'eu-west-1', bucket: 'media-staging', accessKeyId: 'AKIAFAKE00000000', secretAccessKey: 'fake-secret' }],
  ]
  it.each(cases)('%s', (key, config, credentials, expected) => {
    const def = getConnectorDefinition(key)!
    expect(def.category).toBe('ai')
    const built = def.buildIntegrationConfig(config, credentials)
    expect(credentialsFromIntegration({ id: 'int-1', type: key, config: built })).toMatchObject(expected)
  })
})
