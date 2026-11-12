import { redirect } from 'next/navigation'
import { getDeploymentMode } from '@/lib/deployment'
import { getServiceDb, hasServiceDb } from '@/lib/providers/db'
import { isSetupNeeded, type SetupDb } from './state'

/**
 * Server-side entry points for first-run setup (self-hosted only; the cloud
 * edition never checks, so production pays nothing).
 */

export function setupDb(): SetupDb {
  return getServiceDb() as unknown as SetupDb
}

/** Self-hosted, a service client configured, and no tenants and no users yet (cached; see lib/setup/state). */
export async function setupNeeded(opts: { fresh?: boolean } = {}): Promise<boolean> {
  if (getDeploymentMode() !== 'self_hosted' || !hasServiceDb()) return false
  return isSetupNeeded(setupDb, { selfHosted: true, fresh: opts.fresh })
}

/** `/`, `/login` and the dashboard: send a brand-new install to /setup. */
export async function redirectToSetupIfNeeded(): Promise<void> {
  if (await setupNeeded()) redirect('/setup')
}

/**
 * Self-hosted with exactly one organisation: its slug and name, so the
 * sign-in page can fill in the organisation (someone who set up "Acme Inc"
 * would otherwise have to know its slug is acme-inc). Null otherwise, on a
 * database error, and always in the cloud edition, which never lists its
 * tenants on a public page.
 */
export async function singleOrganisation(): Promise<{ slug: string; name: string } | null> {
  if (getDeploymentMode() !== 'self_hosted' || !hasServiceDb()) return null
  try {
    const { data, error } = await setupDb().from('tenants').select('slug, name').is('deleted_at', null).limit(2)
    if (error || !Array.isArray(data) || data.length !== 1) return null
    const [row] = data as Array<{ slug?: unknown; name?: unknown }>
    return typeof row.slug === 'string' && row.slug ? { slug: row.slug, name: typeof row.name === 'string' && row.name ? row.name : row.slug } : null
  } catch {
    return null
  }
}
