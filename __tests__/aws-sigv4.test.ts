import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hash } from '@smithy/hash-node'
import { HttpRequest } from '@smithy/protocol-http'
import { SignatureV4 } from '@smithy/signature-v4'
import { presignUrl, rfc3986, signRequest, type AwsCredentials } from '@/lib/aws/sigv4'
import { cachedCredentials } from '@/lib/aws/credentials'

/**
 * lib/aws/sigv4 (used by the CloudWatch Logs destination and ElastiCache IAM
 * tokens) against AWS's published example and the AWS SDK's own signer.
 */

const EXAMPLE: AwsCredentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }
const NOW = Date.UTC(2015, 7, 30, 12, 36, 0)

function sdkSigner(service: string, region: string, credentials: AwsCredentials) {
  return new SignatureV4({ service, region, credentials, sha256: Hash.bind(null, 'sha256'), uriEscapePath: true, applyChecksum: false })
}

afterEach(() => vi.useRealTimers())

describe('signRequest', () => {
  it('matches the AWS documentation example (IAM ListUsers)', () => {
    const headers = signRequest({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      region: 'us-east-1',
      service: 'iam',
      credentials: EXAMPLE,
      now: NOW,
    })
    expect(headers['x-amz-date']).toBe('20150830T123600Z')
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    )
  })

  it('matches @smithy/signature-v4 for a CloudWatch Logs PutLogEvents call (with a session token)', async () => {
    const credentials = { accessKeyId: 'ASIAEXAMPLE', secretAccessKey: 'secret/key+value', sessionToken: 'session token == value' }
    const body = JSON.stringify({ logGroupName: '/usertasks/events', logStreamName: 'tenant-1', logEvents: [{ timestamp: 1, message: 'héllo' }] })
    const headers = { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'Logs_20140328.PutLogEvents' }
    const ours = signRequest({ method: 'POST', url: 'https://logs.eu-west-1.amazonaws.com/', headers, body, region: 'eu-west-1', service: 'logs', credentials, now: NOW })

    const sdk = await sdkSigner('logs', 'eu-west-1', credentials).sign(new HttpRequest({
      method: 'POST', protocol: 'https:', hostname: 'logs.eu-west-1.amazonaws.com', path: '/', headers: { ...headers, host: 'logs.eu-west-1.amazonaws.com' }, body,
    }), { signingDate: new Date(NOW) })
    const sdkHeaders = Object.fromEntries(Object.entries(sdk.headers).map(([k, v]) => [k.toLowerCase(), v]))
    expect(ours.authorization).toBe(sdkHeaders.authorization)
    expect(ours['x-amz-security-token']).toBe(credentials.sessionToken)
  })
})

describe('presignUrl', () => {
  it('matches @smithy/signature-v4 presign (ElastiCache connect token shape)', async () => {
    const credentials = { accessKeyId: 'ASIAEXAMPLE', secretAccessKey: 'secret', sessionToken: 'tok/en+=' }
    const ours = presignUrl({ method: 'GET', url: 'http://my-cache/?Action=connect&User=app-user', region: 'eu-west-1', service: 'elasticache', credentials, expiresInSeconds: 900, now: NOW })
    const sdk = await sdkSigner('elasticache', 'eu-west-1', credentials).presign(new HttpRequest({
      method: 'GET', protocol: 'http:', hostname: 'my-cache', path: '/', query: { Action: 'connect', User: 'app-user' }, headers: { host: 'my-cache' },
    }), { expiresIn: 900, signingDate: new Date(NOW) })
    const sdkSig = (sdk.query as Record<string, string>)['X-Amz-Signature']
    const url = new URL(ours)
    expect(url.searchParams.get('X-Amz-Signature')).toBe(sdkSig)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('tok/en+=')
    expect(url.searchParams.get('X-Amz-Credential')).toBe('ASIAEXAMPLE/20150830/eu-west-1/elasticache/aws4_request')
  })

  it('produces the same token as @aws-sdk/rds-signer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const { Signer } = await import('@aws-sdk/rds-signer')
    const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }
    const sdkToken = await new Signer({ hostname: 'db.abc.eu-west-1.rds.amazonaws.com', port: 5432, username: 'app', region: 'eu-west-1', credentials }).getAuthToken()
    const ours = presignUrl({ method: 'GET', url: 'https://db.abc.eu-west-1.rds.amazonaws.com:5432/?Action=connect&DBUser=app', region: 'eu-west-1', service: 'rds-db', credentials, expiresInSeconds: 900, now: NOW })
    const sig = (token: string) => new URL(token.startsWith('https://') ? token : `https://${token}`).searchParams.get('X-Amz-Signature')
    expect(sig(ours)).toBe(sig(sdkToken))
  })

  it('rfc3986 escapes the characters encodeURIComponent leaves alone', () => {
    expect(rfc3986("a!b'c(d)e*f ~")).toBe('a%21b%27c%28d%29e%2Af%20~')
  })
})

describe('cachedCredentials', () => {
  it('reuses credentials until five minutes before they expire, and permanent ones forever', async () => {
    let now = 0
    let n = 0
    const source = vi.fn(async () => ({ accessKeyId: `AK${++n}`, secretAccessKey: 's', expiration: new Date(now + 60 * 60_000) }))
    const get = cachedCredentials(source, () => now)
    expect((await Promise.all([get(), get()])).map((c) => c.accessKeyId)).toEqual(['AK1', 'AK1'])
    now += 54 * 60_000
    expect((await get()).accessKeyId).toBe('AK1')
    now += 2 * 60_000
    expect((await get()).accessKeyId).toBe('AK2')

    const fixed = vi.fn(async () => ({ accessKeyId: 'AKFIXED', secretAccessKey: 's' }))
    const getFixed = cachedCredentials(fixed, () => now)
    await getFixed(); now += 10 * 24 * 3_600_000; await getFixed()
    expect(fixed).toHaveBeenCalledTimes(1)
  })
})
