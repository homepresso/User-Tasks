/**
 * Default (server) dependencies of the pull-token endpoint and the registry
 * front, from the environment (./config.ts). Server only.
 */

import { LICENCE_KEYRING } from '@/lib/licensing/keyring'
import { hashIp } from '@/lib/licensing/trial-service'
import { rateLimit } from '@/lib/rate-limit'
import type { EditionDefinition } from './catalog'
import { editionServerConfig } from './config'
import { recordPullLog } from './access-log'
import { EDITION_MANIFEST_FILE, EDITION_SIGNATURE_FILE, type PullServiceDeps } from './pull-service'
import type { RegistryFrontDeps } from './registry-front'
import { UpstreamRegistry } from './upstream'

const clients = new Map<string, UpstreamRegistry>()

function upstreamFor(edition: EditionDefinition): { secret: string; registryHost: string; revoked: string[]; upstream: UpstreamRegistry } | { missing: string[] } {
  const result = editionServerConfig(edition)
  if (!result.ok) return { missing: result.missing }
  const { config } = result
  const key = `${edition.id}|${config.upstream.host}/${config.upstream.repository}|${config.credentials.username}|${config.credentials.token.length}`
  let client = clients.get(key)
  if (!client) {
    client = new UpstreamRegistry(config.upstream, config.credentials)
    clients.set(key, client)
  }
  return { secret: config.secret, registryHost: config.registryHost, revoked: config.revoked, upstream: client }
}

export function defaultPullServiceDeps(edition: EditionDefinition): PullServiceDeps {
  return {
    now: () => new Date(),
    keyring: () => LICENCE_KEYRING,
    config: () => {
      const c = upstreamFor(edition)
      return 'missing' in c ? { ok: false, missing: c.missing } : { ok: true, secret: c.secret, registryHost: c.registryHost, revoked: c.revoked }
    },
    readRelease: async (ref) => {
      const c = upstreamFor(edition)
      if ('missing' in c) return null
      const files = await c.upstream.artifactFiles(ref, [EDITION_MANIFEST_FILE, EDITION_SIGNATURE_FILE])
      return files ? { manifest: files[EDITION_MANIFEST_FILE], signature: files[EDITION_SIGNATURE_FILE] } : null
    },
    log: recordPullLog,
  }
}

export function defaultRegistryFrontDeps(): RegistryFrontDeps {
  return {
    now: () => new Date(),
    edition: (edition) => {
      const c = upstreamFor(edition)
      return 'missing' in c ? null : { secret: c.secret, upstream: c.upstream }
    },
    // A pull is ~10-30 requests (index, platform manifest, config, layers);
    // retries and both architectures stay far below this.
    allow: async (token) => (await rateLimit(`edition-pull:${token.jti}`, { max: 600, windowMs: 30 * 60_000 })).ok,
  }
}

export function requestIpHash(headers: Headers): string | null {
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || null
  return hashIp(ip)
}
