/**
 * Workflows installed from a package whose setup is incomplete (a connector
 * without credentials, an integration without auth, …) are installed
 * inactive and cannot be activated or published until the package's
 * "Complete setup" fills the requirement. Checked by lib/services/workflows
 * (REST / MCP / CLI) and the designer's server actions.
 */

import { ServiceError } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role client */

export interface ActivationBlock {
  install_id: string
  package_name: string
  version: string
  reasons: string[]
}

/** Why this workflow cannot be activated yet (null = it can). `admin` must be a service-role client. */
export async function workflowActivationBlock(admin: any, workflowId: string, tenantId?: string | null): Promise<ActivationBlock | null> {
  try {
    return await findBlock(admin, workflowId, tenantId)
  } catch {
    return null // tables unavailable (mocked clients in unit tests)
  }
}

async function findBlock(admin: any, workflowId: string, tenantId?: string | null): Promise<ActivationBlock | null> {
  if (!admin?.from) return null
  let query = admin.from('package_install_assets')
    .select('install_id, blocked_by, status')
    .eq('asset_type', 'workflow').eq('local_id', workflowId).eq('status', 'needs_config')
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data, error } = await query.limit(1)
  if (error || !data?.length) return null
  const row = data[0]
  const { data: install } = await admin.from('package_installs').select('id, name, version, requirements').eq('id', row.install_id).maybeSingle()
  if (!install) return null
  const blockedBy = new Set<string>(Array.isArray(row.blocked_by) ? row.blocked_by.map(String) : [])
  const reasons = (Array.isArray(install.requirements) ? install.requirements : [])
    .filter((req: any) => blockedBy.has(String(req.id)) && req.status !== 'met')
    .map((req: any) => String(req.label))
  if (blockedBy.size && !reasons.length) return null
  return { install_id: String(install.id), package_name: String(install.name), version: String(install.version), reasons }
}

export function activationBlockMessage(block: ActivationBlock): string {
  const why = block.reasons.length ? ` (${block.reasons.join('; ')})` : ''
  return `Needs configuration: this workflow comes from package “${block.package_name}” ${block.version}, whose setup is incomplete${why}. Complete setup in Settings → Packages, then activate it.`
}

/** Throws a validation ServiceError when the workflow is blocked. */
export async function assertWorkflowActivatable(admin: any, workflowId: string, tenantId?: string | null): Promise<void> {
  const block = await workflowActivationBlock(admin, workflowId, tenantId)
  if (block) throw ServiceError.validation(activationBlockMessage(block), { package_install_id: block.install_id, reasons: block.reasons })
}
