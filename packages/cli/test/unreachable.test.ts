import { describe, expect, it } from 'vitest'
import { UsertasksNetworkError } from '@user-tasks/sdk'
import { unreachableServer } from '../src/main'
import { harness } from './helpers'

describe('unreachable server', () => {
  it('names the server when the connection was refused', () => {
    const refused = new UsertasksNetworkError('GET http://localhost:3000/.well-known/oauth-authorization-server failed: fetch failed', { cause: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) })
    expect(unreachableServer(refused)).toBe('http://localhost:3000')
  })

  it('leaves other network errors alone', () => {
    expect(unreachableServer(new UsertasksNetworkError('Upload of a.pdf failed: storage answered 500'))).toBeNull()
  })

  it('prints a friendly message and exits as unavailable', async () => {
    const h = harness({ responder: () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) } })
    const code = await h.run('login', '--api-key', 'ut_x')
    expect(code).not.toBe(0)
    expect(h.stderr()).toContain("can't reach UserTasks at http://localhost:3000. Is it running?")
    expect(h.stderr()).toContain('--url <server>')
  })
})
