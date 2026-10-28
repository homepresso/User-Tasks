import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGitHubClient } from '@/lib/github-sync/client'

const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body }
}

describe('commitFiles against an empty repository', () => {
  it('seeds the first commit via the Contents API, then commits the batch', async () => {
    // The Git Data API is entirely disabled on empty repos — trees/commits
    // 409 as well, so bootstrap must go through PUT /contents.
    const calls: Array<{ method: string; url: string; body?: any }> = []
    let refCalls = 0
    fetchMock.mockImplementation(async (url: string, init: any) => {
      calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined })
      if (url.includes('/git/ref/')) {
        refCalls++
        if (refCalls === 1) return jsonResponse({ message: 'Git Repository is empty.' }, 409)
        return jsonResponse({ object: { sha: 'seed-commit' } })
      }
      if (init.method === 'PUT' && url.includes('/contents/')) return jsonResponse({ commit: { sha: 'seed-commit' } }, 201)
      if (url.includes('/git/commits/seed-commit')) return jsonResponse({ sha: 'seed-commit', tree: { sha: 'seed-tree' } })
      if (url.endsWith('/git/trees')) return jsonResponse({ sha: 'batch-tree' })
      if (url.endsWith('/git/commits')) return jsonResponse({ sha: 'batch-commit' })
      if (url.includes('/git/refs/') && init.method === 'PATCH') return jsonResponse({})
      throw new Error(`unexpected ${init.method} ${url}`)
    })

    const client = createGitHubClient('tok')
    const result = await client.commitFiles({
      owner: 'acme', repo: 'fresh', branch: 'main', message: 'initial sync',
      files: [
        { path: 'usertasks/manifest.json', content: '{}\n' },
        { path: 'usertasks/workflows/wf-12345678.json', content: '{"a":1}\n' },
      ],
    })

    expect(result.commitSha).toBe('batch-commit')
    const putCall = calls.find((c) => c.method === 'PUT')
    expect(putCall?.url).toContain('/contents/usertasks/manifest.json')
    expect(putCall?.body.branch).toBe('main')
    const treeCall = calls.find((c) => c.url.endsWith('/git/trees'))
    expect(treeCall?.body.base_tree).toBe('seed-tree')
    const commitCall = calls.find((c) => c.url.endsWith('/git/commits') && c.method === 'POST')
    expect(commitCall?.body.parents).toEqual(['seed-commit'])
  })
})
