import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConfigStore } from '../src/config'
import { EXIT } from '../src/exit-codes'
import { harness, ok, tempConfigPath, type Recorded } from './helpers'

const me = {
  tenant: { id: 't1', name: 'Acme', slug: 'acme' },
  user: { id: 'u1', email: 'ada@acme.test' },
  auth: { kind: 'api_key', key_type: 'user', oauth_scopes: null, expires_at: null },
  permissions: ['workflows.view'],
  resource_scopes: { workflow_ids: [], table_ids: [] },
}

const meResponder = (validKey = 'ut_good') => (req: Recorded) =>
  req.headers.Authorization === `Bearer ${validKey}` ? ok(me) : { status: 401, body: { success: false, error: 'Invalid API key' } }

describe('login --api-key', () => {
  it('validates the key with GET /me and stores it in the profile (0600)', async () => {
    const configPath = tempConfigPath()
    const h = harness({ configPath, responder: meResponder() })
    expect(await h.run('login', '--url', 'https://tasks.test/api/v1/', '--api-key', 'ut_good')).toBe(0)
    expect(h.requests[0].url.toString()).toBe('https://tasks.test/api/v1/me')
    expect(h.stderr()).toContain('Logged in to https://tasks.test as ada@acme.test @ Acme (profile "default")')

    const config = new ConfigStore(configPath).read()
    expect(config.current_profile).toBe('default')
    expect(config.profiles.default).toMatchObject({
      url: 'https://tasks.test',
      credentials: { type: 'api_key', api_key: 'ut_good' },
      tenant: me.tenant,
      user: me.user,
    })
    if (process.platform !== 'win32') expect(statSync(configPath).mode & 0o777).toBe(0o600)
  })

  it('reads the key from stdin with --api-key -', async () => {
    const configPath = tempConfigPath()
    const h = harness({ configPath, stdin: 'ut_good\n', responder: meResponder() })
    expect(await h.run('login', '--url', 'https://tasks.test', '--profile', 'ci', '--api-key', '-')).toBe(0)
    expect(new ConfigStore(configPath).read().profiles.ci.credentials).toEqual({ type: 'api_key', api_key: 'ut_good' })
  })

  it('rejects an invalid key with exit 3 and stores nothing', async () => {
    const configPath = tempConfigPath()
    const h = harness({ configPath, responder: meResponder() })
    expect(await h.run('login', '--url', 'https://tasks.test', '--api-key', 'ut_bad')).toBe(EXIT.unauthenticated)
    expect(h.stderr()).toContain('Invalid API key')
    expect(new ConfigStore(configPath).read().profiles).toEqual({})
  })

  it('requires a server URL and a key', async () => {
    expect(await harness().run('login', '--api-key', 'ut_good')).toBe(EXIT.usage)
    expect(await harness({ stdin: '' }).run('login', '--url', 'https://tasks.test', '--api-key', '-')).toBe(EXIT.usage)
  })
})

describe('whoami / logout / profiles', () => {
  async function loggedIn() {
    const configPath = tempConfigPath()
    await harness({ configPath, responder: meResponder() }).run('login', '--url', 'https://tasks.test', '--api-key', 'ut_good')
    return configPath
  }

  it('whoami uses the stored profile credential', async () => {
    const configPath = await loggedIn()
    const h = harness({ configPath, responder: meResponder() })
    expect(await h.run('whoami', '-o', 'json')).toBe(0)
    expect(JSON.parse(h.stdout())).toMatchObject({ profile: 'default', url: 'https://tasks.test', tenant: me.tenant })

    const table = harness({ configPath, responder: meResponder(), tty: true })
    expect(await table.run('whoami')).toBe(0)
    expect(table.stdout()).toMatch(/tenant\s+Acme \(acme\)/)
  })

  it('USERTASKS_API_KEY overrides the stored key', async () => {
    const configPath = await loggedIn()
    const h = harness({ configPath, env: { USERTASKS_API_KEY: 'ut_env' }, responder: meResponder('ut_env') })
    expect(await h.run('whoami')).toBe(0)
    expect(h.requests[0].headers.Authorization).toBe('Bearer ut_env')
  })

  it('does not send the stored key when --url points elsewhere', async () => {
    const configPath = await loggedIn()
    const h = harness({ configPath, responder: meResponder() })
    expect(await h.run('whoami', '--url', 'https://other.test')).toBe(EXIT.unauthenticated)
    expect(h.requests).toHaveLength(0)
  })

  it('logout removes the credential but keeps the profile', async () => {
    const configPath = await loggedIn()
    expect(await harness({ configPath }).run('logout')).toBe(0)
    const config = new ConfigStore(configPath).read()
    expect(config.profiles.default.url).toBe('https://tasks.test')
    expect(config.profiles.default.credentials).toBeUndefined()
    expect(readFileSync(configPath, 'utf8')).not.toContain('ut_good')
    expect(await harness({ configPath }).run('whoami')).toBe(EXIT.unauthenticated)
  })

  it('profiles list never prints secrets; use and rm update the config', async () => {
    const configPath = await loggedIn()
    await harness({ configPath, responder: meResponder() }).run('login', '--url', 'https://tasks.test', '--profile', 'second', '--api-key', 'ut_good')

    const list = harness({ configPath })
    expect(await list.run('profiles', 'list', '-o', 'json')).toBe(0)
    expect(list.stdout()).not.toContain('ut_good')
    expect(JSON.parse(list.stdout())).toEqual([
      { name: 'default', current: false, url: 'https://tasks.test', auth: 'api_key', tenant: 'Acme', user: 'ada@acme.test' },
      { name: 'second', current: true, url: 'https://tasks.test', auth: 'api_key', tenant: 'Acme', user: 'ada@acme.test' },
    ])

    expect(await harness({ configPath }).run('profiles', 'use', 'default')).toBe(0)
    expect(new ConfigStore(configPath).read().current_profile).toBe('default')
    expect(await harness({ configPath }).run('profiles', 'use', 'missing')).toBe(EXIT.usage)

    expect(await harness({ configPath }).run('profiles', 'rm', 'default')).toBe(0)
    const config = new ConfigStore(configPath).read()
    expect(Object.keys(config.profiles)).toEqual(['second'])
    expect(config.current_profile).toBeUndefined()
  })
})
