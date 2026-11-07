/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { awsProvider, signS3, startTranscriptionPayload, transcribeMediaFormat } from '@/lib/media/providers/aws'
import { retryTiming } from '@/lib/media/providers/shared'
import { signRequest } from '@/lib/aws/sigv4'
import type { MediaAsyncJob, TranscriptResult } from '@/lib/media/types'
import { AUDIO, PNG_1PX, ctxFor, expectCatalogCapabilities, expectSafeError, fakeFetch, json } from './helpers/media-fetch'

const AKID = 'AKIDEXAMPLETEST01'
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
const ctx = (fetch: any) => ctxFor('aws', fetch, { baseUrl: 'https://transcribe.us-east-1.amazonaws.com', apiKey: undefined, region: 'us-east-1', accessKeyId: AKID, secretAccessKey: SECRET, bucket: 'media-staging' })
const AUTH_RE = new RegExp(`^AWS4-HMAC-SHA256 Credential=${AKID}/20261030/us-east-1/(rekognition|transcribe|s3)/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$`)

beforeEach(() => { vi.spyOn(retryTiming, 'sleep').mockResolvedValue(undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('aws signing', () => {
  it('signS3 matches lib/aws/sigv4 signRequest for a text payload', () => {
    const body = '{"a":1}'
    const hash = createHash('sha256').update(body).digest('hex')
    const now = Date.UTC(2026, 9, 30, 12)
    const credentials = { accessKeyId: AKID, secretAccessKey: SECRET }
    const ours = signS3({ method: 'PUT', url: 'https://b.s3.us-east-1.amazonaws.com/k/a b.txt', payloadHash: hash, region: 'us-east-1', credentials, now, headers: { 'content-type': 'text/plain' } })
    const ref = signRequest({ method: 'PUT', url: 'https://b.s3.us-east-1.amazonaws.com/k/a b.txt', body, region: 'us-east-1', service: 's3', credentials, now, headers: { 'content-type': 'text/plain', 'x-amz-content-sha256': hash } })
    expect(ours.authorization).toBe(ref.authorization)
  })
})

describe('aws rekognition', () => {
  it('implements the catalog capabilities', () => expectCatalogCapabilities(awsProvider))

  it('signed JSON 1.1 calls per feature, boxes already normalised', async () => {
    const replies: Record<string, unknown> = {
      'RekognitionService.DetectFaces': { FaceDetails: [{ BoundingBox: { Left: 0.06, Top: 0.2, Width: 0.25, Height: 0.55 }, Confidence: 99.5 }] },
      'RekognitionService.DetectLabels': { Labels: [{ Name: 'License Plate', Confidence: 91, Instances: [{ BoundingBox: { Left: 0.4, Top: 0.5, Width: 0.2, Height: 0.1 }, Confidence: 90 }] }, { Name: 'Car', Confidence: 98, Instances: [] }] },
      'RekognitionService.DetectText': { TextDetections: [
        { DetectedText: 'ID 078-05-1120', Type: 'LINE', Id: 0, Confidence: 98, Geometry: { BoundingBox: { Left: 0.4, Top: 0.55, Width: 0.5, Height: 0.08 } } },
        { DetectedText: 'ID', Type: 'WORD', Id: 1, ParentId: 0, Confidence: 99, Geometry: { BoundingBox: { Left: 0.4, Top: 0.55, Width: 0.05, Height: 0.08 } } },
        { DetectedText: '078-05-1120', Type: 'WORD', Id: 2, ParentId: 0, Confidence: 97, Geometry: { BoundingBox: { Left: 0.47, Top: 0.55, Width: 0.43, Height: 0.08 } } },
      ] },
      'RekognitionService.DetectModerationLabels': { ModerationLabels: [{ Name: 'Graphic Violence', ParentName: 'Violence', Confidence: 80 }] },
    }
    const fx = fakeFetch(Array.from({ length: 4 }, () => (call: any) => json(replies[call.headers['x-amz-target']])))
    const res = await awsProvider.analyzeImage!({ name: 'a.png', mime_type: 'image/png', bytes: PNG_1PX }, { features: ['faces', 'labels', 'objects', 'text', 'safety'] }, ctx(fx.fetch))
    expect(fx.calls.map((c) => c.headers['x-amz-target'])).toEqual(['RekognitionService.DetectFaces', 'RekognitionService.DetectLabels', 'RekognitionService.DetectText', 'RekognitionService.DetectModerationLabels'])
    for (const call of fx.calls) {
      expect(call.url).toBe('https://rekognition.us-east-1.amazonaws.com/')
      expect(call.headers['content-type']).toBe('application/x-amz-json-1.1')
      expect(call.headers.authorization).toMatch(AUTH_RE)
      expect(call.headers['x-amz-date']).toBe('20261030T120000Z')
      expect(call.headers.host).toBeUndefined()
      expect(JSON.parse(String(call.body)).Image.Bytes).toBe(Buffer.from(PNG_1PX).toString('base64'))
    }
    expect(res.faces).toEqual([{ box: { x: 0.06, y: 0.2, width: 0.25, height: 0.55 }, confidence: 0.995 }])
    expect(res.objects).toEqual([{ name: 'License Plate', box: { x: 0.4, y: 0.5, width: 0.2, height: 0.1 }, confidence: 0.9 }])
    expect(res.labels.map((l) => l.name)).toEqual(['License Plate', 'Car'])
    expect(res.ocr).toHaveLength(1)
    expect(res.ocr[0].words?.map((w) => w.text)).toEqual(['ID', '078-05-1120'])
    expect(res.safety).toEqual([{ category: 'Violence / Graphic Violence', flagged: true, score: 0.8 }])
    expect(res.usage?.model).toBe('DetectFaces+DetectLabels+DetectText+DetectModerationLabels')
  })

  it('refuses images over 5 MB and keeps AWS errors safe', async () => {
    await expectSafeError(awsProvider.analyzeImage!({ name: 'a.png', mime_type: 'image/png', bytes: new Uint8Array(5 * 1024 * 1024 + 1) }, { features: ['faces'] }, ctx(fakeFetch([]).fetch)), [SECRET], /5 MB/)
    const fx = fakeFetch([json({ __type: 'com.amazonaws.rekognition#AccessDeniedException', message: `User ${AKID} is not authorized` }, 400)])
    await expectSafeError(awsProvider.analyzeImage!({ name: 'a.png', mime_type: 'image/png', bytes: PNG_1PX }, { features: ['faces'] }, ctx(fx.fetch)), [SECRET, AKID], /AccessDeniedException/)
  })
})

describe('aws transcribe', () => {
  it('maps formats and languages', () => {
    expect(transcribeMediaFormat(AUDIO)).toBe('mp3')
    expect(transcribeMediaFormat({ name: 'x', mime_type: 'video/quicktime', bytes: new Uint8Array() })).toBe('mp4')
    expect(() => transcribeMediaFormat({ name: 'x.aiff', mime_type: 'audio/aiff', bytes: new Uint8Array() })).toThrow(/convert/)
    expect(startTranscriptionPayload('j', 'b', 'k', 'mp3', { language: 'en-US', diarize: true, maxSpeakers: 3 })).toEqual({
      TranscriptionJobName: 'j', Media: { MediaFileUri: 's3://b/k' }, MediaFormat: 'mp3', LanguageCode: 'en-US', Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 3 },
    })
    expect(startTranscriptionPayload('j', 'b', 'k', 'mp3', { language: 'en' }).IdentifyLanguage).toBe(true)
  })

  it('stages in S3, starts a job, polls, parses the transcript and cleans up', async () => {
    const fx = fakeFetch([new Response('', { status: 200 }), json({ TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' } })])
    const job = await awsProvider.transcribe!(AUDIO, { diarize: true, wordTimestamps: true }, ctx(fx.fetch)) as MediaAsyncJob
    const [put, start] = fx.calls
    expect(put.method).toBe('PUT')
    expect(put.url).toMatch(/^https:\/\/media-staging\.s3\.us-east-1\.amazonaws\.com\/usertasks-media\/[0-9a-f-]{36}\/call\.mp3$/)
    expect(put.headers['x-amz-content-sha256']).toBe(createHash('sha256').update(AUDIO.bytes).digest('hex'))
    expect(put.headers.authorization).toMatch(AUTH_RE)
    expect(put.headers.authorization).toContain('/s3/aws4_request')
    expect(put.headers.authorization).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date')
    expect(put.body).toBe(AUDIO.bytes)
    expect(start.headers['x-amz-target']).toBe('Transcribe.StartTranscriptionJob')
    expect(start.url).toBe('https://transcribe.us-east-1.amazonaws.com/')
    const startBody = JSON.parse(String(start.body))
    expect(startBody.Media.MediaFileUri).toBe(`s3://media-staging/${job.job.key}`)
    expect(startBody.Settings).toEqual({ ShowSpeakerLabels: true, MaxSpeakerLabels: 10 })
    expect(job).toMatchObject({ async: true, provider: 'aws', operation: 'transcribe', job: { bucket: 'media-staging', diarize: true } })
    expect(JSON.stringify(job)).not.toContain(SECRET)

    const pending = fakeFetch([json({ TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' } })])
    expect(await awsProvider.poll!(job, ctx(pending.fetch))).toEqual({ done: false, pollAfterMs: 5000 })
    expect(JSON.parse(String(pending.calls[0].body))).toEqual({ TranscriptionJobName: job.job.job_name })

    const transcriptUrl = 'https://s3.us-east-1.amazonaws.com/aws-transcribe-us-east-1-prod/x.json?X-Amz-Signature=abc'
    const done = fakeFetch([
      json({ TranscriptionJob: { TranscriptionJobStatus: 'COMPLETED', LanguageCode: 'en-US', Transcript: { TranscriptFileUri: transcriptUrl } } }),
      json({ results: {
        transcripts: [{ transcript: 'Hello. My card is 4111.' }],
        items: [
          { id: 0, type: 'pronunciation', start_time: '0.0', end_time: '0.5', speaker_label: 'spk_0', alternatives: [{ content: 'Hello', confidence: '0.99' }] },
          { id: 1, type: 'punctuation', speaker_label: 'spk_0', alternatives: [{ content: '.' }] },
          { id: 2, type: 'pronunciation', start_time: '1.0', end_time: '1.2', speaker_label: 'spk_1', alternatives: [{ content: 'My', confidence: '0.98' }] },
          { id: 3, type: 'pronunciation', start_time: '1.2', end_time: '1.5', speaker_label: 'spk_1', alternatives: [{ content: 'card', confidence: '0.98' }] },
        ],
        audio_segments: [
          { id: 0, transcript: 'Hello.', start_time: '0.0', end_time: '0.5', speaker_label: 'spk_0', items: [0, 1] },
          { id: 1, transcript: 'My card is 4111.', start_time: '1.0', end_time: '3.0', speaker_label: 'spk_1', items: [2, 3] },
        ],
      } }),
    ])
    const result = await awsProvider.poll!(job, ctx(done.fetch))
    expect(done.calls[1].url).toBe(transcriptUrl)
    expect(done.calls[1].headers.authorization).toBeUndefined()
    expect(result.done).toBe(true)
    const t = (result as { done: true; result: TranscriptResult }).result
    expect(t.text).toBe('Hello. My card is 4111.')
    expect(t.language).toBe('en-US')
    expect(t.speakers).toEqual(['spk_0', 'spk_1'])
    expect(t.segments[1]).toMatchObject({ start: 1, end: 3, speaker: 'spk_1', text: 'My card is 4111.' })
    expect(t.segments[0].words?.[0]).toEqual({ text: 'Hello.', start: 0, end: 0.5, confidence: 0.99, speaker: 'spk_0' })
    expect(t.usage).toEqual({ unit: 'minute', quantity: 1.5, model: 'transcribe', operation: 'transcribe' })

    const clean = fakeFetch([new Response(null, { status: 204 }), json({})])
    await awsProvider.cleanup!(job, ctx(clean.fetch))
    expect(clean.calls[0].method).toBe('DELETE')
    expect(clean.calls[0].url).toBe(put.url)
    expect(clean.calls[0].headers.authorization).toMatch(AUTH_RE)
    expect(clean.calls[1].headers['x-amz-target']).toBe('Transcribe.DeleteTranscriptionJob')
  })

  it('a failed job surfaces the reason; a failed start deletes the staged object', async () => {
    const job: MediaAsyncJob = { async: true, provider: 'aws', operation: 'transcribe', pollAfterMs: 1, job: { job_name: 'j1', bucket: 'b', key: 'k' } }
    await expectSafeError(awsProvider.poll!(job, ctx(fakeFetch([json({ TranscriptionJob: { TranscriptionJobStatus: 'FAILED', FailureReason: 'Unsupported media format' } })]).fetch)), [SECRET], /Unsupported media format/)
    const fx = fakeFetch([new Response('', { status: 200 }), json({ __type: 'BadRequestException', message: 'bad' }, 400), new Response(null, { status: 204 })])
    await expectSafeError(awsProvider.transcribe!(AUDIO, {}, ctx(fx.fetch)), [SECRET], /BadRequestException: bad/)
    expect(fx.calls[2].method).toBe('DELETE')
  })

  it('a credentials endpoint override routes everything to a local mock (path-style S3)', async () => {
    const fx = fakeFetch([new Response('', { status: 200 }), json({})])
    await awsProvider.transcribe!(AUDIO, {}, { ...ctx(fx.fetch), credentials: { ...ctx(fx.fetch).credentials, endpoint: 'http://127.0.0.1:4790/aws' } })
    expect(fx.calls[0].url).toMatch(/^http:\/\/127\.0\.0\.1:4790\/aws\/media-staging\/usertasks-media\//)
    expect(fx.calls[1].url).toBe('http://127.0.0.1:4790/aws/')
  })
})
