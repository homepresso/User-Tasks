/**
 * Minimal GitHub REST client for tenant configuration sync — plain fetch
 * against api.github.com with a personal access token (classic `repo` scope
 * or fine-grained `contents: read/write`). No SDK dependency.
 */

const API = 'https://api.github.com'

/** Commit author email for sync commits; override with GITHUB_SYNC_AUTHOR_EMAIL. */
function syncAuthorEmail(): string {
  return process.env.GITHUB_SYNC_AUTHOR_EMAIL?.trim() || 'usertasks-sync@users.noreply.github.com'
}

export class GitHubApiError extends Error {
  status: number
  rateLimitRemaining: number | null
  rateLimitReset: Date | null

  constructor(status: number, message: string, headers?: Headers) {
    super(message)
    this.status = status
    this.rateLimitRemaining = headers ? Number(headers.get('x-ratelimit-remaining') ?? '') || null : null
    const reset = headers?.get('x-ratelimit-reset')
    this.rateLimitReset = reset ? new Date(Number(reset) * 1000) : null
  }
}

export interface GitHubCommitFile {
  path: string
  /** JSON/text content, or null to delete the path. */
  content: string | null
}

export function createGitHubClient(token: string) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      let message = `GitHub API ${res.status}`
      try {
        const payload = await res.json()
        if (payload?.message) message = `${message}: ${payload.message}`
      } catch { /* keep default */ }
      throw new GitHubApiError(res.status, message, res.headers)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  return {
    /** Validates the token; returns the authenticated login. */
    async verifyToken(): Promise<{ login: string }> {
      const user = await request<{ login: string }>('GET', '/user')
      return { login: user.login }
    },

    async listRepos(): Promise<Array<{ full_name: string; default_branch: string; private: boolean }>> {
      const repos: Array<{ full_name: string; default_branch: string; private: boolean }> = []
      for (let page = 1; page <= 5; page++) {
        const batch = await request<any[]>('GET', `/user/repos?per_page=100&page=${page}&sort=updated`)
        repos.push(...batch.map((r) => ({ full_name: r.full_name, default_branch: r.default_branch, private: r.private })))
        if (batch.length < 100) break
      }
      return repos
    },

    /** Repo metadata incl. the token's effective permissions on it. */
    async getRepo(owner: string, repo: string): Promise<{ default_branch: string; permissions: { push: boolean; pull: boolean } }> {
      const data = await request<any>('GET', `/repos/${owner}/${repo}`)
      return {
        default_branch: data.default_branch,
        permissions: { push: Boolean(data.permissions?.push), pull: Boolean(data.permissions?.pull) },
      }
    },

    /** Recent commits on a branch — message, author, timestamp, web URL. */
    async listCommits(owner: string, repo: string, branch: string, perPage = 15): Promise<Array<{
      sha: string
      message: string
      author: string | null
      date: string | null
      html_url: string
    }>> {
      const commits = await request<any[]>(
        'GET',
        `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`,
      )
      return commits.map((c) => ({
        sha: c.sha,
        message: String(c.commit?.message ?? ''),
        author: c.commit?.author?.name ?? c.author?.login ?? null,
        date: c.commit?.author?.date ?? null,
        html_url: String(c.html_url ?? ''),
      }))
    },

    async listBranches(owner: string, repo: string): Promise<string[]> {
      const branches = await request<any[]>('GET', `/repos/${owner}/${repo}/branches?per_page=100`)
      return branches.map((b) => b.name)
    },

    async getRef(owner: string, repo: string, branch: string): Promise<{ sha: string }> {
      const ref = await request<any>('GET', `/repos/${owner}/${repo}/git/ref/${encodeURIComponent(`heads/${branch}`)}`)
      return { sha: ref.object.sha }
    },

    async getCommit(owner: string, repo: string, sha: string): Promise<{ sha: string; treeSha: string }> {
      const commit = await request<any>('GET', `/repos/${owner}/${repo}/git/commits/${sha}`)
      return { sha: commit.sha, treeSha: commit.tree.sha }
    },

    async getTree(owner: string, repo: string, sha: string): Promise<Array<{ path: string; type: string; sha: string }>> {
      const tree = await request<any>('GET', `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`)
      return (tree.tree ?? []).map((entry: any) => ({ path: entry.path, type: entry.type, sha: entry.sha }))
    },

    async getBlobText(owner: string, repo: string, sha: string): Promise<string> {
      const blob = await request<any>('GET', `/repos/${owner}/${repo}/git/blobs/${sha}`)
      return Buffer.from(blob.content ?? '', 'base64').toString('utf8')
    },

    /** Read a single file's text at a ref via the contents API. Returns null when missing. */
    async getFileText(owner: string, repo: string, path: string, ref: string): Promise<string | null> {
      try {
        const file = await request<any>('GET', `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`)
        if (Array.isArray(file)) return null
        return Buffer.from(file.content ?? '', 'base64').toString('utf8')
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 404) return null
        throw error
      }
    },

    /**
     * Batch commit: one atomic commit containing adds/updates (content) and
     * deletions (content: null). Retries once on a non-fast-forward race.
     */
    async commitFiles(params: {
      owner: string
      repo: string
      branch: string
      message: string
      files: GitHubCommitFile[]
      authorName?: string
    }): Promise<{ commitSha: string }> {
      const { owner, repo, branch, message, files } = params
      if (files.length === 0) throw new Error('Nothing to commit')

      const attempt = async (): Promise<{ commitSha: string }> => {
        // Completely empty repositories disable the ENTIRE Git Data API
        // (trees/commits/refs all 409) — the only way in is the Contents
        // API: PUT one file to create the initial commit + branch, after
        // which the Data API path below works normally.
        let baseSha: string | null = null
        let baseTreeSha: string | null = null
        try {
          const ref = await this.getRef(owner, repo, branch)
          baseSha = ref.sha
          baseTreeSha = (await this.getCommit(owner, repo, ref.sha)).treeSha
        } catch (error) {
          if (!(error instanceof GitHubApiError && (error.status === 409 || error.status === 404))) throw error
        }

        if (baseSha === null) {
          const seed = files.find((f) => f.content !== null)
          if (!seed) throw new Error('Nothing to commit')
          await request('PUT', `/repos/${owner}/${repo}/contents/${seed.path.split('/').map(encodeURIComponent).join('/')}`, {
            message: `${message} (initialize repository)`,
            content: Buffer.from(seed.content as string, 'utf8').toString('base64'),
            branch,
          })
          const ref = await this.getRef(owner, repo, branch)
          baseSha = ref.sha
          baseTreeSha = (await this.getCommit(owner, repo, ref.sha)).treeSha
        }

        // Deletions on a just-initialized repo would 422 (paths don't exist);
        // they're only meaningful against an existing tree.
        const treeEntries = files
          .filter((file) => file.content !== null || baseTreeSha !== null)
          .map((file) =>
            file.content === null
              ? { path: file.path, mode: '100644', type: 'blob', sha: null }
              : { path: file.path, mode: '100644', type: 'blob', content: file.content },
          )
        if (treeEntries.length === 0) throw new Error('Nothing to commit')

        const tree = await request<any>('POST', `/repos/${owner}/${repo}/git/trees`, {
          ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
          tree: treeEntries,
        })

        const commit = await request<any>('POST', `/repos/${owner}/${repo}/git/commits`, {
          message,
          tree: tree.sha,
          parents: [baseSha],
          ...(params.authorName ? { author: { name: params.authorName, email: syncAuthorEmail(), date: new Date().toISOString() } } : {}),
        })

        await request('PATCH', `/repos/${owner}/${repo}/git/refs/${encodeURIComponent(`heads/${branch}`)}`, {
          sha: commit.sha,
          force: false,
        })
        return { commitSha: commit.sha }
      }

      try {
        return await attempt()
      } catch (error) {
        // Concurrent push updated the ref between read and write — retry once.
        if (error instanceof GitHubApiError && error.status === 422) {
          return await attempt()
        }
        throw error
      }
    },
  }
}

export type GitHubClient = ReturnType<typeof createGitHubClient>
