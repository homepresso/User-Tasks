'use server'

import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { getWorkspaceDnsReport, type WorkspaceDnsReport } from '@/lib/workspace-dns-check'

/*
 * Settings → Workspace DNS. Instance admins only, re-checked on every call
 * (the page being visible is not enough). The checks take no input: every
 * hostname comes from the configured base domain.
 */

const DENIED = 'Only instance admins can run these checks.'

/** Re-run the DNS / TLS / HTTP checks ("Check again"), bypassing the one-minute cache. */
export async function checkWorkspaceDnsAction(): Promise<{ report: WorkspaceDnsReport } | { error: string }> {
  try {
    const { user } = await getSessionDbWithUser()
    if (!(await viewerCanSeeInfrastructure(user))) return { error: DENIED }
  } catch {
    return { error: DENIED }
  }
  return { report: await getWorkspaceDnsReport({ refresh: true }) }
}
