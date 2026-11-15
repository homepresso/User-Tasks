/**
 * Server side of per-workspace trusted embedding (lib/embedding-token.ts):
 * the workspace's approved origins (tenants.settings.embedding
 * .frame_ancestors), its own address, and embeddable URLs carrying the
 * signed token the proxy turns into `frame-ancestors`.
 *
 * Server-only.
 */
import { getServiceDb } from '@/lib/providers/db'
import { baseDomainFromEnv, workspaceOrigin } from '@/lib/workspace-address'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { getEmbedPolicy, isEmbedPath, parseEmbedList, workspaceEmbeddingEnabled } from './embedding'
import { EMBED_TOKEN_PARAM, embedTokenKey, mintEmbedToken } from './embedding-token'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants JSON columns are untyped */

export interface WorkspaceEmbedding {
  /** Per-workspace lists are available on this instance (EMBED_WORKSPACE_ORIGINS + workspace addresses + a signing key). */
  supported: boolean
  /** Why not, when not supported. */
  reason: string | null
  /** The workspace's approved origins. */
  origins: string[]
  /** The instance-wide list (applies to every workspace). */
  instance_origins: string[]
  /** The workspace's own address (https://<subdomain>.<base>), when it has one. */
  workspace_url: string | null
}

export async function loadWorkspaceEmbedding(tenantId: string): Promise<WorkspaceEmbedding> {
  const { data } = await (getServiceDb() as any).from('tenants').select('subdomain, settings').eq('id', tenantId).maybeSingle()
  const settings = (data?.settings ?? {}) as Record<string, any>
  const stored = settings.embedding?.frame_ancestors
  const origins = parseEmbedList(Array.isArray(stored) ? stored : []).origins
  const base = baseDomainFromEnv()
  const subdomain = typeof data?.subdomain === 'string' && data.subdomain ? data.subdomain : null
  const workspaceUrl = base && subdomain ? workspaceOrigin(subdomain, base, configuredAppUrl()) : null
  const reason = !workspaceEmbeddingEnabled()
    ? 'Per-workspace embedding is off on this instance (EMBED_WORKSPACE_ORIGINS); use the instance list (EMBED_FRAME_ANCESTORS).'
    : !base ? 'Workspace addresses are off on this instance (no base domain): use the instance list.'
      : !subdomain ? 'This workspace has no address (Settings → Workspace address): approved sites apply on the workspace\'s own address only.'
        : !embedTokenKey() ? 'The server has no signing key for embedding (ENCRYPTION_KEY or EMBED_SIGNING_SECRET).' : null
  return { supported: reason === null, reason, origins, instance_origins: getEmbedPolicy().origins, workspace_url: workspaceUrl }
}

/**
 * The URL to send a browser to for an embeddable page of this workspace:
 * on the workspace's own address with the signed origins token when
 * per-workspace embedding applies; otherwise `path` unchanged (relative), so
 * the instance list decides as before. Non-embeddable paths are returned
 * unchanged.
 */
export async function embedUrlFor(tenantId: string | null, path: string): Promise<string> {
  if (!tenantId || !isEmbedPath(path.split('?')[0])) return path
  const embedding = await loadWorkspaceEmbedding(tenantId).catch(() => null)
  if (!embedding?.supported || !embedding.workspace_url || !embedding.origins.length) return path
  const subdomain = new URL(embedding.workspace_url).hostname.split('.')[0]
  const token = mintEmbedToken({ workspace: subdomain, origins: embedding.origins })
  if (!token) return path
  const url = new URL(path, embedding.workspace_url)
  url.searchParams.set(EMBED_TOKEN_PARAM, token)
  return url.toString()
}

/** The workspace's own origin (https://<subdomain>.<base>), or null. */
export async function workspaceUrlFor(tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null
  const base = baseDomainFromEnv()
  if (!base) return null
  const { data } = await (getServiceDb() as any).from('tenants').select('subdomain').eq('id', tenantId).maybeSingle()
  return typeof data?.subdomain === 'string' && data.subdomain ? workspaceOrigin(data.subdomain, base, configuredAppUrl()) : null
}
