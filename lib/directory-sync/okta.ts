import {
  DirectoryApiError,
  looksLikeEmail,
  type DirectoryClient,
  type DirectoryGroup,
  type DirectoryUser,
} from '@/lib/directory-sync/types'

/**
 * Minimal Okta management-API client for directory sync — plain fetch with an
 * SSWS API token (no SDK, mirroring lib/github-sync/client.ts). Paging uses
 * the standard Okta `Link: <...>; rel="next"` response header.
 */

export interface OktaCredentials {
  /** e.g. https://acme.okta.com (no trailing slash) */
  orgUrl: string
  apiToken: string
}

/** Extract the rel="next" URL from an Okta Link header, if any. */
export function parseNextLink(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/<([^>]+)>\s*;\s*rel="next"/)
  return match ? match[1] : null
}

export function createOktaClient(credentials: OktaCredentials): DirectoryClient {
  const base = String(credentials.orgUrl ?? '').replace(/\/+$/, '')

  const MAX_RETRIES = 3
  const MAX_RETRY_WAIT_MS = 45_000

  async function request<T>(url: string): Promise<{ data: T; next: string | null }> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        headers: {
          Authorization: `SSWS ${credentials.apiToken}`,
          Accept: 'application/json',
        },
      })
      if (res.ok) {
        const next = parseNextLink(res.headers?.get?.('link') ?? null)
        return { data: (await res.json()) as T, next }
      }

      // Throttled/transient — wait until X-Rate-Limit-Reset (epoch seconds),
      // capped at 45s, up to 3 retries before surfacing the error.
      if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        const resetEpoch = Number(res.headers?.get?.('x-rate-limit-reset'))
        const waitMs = Number.isFinite(resetEpoch)
          ? Math.min(Math.max(resetEpoch * 1000 - Date.now(), 0), MAX_RETRY_WAIT_MS)
          : Math.min(1000 * (attempt + 1), MAX_RETRY_WAIT_MS)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }

      let message = `Okta API ${res.status}`
      try {
        const payload = await res.json()
        if (payload?.errorSummary) message = `${message}: ${payload.errorSummary}`
      } catch { /* keep default */ }
      throw new DirectoryApiError(res.status, message)
    }
  }

  /** Follow rel="next" Link headers until the collection is exhausted. */
  async function listAll(firstUrl: string): Promise<any[]> {
    const items: any[] = []
    let url: string | null = firstUrl
    while (url) {
      const page: { data: any; next: string | null } = await request<any[]>(url)
      if (Array.isArray(page.data)) items.push(...page.data)
      url = page.next
    }
    return items
  }

  return {
    async verify(): Promise<{ orgName: string | null }> {
      const { data } = await request<any>(`${base}/api/v1/org`)
      return { orgName: data?.companyName ?? null }
    },

    async listUsers(): Promise<DirectoryUser[]> {
      const rows = await listAll(`${base}/api/v1/users?limit=200`)
      return rows
        .filter((u) => u?.id)
        .map((u) => {
          const profile = u.profile ?? {}
          const displayName = profile.displayName
            ?? [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim()
          const email = looksLikeEmail(profile.email) ? String(profile.email).toLowerCase() : null
          return {
            externalId: String(u.id),
            displayName: String(displayName || email || u.id),
            email,
            // LOCKED_OUT / RECOVERY / PASSWORD_EXPIRED are current employees
            // in a temporary credential state — only truly departed statuses
            // (SUSPENDED, DEPROVISIONED, STAGED, …) count as inactive.
            active: ['ACTIVE', 'RECOVERY', 'LOCKED_OUT', 'PASSWORD_EXPIRED'].includes(String(u.status)),
            // profile.managerId: the manager's Okta id, login or email
            // (free-form in Okta); empty string means none.
            ...(typeof profile.managerId === 'string'
              ? { manager: profile.managerId.trim() ? { externalId: profile.managerId.trim(), email: looksLikeEmail(profile.managerId) ? profile.managerId.trim().toLowerCase() : null } : null }
              : {}),
          }
        })
    },

    async listGroups(): Promise<DirectoryGroup[]> {
      const rows = await listAll(`${base}/api/v1/groups?limit=200`)
      return rows
        .filter((g) => g?.id && g.type !== 'BUILT_IN')
        .map((g) => ({
          externalId: String(g.id),
          displayName: String(g.profile?.name ?? 'Unnamed group'),
          description: g.profile?.description ?? null,
        }))
    },

    async listGroupMemberIds(groupId: string): Promise<string[]> {
      const rows = await listAll(`${base}/api/v1/groups/${encodeURIComponent(groupId)}/users?limit=200`)
      return rows.filter((u) => u?.id).map((u) => String(u.id))
    },
  }
}

export type OktaClient = ReturnType<typeof createOktaClient>
