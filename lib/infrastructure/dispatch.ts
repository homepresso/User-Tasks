import type { InfrastructureActionResult, InfrastructureViewer } from '@/lib/extensions/sdk'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { DENIED, addonRequired } from '@/lib/admin/infrastructure-settings'
import { infrastructureAddon } from './provider'

/**
 * Call one of the Infrastructure add-on's actions for a signed-in user:
 * instance admins only, and only while the add-on is installed and licensed
 * for `infrastructure-separation` (expired: 24 hours of grace, then refused).
 * Used by core's server actions (Settings → Infrastructure, the setup
 * wizard). Server-only.
 */
export async function callInfrastructureAction(viewer: InfrastructureViewer | null, name: string, input?: unknown): Promise<InfrastructureActionResult> {
  if (!viewer || !(await viewerCanSeeInfrastructure(viewer))) return DENIED
  const addon = await infrastructureAddon()
  if (addon.state !== 'ready') return { ...addonRequired(), error: addon.reason }
  const actions = addon.resolved.provider.actions
  const action = Object.prototype.hasOwnProperty.call(actions, name) ? actions[name] : undefined
  if (typeof action !== 'function') return { ok: false, error: `Unknown infrastructure action: ${name}` }
  return action({ ctx: addon.resolved.ctx, viewer, input })
}
