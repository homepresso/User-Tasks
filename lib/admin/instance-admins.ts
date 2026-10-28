import { readEnv } from '@/lib/config/bootstrap'

/**
 * Instance administrators: the people who may open Settings → Infrastructure.
 *
 * Instance infrastructure is not workspace data, so no workspace role grants
 * it — a tenant owner with every permission is not an instance admin. The
 * list is operator-managed: the INSTANCE_ADMIN_EMAILS environment variable
 * (comma / whitespace separated) plus the `instance.admin_emails` instance
 * setting (`usertasks-admin instance-admins add <email>`). Matching is by
 * case-insensitive email, and only for an address the auth provider has
 * verified (see canViewInfrastructure).
 */

export const INSTANCE_ADMINS_SETTING = 'instance.admin_emails'

export function parseAdminEmails(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[\s,;]+/) : []
  return [...new Set(items.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e)))]
}

/** Env list ∪ setting list. */
export function instanceAdminEmails(settingValue: unknown, env: string | undefined = readEnv('INSTANCE_ADMIN_EMAILS')): Set<string> {
  return new Set([...parseAdminEmails(env), ...parseAdminEmails(settingValue)])
}

export interface InfrastructureViewer {
  id: string
  email?: string | null
}

export interface InfrastructureAccessDeps {
  /** The `instance.admin_emails` setting value. */
  adminSetting: () => Promise<unknown>
  /** Whether the auth provider has verified this user's email address. */
  emailVerified: (user: InfrastructureViewer & { email: string }) => Promise<boolean>
  env?: string
}

/**
 * True only for a signed-in user whose verified email is on the instance
 * admin list. No list configured → nobody.
 */
export async function canViewInfrastructure(user: InfrastructureViewer | null | undefined, deps: InfrastructureAccessDeps): Promise<boolean> {
  const email = user?.email?.trim().toLowerCase()
  if (!user?.id || !email) return false
  const admins = instanceAdminEmails(await deps.adminSetting().catch(() => undefined), deps.env ?? readEnv('INSTANCE_ADMIN_EMAILS'))
  if (!admins.has(email)) return false
  return deps.emailVerified({ ...user, email }).catch(() => false)
}
