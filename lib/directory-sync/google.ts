import { JWT } from 'google-auth-library'
import { z } from 'zod'
import {
  DirectoryApiError,
  looksLikeEmail,
  type DirectoryClient,
  type DirectoryGroup,
  type DirectoryUser,
} from '@/lib/directory-sync/types'

/* eslint-disable @typescript-eslint/no-explicit-any -- Admin SDK responses are free-form JSON */

/**
 * Google Workspace directory client: the Admin SDK Directory API with a
 * service account that has domain-wide delegation for the read-only
 * directory scopes, impersonating a Workspace admin (admin_email). Plain
 * fetch with a bearer token (like the Entra and Okta clients); paging follows
 * nextPageToken.
 *
 * Members are read with includeDerivedMembership=true, so members of nested
 * groups count (only USER members are kept). Suspended and archived users
 * are inactive.
 */

export const GOOGLE_DIRECTORY_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.member.readonly',
] as const

const API = 'https://admin.googleapis.com/admin/directory/v1'

export const googleSettingsSchema = z.object({
  admin_email: z.string().trim().email().max(320).describe('Workspace admin the service account impersonates (domain-wide delegation)'),
  customer: z.string().trim().max(100).regex(/^[A-Za-z0-9_-]+$/).default('my_customer').describe('Customer id (default my_customer)'),
  domain: z.string().trim().max(255).optional().describe('Only users and groups of this domain (default: every domain of the customer)'),
  user_query: z.string().trim().max(500).optional().describe('Admin SDK users.list query, e.g. orgUnitPath=/Engineering'),
  deprovision_missing: z.boolean().default(true).describe('A sync deactivates linked users no longer returned'),
})

export type GoogleSettings = z.output<typeof googleSettingsSchema>

export interface GoogleServiceAccountKey {
  client_email: string
  private_key: string
}

export function parseServiceAccountJson(json: string): GoogleServiceAccountKey {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('The service account key is not valid JSON')
  }
  if (typeof parsed?.client_email !== 'string' || typeof parsed?.private_key !== 'string') {
    throw new Error('The service account key must be a JSON key file with client_email and private_key')
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

export interface GoogleClientOptions {
  settings: unknown
  serviceAccountJson: string
  /** Tests: skip the JWT exchange. */
  getAccessToken?: () => Promise<string>
  fetchImpl?: typeof fetch
}

export function createGoogleDirectoryClient(options: GoogleClientOptions): DirectoryClient {
  const settings = googleSettingsSchema.parse(options.settings ?? {})
  const doFetch = options.fetchImpl ?? fetch
  let jwt: JWT | null = null

  async function token(): Promise<string> {
    if (options.getAccessToken) return options.getAccessToken()
    if (!jwt) {
      const key = parseServiceAccountJson(options.serviceAccountJson)
      jwt = new JWT({ email: key.client_email, key: key.private_key, scopes: [...GOOGLE_DIRECTORY_SCOPES], subject: settings.admin_email })
    }
    try {
      const { token: accessToken } = await jwt.getAccessToken()
      if (!accessToken) throw new Error('no access token')
      return accessToken
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      // unauthorized_client: the client id has no domain-wide delegation for these scopes.
      throw new DirectoryApiError(401, `Google token request failed: ${message.slice(0, 300)}`)
    }
  }

  const MAX_RETRIES = 3

  async function request<T>(url: string): Promise<T> {
    const bearer = await token()
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } })
      if (res.ok) return (await res.json()) as T
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers?.get?.('retry-after'))
        const waitMs = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 30_000) : 1000 * 2 ** attempt
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }
      let message = `Google Admin SDK ${res.status}`
      try {
        const payload = await res.json()
        if (payload?.error?.message) message = `${message}: ${payload.error.message}`
      } catch { /* keep default */ }
      throw new DirectoryApiError(res.status, message)
    }
  }

  async function listAll(path: string, params: Record<string, string>, key: string): Promise<any[]> {
    const items: any[] = []
    let pageToken: string | null = null
    do {
      const query = new URLSearchParams({ ...params, ...(pageToken ? { pageToken } : {}) })
      const page: any = await request<any>(`${API}/${path}?${query}`)
      items.push(...((page?.[key] ?? []) as any[]))
      pageToken = typeof page?.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : null
    } while (pageToken)
    return items
  }

  const scope = (): Record<string, string> => (settings.domain ? { domain: settings.domain } : { customer: settings.customer })

  return {
    async verify() {
      await request<any>(`${API}/users?${new URLSearchParams({ ...scope(), maxResults: '1' })}`)
      try {
        const customer = await request<any>(`${API}/customers/${encodeURIComponent(settings.customer)}`)
        return { orgName: customer?.customerDomain ?? settings.domain ?? null }
      } catch {
        // customers.get needs admin.directory.customer.readonly, which we don't ask for.
        return { orgName: settings.domain ?? settings.admin_email.split('@')[1] ?? null }
      }
    },

    async listUsers(): Promise<DirectoryUser[]> {
      const rows = await listAll('users', {
        ...scope(),
        maxResults: '500',
        // 'full' includes relations (the manager relation's value is an email).
        projection: 'full',
        ...(settings.user_query ? { query: settings.user_query } : {}),
      }, 'users')
      return rows
        .filter((u) => u?.id)
        .map((u) => {
          const email = looksLikeEmail(u.primaryEmail) ? String(u.primaryEmail).toLowerCase() : null
          return {
            externalId: String(u.id),
            displayName: String(u.name?.fullName || [u.name?.givenName, u.name?.familyName].filter(Boolean).join(' ') || email || u.id),
            email,
            active: !u.suspended && !u.archived,
            ...(Array.isArray(u.relations)
              ? (() => {
                  const rel = u.relations.find((r: any) => r?.type === 'manager' && looksLikeEmail(r?.value))
                  return { manager: rel ? { email: String(rel.value).toLowerCase() } : null }
                })()
              : {}),
          }
        })
    },

    async listGroups(): Promise<DirectoryGroup[]> {
      const rows = await listAll('groups', { ...scope(), maxResults: '200' }, 'groups')
      return rows
        .filter((g) => g?.id)
        .map((g) => ({
          externalId: String(g.id),
          displayName: String(g.name || g.email || 'Unnamed group'),
          description: g.description || null,
        }))
    },

    async listGroupMemberIds(groupId: string): Promise<string[]> {
      const rows = await listAll(`groups/${encodeURIComponent(groupId)}/members`, { maxResults: '200', includeDerivedMembership: 'true' }, 'members')
      return [...new Set(rows
        .filter((m) => m?.id && (m.type === 'USER' || m.type === undefined) && m.status !== 'SUSPENDED')
        .map((m) => String(m.id)))]
    },
  }
}
