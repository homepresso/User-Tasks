import { describe, expect, it } from 'vitest'
import type { ConfigFile } from '../src/config'
import { CliUsageError } from '../src/exit-codes'
import { normaliseServerUrl, resolveSettings } from '../src/settings'

const config: ConfigFile = {
  version: 1,
  current_profile: 'work',
  profiles: {
    work: { url: 'https://work.test', credentials: { type: 'api_key', api_key: 'work-key' } },
    home: { url: 'https://home.test/api/v1/', credentials: { type: 'api_key', api_key: 'home-key' } },
  },
}

const resolve = (flags = {}, env = {}, stdoutIsTTY = false) => resolveSettings({ flags, env, config, stdoutIsTTY })

describe('resolveSettings precedence', () => {
  it('profile: --profile > USERTASKS_PROFILE > current_profile > default', () => {
    expect(resolve({ profile: 'home' }, { USERTASKS_PROFILE: 'work' }).profileName).toBe('home')
    expect(resolve({}, { USERTASKS_PROFILE: 'home' }).profileName).toBe('home')
    expect(resolve().profileName).toBe('work')
    expect(resolveSettings({ flags: {}, env: {}, config: { version: 1, profiles: {} }, stdoutIsTTY: false }).profileName).toBe('default')
  })

  it('url: --url > USERTASKS_URL > profile url (normalised)', () => {
    expect(resolve({ url: 'https://flag.test' }, { USERTASKS_URL: 'https://env.test' }).url).toBe('https://flag.test')
    expect(resolve({}, { USERTASKS_URL: 'https://env.test/' }).url).toBe('https://env.test')
    expect(resolve({ profile: 'home' }).url).toBe('https://home.test')
  })

  it('credential: USERTASKS_API_KEY overrides the stored key', () => {
    expect(resolve({}, { USERTASKS_API_KEY: 'env-key' })).toMatchObject({ apiKey: 'env-key', apiKeySource: 'env' })
    expect(resolve()).toMatchObject({ apiKey: 'work-key', apiKeySource: 'profile' })
  })

  it('never sends a profile key to a different server', () => {
    const other = resolve({ url: 'https://evil.test' })
    expect(other.apiKey).toBeUndefined()
    expect(resolve({ url: 'https://work.test/api/v1' }).apiKey).toBe('work-key')
    expect(resolve({ url: 'https://evil.test' }, { USERTASKS_API_KEY: 'env-key' }).apiKey).toBe('env-key')
  })

  it('output: --output > USERTASKS_OUTPUT > table on a TTY, json otherwise', () => {
    expect(resolve({ output: 'yaml' }, { USERTASKS_OUTPUT: 'json' }, true).output).toBe('yaml')
    expect(resolve({}, { USERTASKS_OUTPUT: 'YAML' }, true).output).toBe('yaml')
    expect(resolve({}, {}, true).output).toBe('table')
    expect(resolve({}, {}, false).output).toBe('json')
    expect(() => resolve({}, { USERTASKS_OUTPUT: 'xml' })).toThrow(CliUsageError)
  })
})

describe('normaliseServerUrl', () => {
  it('strips trailing slashes and /api/v1, keeps sub-paths', () => {
    expect(normaliseServerUrl('https://x.test/api/v1/')).toBe('https://x.test')
    expect(normaliseServerUrl('http://localhost:3000')).toBe('http://localhost:3000')
    expect(normaliseServerUrl('https://x.test/tasks/')).toBe('https://x.test/tasks')
  })

  it('rejects non-http URLs', () => {
    expect(() => normaliseServerUrl('ftp://x.test')).toThrow(CliUsageError)
    expect(() => normaliseServerUrl('not a url')).toThrow(CliUsageError)
  })
})
