import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGitHubClient, GitHubApiError } from '@/lib/github-sync/client'
import { assetFilePath, assetSlug, buildAssetEnvelope, manifestPath, stringifyForRepo } from '@/lib/github-sync/layout'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }
}

describe('layout', () => {
  it('slugs names and derives stable short ids', () => {
    expect(assetSlug('Invoice Approval! (v2)')).toBe('invoice-approval-v2')
    expect(assetSlug('')).toBe('untitled')
    expect(assetFilePath('usertasks', 'workflows', 'Invoice Approval', '3fa8c21b-1234-5678-9abc-def012345678'))
      .toBe('usertasks/workflows/invoice-approval-3fa8c21b.json')
    expect(manifestPath('usertasks/')).toBe('usertasks/manifest.json')
  })

  it('envelopes assets with the format version', () => {
    const envelope = buildAssetEnvelope('workflows', 'id-1', { nodes: [] })
    expect(envelope.format_version).toBe(3)
    expect(envelope.asset_type).toBe('workflows')
    expect(stringifyForRepo({ a: 1 }).endsWith('\n')).toBe(true)
  })
})

describe('createGitHubClient.commitFiles', () => {
  it('builds ref → tree → commit → patch sequence with deletions', async () => {
    const calls: Array<{ method: string; url: string; body?: any }> = []
    fetchMock.mockImplementation(async (url: string, init: any) => {
      calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined })
      if (url.includes('/git/ref/')) return jsonResponse({ object: { sha: 'ref-sha' } })
      if (url.includes('/git/commits/ref-sha')) return jsonResponse({ sha: 'ref-sha', tree: { sha: 'base-tree' } })
      if (url.endsWith('/git/trees')) return jsonResponse({ sha: 'new-tree' })
      if (url.endsWith('/git/commits')) return jsonResponse({ sha: 'new-commit' })
      if (url.includes('/git/refs/')) return jsonResponse({})
      throw new Error(`unexpected ${url}`)
    })

    const client = createGitHubClient('tok')
    const result = await client.commitFiles({
      owner: 'acme', repo: 'config', branch: 'main', message: 'sync',
      files: [
        { path: 'usertasks/workflows/a-11111111.json', content: '{}\n' },
        { path: 'usertasks/workflows/old-22222222.json', content: null },
      ],
    })

    expect(result.commitSha).toBe('new-commit')
    const treeCall = calls.find((c) => c.url.endsWith('/git/trees'))
    expect(treeCall?.body.base_tree).toBe('base-tree')
    expect(treeCall?.body.tree).toEqual([
      { path: 'usertasks/workflows/a-11111111.json', mode: '100644', type: 'blob', content: '{}\n' },
      { path: 'usertasks/workflows/old-22222222.json', mode: '100644', type: 'blob', sha: null },
    ])
    const patchCall = calls.find((c) => c.method === 'PATCH')
    expect(patchCall?.body.sha).toBe('new-commit')
  })

  it('retries once on a 422 non-fast-forward race', async () => {
    let refCalls = 0
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (url.includes('/git/ref/')) { refCalls++; return jsonResponse({ object: { sha: `ref-${refCalls}` } }) }
      if (url.includes('/git/commits/ref-')) return jsonResponse({ sha: 'x', tree: { sha: 't' } })
      if (url.endsWith('/git/trees')) return jsonResponse({ sha: 'tree' })
      if (url.endsWith('/git/commits')) return jsonResponse({ sha: 'commit' })
      if (url.includes('/git/refs/') && init.method === 'PATCH') {
        if (refCalls === 1) return jsonResponse({ message: 'Update is not a fast forward' }, 422)
        return jsonResponse({})
      }
      throw new Error(`unexpected ${url}`)
    })

    const client = createGitHubClient('tok')
    const result = await client.commitFiles({ owner: 'a', repo: 'r', branch: 'main', message: 'm', files: [{ path: 'f.json', content: '{}' }] })
    expect(result.commitSha).toBe('commit')
    expect(refCalls).toBe(2)
  })

  it('surfaces auth failures as GitHubApiError with status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, 401))
    const client = createGitHubClient('bad')
    await expect(client.verifyToken()).rejects.toMatchObject({ status: 401 })
    await expect(client.verifyToken()).rejects.toBeInstanceOf(GitHubApiError)
  })
})
