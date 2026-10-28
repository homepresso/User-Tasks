import {
  DirectoryApiError,
  looksLikeEmail,
  type DirectoryClient,
  type DirectoryGroup,
  type DirectoryUser,
} from '@/lib/directory-sync/types'

/**
 * Minimal Microsoft Graph client for directory sync — plain fetch with a
 * client-credentials token (no SDK, mirroring lib/github-sync/client.ts).
 * Requires an app registration with admin-consented APPLICATION permissions
 * User.Read.All + GroupMember.Read.All.
 */

const GRAPH = 'https://graph.microsoft.com'
const LOGIN = 'https://login.microsoftonline.com'

export interface EntraCredentials {
  tenantId: string
  clientId: string
  clientSecret: string
}

export function createEntraClient(credentials: EntraCredentials): DirectoryClient {
  // Token cached in-closure until 60s before expiry.
  let cached: { token: string; expiresAt: number } | null = null

  async function getToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt) return cached.token
    const res = await fetch(`${LOGIN}/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
    })
    if (!res.ok) {
      let message = `Entra token request failed (${res.status})`
      try {
        const payload = await res.json()
        if (payload?.error_description) message = `${message}: ${payload.error_description}`
        else if (payload?.error) message = `${message}: ${payload.error}`
      } catch { /* keep default */ }
      throw new DirectoryApiError(res.status, message)
    }
    const payload = await res.json()
    const expiresIn = Number(payload?.expires_in ?? 3600)
    cached = {
      token: String(payload?.access_token ?? ''),
      expiresAt: Date.now() + Math.max(expiresIn - 60, 0) * 1000,
    }
    return cached.token
  }

  const MAX_RETRIES = 3
  const MAX_RETRY_WAIT_MS = 45_000

  async function request<T>(url: string): Promise<T> {
    const token = await getToken()
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (res.ok) return (await res.json()) as T

      // Throttled/transient — honor Retry-After (seconds), capped at 45s,
      // up to 3 retries before surfacing the error.
      if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers?.get?.('retry-after'))
        const waitMs = Number.isFinite(retryAfter)
          ? Math.min(Math.max(retryAfter, 0) * 1000, MAX_RETRY_WAIT_MS)
          : Math.min(1000 * (attempt + 1), MAX_RETRY_WAIT_MS)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }

      let message = `Microsoft Graph ${res.status}`
      try {
        const payload = await res.json()
        if (payload?.error?.message) message = `${message}: ${payload.error.message}`
      } catch { /* keep default */ }
      throw new DirectoryApiError(res.status, message)
    }
  }

  /** Follow @odata.nextLink until the collection is exhausted. */
  async function listAll(firstUrl: string): Promise<any[]> {
    const items: any[] = []
    let url: string | null = firstUrl
    while (url) {
      const page: any = await request<any>(url)
      items.push(...((page?.value ?? []) as any[]))
      url = typeof page?.['@odata.nextLink'] === 'string' ? page['@odata.nextLink'] : null
    }
    return items
  }

  return {
    async verify(): Promise<{ orgName: string | null }> {
      // Validate credentials + permissions against an endpoint User.Read.All
      // actually covers. (/v1.0/organization needs Organization.Read.All,
      // which we deliberately do NOT require.)
      await request<any>(`${GRAPH}/v1.0/users?$top=1&$select=id`)
      // Org display name is nice-to-have — tolerate a 403 when the app lacks
      // Organization.Read.All and fall back to null.
      try {
        const page = await request<any>(`${GRAPH}/v1.0/organization`)
        const org = (page?.value ?? [])[0]
        return { orgName: org?.displayName ?? null }
      } catch (error) {
        if (error instanceof DirectoryApiError && error.status === 403) return { orgName: null }
        throw error
      }
    },

    async listUsers(): Promise<DirectoryUser[]> {
      const rows = await listAll(
        `${GRAPH}/v1.0/users?$select=id,displayName,mail,userPrincipalName,accountEnabled&$expand=manager($select=id,mail,userPrincipalName)&$top=999`,
      )
      return rows
        .filter((u) => u?.id)
        .map((u) => {
          // Guest UPNs (jane_gmail.com#EXT#@org.onmicrosoft.com) can pass an
          // email-shape check but are unroutable — never fall back to them.
          const upn = u.userPrincipalName
          const upnUsable = looksLikeEmail(upn) && !String(upn).includes('#EXT#')
          const email = looksLikeEmail(u.mail) ? u.mail : upnUsable ? upn : null
          return {
            externalId: String(u.id),
            displayName: String(u.displayName ?? email ?? u.userPrincipalName ?? ''),
            email: email ? String(email).toLowerCase() : null,
            active: u.accountEnabled !== false,
            // $expand=manager: present when the user has one (absent otherwise).
            ...(u.manager && u.manager.id
              ? { manager: { externalId: String(u.manager.id), email: looksLikeEmail(u.manager.mail) ? String(u.manager.mail).toLowerCase() : looksLikeEmail(u.manager.userPrincipalName) ? String(u.manager.userPrincipalName).toLowerCase() : null } }
              : {}),
          }
        })
    },

    async listGroups(): Promise<DirectoryGroup[]> {
      const rows = await listAll(`${GRAPH}/v1.0/groups?$select=id,displayName,description&$top=999`)
      return rows
        .filter((g) => g?.id)
        .map((g) => ({
          externalId: String(g.id),
          displayName: String(g.displayName ?? 'Unnamed group'),
          description: g.description ?? null,
        }))
    },

    async listGroupMemberIds(groupId: string): Promise<string[]> {
      const rows = await listAll(
        `${GRAPH}/v1.0/groups/${encodeURIComponent(groupId)}/members?$select=id&$top=999`,
      )
      // Members can be users, devices, service principals, nested groups —
      // keep only users (or untyped entries with an id, for lenient mocks).
      return rows
        .filter((m) => {
          if (!m?.id) return false
          const type = m['@odata.type']
          return type === undefined || type === '#microsoft.graph.user'
        })
        .map((m) => String(m.id))
    },
  }
}

export type EntraClient = ReturnType<typeof createEntraClient>
