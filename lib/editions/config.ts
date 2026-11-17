/**
 * Server configuration of edition downloads (usertasks.com only). Nothing
 * here names the private upstream: it comes from the environment.
 *
 *   EDITION_PULL_TOKEN_SECRET        ≥ 32 random characters; signs the 30-minute pull tokens
 *   EDITION_UPSTREAM_<EDITION>       the private image repository, e.g. EDITION_UPSTREAM_SHAREPOINT=<registry>/<owner>/<name>
 *   EDITION_UPSTREAM_USERNAME        read-only credential for the upstream registry
 *   EDITION_UPSTREAM_TOKEN           (GHCR: a token with only read:packages)
 *   EDITION_UPSTREAM_USERNAME_<EDITION> / EDITION_UPSTREAM_TOKEN_<EDITION>   per-edition overrides
 *   EDITION_REGISTRY_HOST            host the Docker clients log in to (default: the host of APP_URL, usertasks.com)
 *   EDITION_REVOKED_LICENCES         licence ids refused even while in date (comma separated)
 *
 * Until the secret, upstream and credential are set, the endpoint answers
 * 503 editions_unavailable and the registry front 503 — nothing else changes.
 */

import { publicBaseUrl } from '@/lib/deployment'
import type { EditionDefinition } from './catalog'
import { parseUpstream, type UpstreamCredentials, type UpstreamRef } from './upstream'

export interface EditionServerConfig {
  secret: string
  registryHost: string
  upstream: UpstreamRef
  credentials: UpstreamCredentials
  revoked: string[]
}

function envKey(edition: EditionDefinition): string {
  return edition.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

/** Host[:port] of the registry front. */
export function registryHost(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.EDITION_REGISTRY_HOST?.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (explicit) return explicit.toLowerCase()
  try {
    return new URL(publicBaseUrl()).host.toLowerCase()
  } catch {
    return 'usertasks.com'
  }
}

export type EditionConfigResult = { ok: true; config: EditionServerConfig } | { ok: false; missing: string[] }

export function editionServerConfig(edition: EditionDefinition, env: NodeJS.ProcessEnv = process.env): EditionConfigResult {
  const k = envKey(edition)
  const missing: string[] = []
  const secret = env.EDITION_PULL_TOKEN_SECRET?.trim() ?? ''
  if (secret.length < 32) missing.push('EDITION_PULL_TOKEN_SECRET (32+ characters)')
  const upstream = parseUpstream(env[`EDITION_UPSTREAM_${k}`])
  if (!upstream) missing.push(`EDITION_UPSTREAM_${k}`)
  const username = (env[`EDITION_UPSTREAM_USERNAME_${k}`] ?? env.EDITION_UPSTREAM_USERNAME)?.trim() ?? ''
  const token = (env[`EDITION_UPSTREAM_TOKEN_${k}`] ?? env.EDITION_UPSTREAM_TOKEN)?.trim() ?? ''
  if (!username || !token) missing.push('EDITION_UPSTREAM_USERNAME / EDITION_UPSTREAM_TOKEN')
  if (missing.length || !upstream) return { ok: false, missing }
  const revoked = (env.EDITION_REVOKED_LICENCES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return { ok: true, config: { secret, registryHost: registryHost(env), upstream, credentials: { username, token }, revoked } }
}
