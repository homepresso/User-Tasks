import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { getServiceDb } from '@/lib/providers/db'
import { rateLimit } from '@/lib/rate-limit'
import { ServiceError, type AnySupabaseClient, type ServiceContext } from '../context'

/**
 * Who may use the instance admin ("cloud admin") operations: instance admins
 * only — a signed-in person whose VERIFIED email is on INSTANCE_ADMIN_EMAILS
 * or the `instance.admin_emails` instance setting, the same check as
 * Settings → Infrastructure and (cloud) Settings → Query
 * (lib/admin/instance-admins.ts). No workspace role grants it: a workspace
 * owner with every permission is refused like anyone else.
 *
 *  - A person, never a credential alone: tenant-wide API keys, anonymous
 *    form visitors and contexts without a user id are refused.
 *  - Not through the in-app Agent (ctx.via === 'agent'): an AI must not act
 *    across workspaces on someone's behalf.
 *  - Everyone refused gets 404 "Not found" (the operations don't exist for
 *    them), so the surface is not discoverable.
 *
 * After the check the services use the service-role client with explicit
 * tenant filters and explicit column lists.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface InstanceAdmin {
  userId: string
  email: string
  /** Where the call came from (audit `via`). */
  via: 'api' | 'app' | 'workflow' | 'cli' | 'mcp' | 'ui'
}

type AdminCheck = (viewer: { id: string; email: string | null }) => Promise<boolean>
let adminCheck: AdminCheck = (viewer) => viewerCanSeeInfrastructure(viewer)
let serviceDbFactory: () => AnySupabaseClient = () => getServiceDb() as unknown as AnySupabaseClient

/** Tests: replace the instance-admin predicate (null restores it). */
export function setInstanceAdminCheckForTests(fn: AdminCheck | null): void {
  adminCheck = fn ?? ((viewer) => viewerCanSeeInfrastructure(viewer))
}
/** Tests: replace the service database client (null restores it). */
export function setInstanceServiceDbForTests(fn: (() => AnySupabaseClient) | null): void {
  serviceDbFactory = fn ?? (() => getServiceDb() as unknown as AnySupabaseClient)
}

/** The service-role client (after requireInstanceAdmin only). */
export function instanceDb(): AnySupabaseClient {
  return serviceDbFactory()
}

export const NOT_AVAILABLE = 'Not found'
/** The message an app widget / rule shows a viewer who is not an instance admin. */
export const ACCESS_MESSAGE = 'Only UserTasks instance admins can see this.'

function viaOf(ctx: ServiceContext, override?: InstanceAdmin['via']): InstanceAdmin['via'] {
  if (override) return override
  if (ctx.source === 'mcp') return 'mcp'
  if (ctx.authKind === 'oauth') return 'cli'
  if (ctx.source === 'ui') return 'ui'
  return 'api'
}

/** May this caller even be considered (a person, not a tenant key / anonymous / the Agent)? */
export function eligibleCaller(ctx: ServiceContext): string | null {
  if (!ctx || !ctx.actorId || !UUID_RE.test(ctx.actorId)) return null
  if (ctx.authKind === 'anonymous' || ctx.keyType === 'tenant' || ctx.via === 'agent') return null
  return ctx.actorId
}

/** Is the person with this id an instance admin? (email looked up server-side, verified by the auth provider) */
export async function isInstanceAdminUser(userId: string): Promise<{ ok: boolean; email: string | null }> {
  if (!UUID_RE.test(userId)) return { ok: false, email: null }
  try {
    const { data } = await (instanceDb() as any).from('users').select('email').eq('id', userId).is('deleted_at', null).maybeSingle()
    const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : null
    if (!email) return { ok: false, email: null }
    return { ok: await adminCheck({ id: userId, email }), email }
  } catch {
    return { ok: false, email: null }
  }
}

/** Is the caller an instance admin? (never throws) */
export async function isInstanceAdmin(ctx: ServiceContext): Promise<boolean> {
  const id = eligibleCaller(ctx)
  if (!id) return false
  return (await isInstanceAdminUser(id)).ok
}

/**
 * The instance admin behind this call, or a 404. `kind` picks the rate
 * limit: reads 300 a minute, actions 30 a minute per admin.
 */
export async function requireInstanceAdmin(
  ctx: ServiceContext,
  options: { kind?: 'read' | 'action'; via?: InstanceAdmin['via']; refusal?: 'not_found' | 'forbidden' } = {},
): Promise<InstanceAdmin> {
  const refuse = () => options.refusal === 'forbidden' ? ServiceError.forbidden(ACCESS_MESSAGE) : ServiceError.notFound(NOT_AVAILABLE)
  const id = eligibleCaller(ctx)
  if (!id) throw refuse()
  const { ok, email } = await isInstanceAdminUser(id)
  if (!ok || !email) throw refuse()
  const kind = options.kind ?? 'read'
  const limit = kind === 'action' ? { max: 30, windowMs: 60_000 } : { max: 300, windowMs: 60_000 }
  const result = await rateLimit(`instance-admin:${kind}:${id}`, limit)
  if (!result.ok) {
    throw new ServiceError('rate_limited', `Too many instance admin ${kind === 'action' ? 'actions' : 'requests'}: try again in ${Math.max(1, Math.ceil(result.retryAfterMs / 1000))} s`)
  }
  return { userId: id, email, via: viaOf(ctx, options.via) }
}
