/**
 * Which edition is this server? Client-safe and pure (the caller passes the
 * compiled extension ids and the environment).
 *
 *   USERTASKS_EDITION / USERTASKS_EDITION_VERSION are baked into edition
 *   images at build time (Dockerfile build args; the Enterprise build sets
 *   enterprise / <core>-ent.<n>). Without them (images built before), the
 *   compiled paid extensions tell: none = the public image, only SharePoint
 *   = the legacy SharePoint edition, anything else = a custom build.
 */

import { EDITIONS, editionById } from './catalog'

export type RunningEditionId = 'core' | 'enterprise' | 'sharepoint' | 'custom'

export interface RunningEdition {
  id: RunningEditionId
  name: string
  version: string | null
}

const PAID_IDS = new Set(Object.values(EDITIONS).flatMap((e) => e.extensions.map((x) => x.id)))

export function runningEdition(compiledIds: readonly string[], env: Record<string, string | undefined> = process.env): RunningEdition {
  const version = env.USERTASKS_EDITION_VERSION?.trim() || null
  const baked = editionById(env.USERTASKS_EDITION?.trim())
  if (baked && (baked.id === 'enterprise' || baked.id === 'sharepoint')) return { id: baked.id, name: baked.name, version }
  const paid = compiledIds.filter((id) => PAID_IDS.has(id))
  if (!paid.length) return { id: 'core', name: 'UserTasks (public image)', version: null }
  if (paid.length === 1 && paid[0] === 'sharepoint') return { id: 'sharepoint', name: EDITIONS.sharepoint.name, version }
  return { id: 'custom', name: 'UserTasks (custom build with paid extensions)', version }
}
