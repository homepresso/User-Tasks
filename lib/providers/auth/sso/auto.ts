import { AuthError } from '../types'

/**
 * Automatic single sign-on: open UserTasks from another system (a SharePoint
 * add-in button, an intranet portal, a deep link into an extension page)
 * without the UserTasks sign-in page, by signing in through the identity
 * provider the person is already signed in to (AD FS with Windows
 * Integrated Authentication, Entra ID, any OIDC / SAML IdP).
 *
 * Why this and nothing else: the systems that launch UserTasks generally
 * cannot vouch for their user (a high-trust SharePoint add-in launch is a
 * plain cross-site POST with SPHostUrl and list ids — no signed user
 * identity). A user name or email in such a request is unsigned and anyone
 * could forge it, so it is NEVER used to sign anybody in. The only proof of
 * identity is the IdP's signed answer (OIDC ID token / SAML assertion),
 * validated exactly as for an interactive sign-in (lib/providers/auth/sso).
 * What the launch may influence is limited to hints that cannot change who
 * gets signed in: which workspace's IdP to ask (`org`), a login_hint for the
 * IdP's account picker, and the local path to return to (sanitizeRedirect).
 *
 * The flow (route /auth/auto-sso):
 *  1. passive first: OIDC `prompt=none`, SAML `IsPassive="true"` — the IdP
 *     answers at once, signing the person in when it can do so without
 *     interaction (an existing IdP session, Kerberos / WIA);
 *  2. when it can't (`login_required`, `interaction_required`,
 *     `consent_required`, `account_selection_required`; SAML NoPassive or
 *     another non-success status), the callback falls back to a normal
 *     interactive sign-in at the same IdP (`fallback: 'interactive'`) — still
 *     without the UserTasks sign-in page — or, in a frame where IdP pages
 *     can't be shown, returns to the target with `?sso_error=` so the page can
 *     offer a popup (`fallback: 'return'`, components/embed/embed-sign-in.tsx);
 *  3. a passive failure never leads to another passive attempt (the fallback
 *     is interactive or a return), so there are no redirect loops.
 *
 * Settings (tenants.settings.sso, Settings → SSO & Directory, REST
 * /workspace/sso, MCP workspace_sso_*, CLI `workspace-sso`):
 *   auto_sign_in  sign in automatically with SSO when opened from another
 *                 system (default on; applies when an IdP resolves);
 *   sso_only      skip the sign-in page: /login goes straight to the IdP
 *                 (default off; `/login?local=1` and every error still show
 *                 the page — the administrators' way in when the IdP is down);
 *   idp           which IdP (default: the one whose defaultOrg is this
 *                 workspace, else the instance's only one).
 * Instance-wide: auth.sso_only / AUTH_SSO_ONLY does the same as sso_only for
 * every workspace.
 */

export interface WorkspaceSsoSettings {
  auto_sign_in: boolean
  sso_only: boolean
  idp: string | null
}

export const DEFAULT_WORKSPACE_SSO: WorkspaceSsoSettings = { auto_sign_in: true, sso_only: false, idp: null }

const IDP_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The workspace's settings from tenants.settings (defaults for anything missing or malformed). */
export function workspaceSsoFromTenantSettings(settings: unknown): WorkspaceSsoSettings {
  const sso = asObject(asObject(settings).sso)
  return {
    auto_sign_in: typeof sso.auto_sign_in === 'boolean' ? sso.auto_sign_in : DEFAULT_WORKSPACE_SSO.auto_sign_in,
    sso_only: typeof sso.sso_only === 'boolean' ? sso.sso_only : DEFAULT_WORKSPACE_SSO.sso_only,
    idp: typeof sso.idp === 'string' && IDP_ID_RE.test(sso.idp) ? sso.idp : null,
  }
}

/** What is wrong with a patch, or null. */
export function workspaceSsoPatchProblem(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Send an object with auto_sign_in, sso_only and/or idp.'
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === 'auto_sign_in' || key === 'sso_only') {
      if (typeof value !== 'boolean') return `${key} must be true or false.`
    } else if (key === 'idp') {
      if (value !== null && value !== '' && (typeof value !== 'string' || !IDP_ID_RE.test(value))) return 'idp must be an identity provider id (lowercase letters, digits, - and _), or null for automatic.'
    } else {
      return `Unknown setting "${key}".`
    }
  }
  return null
}

export function applyWorkspaceSsoPatch(before: WorkspaceSsoSettings, patch: Record<string, unknown>): WorkspaceSsoSettings {
  return {
    auto_sign_in: typeof patch.auto_sign_in === 'boolean' ? patch.auto_sign_in : before.auto_sign_in,
    sso_only: typeof patch.sso_only === 'boolean' ? patch.sso_only : before.sso_only,
    idp: 'idp' in patch ? (typeof patch.idp === 'string' && patch.idp ? patch.idp : null) : before.idp,
  }
}

/** An IdP the automatic sign-in may use: its id and, for configured IdPs, the workspace it provisions into. */
export interface AutoSsoCandidate {
  id: string
  name: string
  defaultOrg?: string | null
}

/**
 * Which IdP a workspace signs in with automatically:
 *  - the workspace's chosen `idp` (null when it is not available);
 *  - otherwise the one IdP whose defaultOrg is this workspace;
 *  - otherwise the instance's only IdP (`implicit` lists only — Supabase
 *    Auth's generic Google / Microsoft buttons are never chosen implicitly,
 *    because nothing says the workspace uses them).
 */
export function chooseAutoIdp(
  candidates: AutoSsoCandidate[],
  settings: WorkspaceSsoSettings,
  workspaceSlug: string | null,
  implicit: boolean,
): AutoSsoCandidate | null {
  if (settings.idp) return candidates.find((c) => c.id === settings.idp) ?? null
  if (!implicit) return null
  if (workspaceSlug) {
    const own = candidates.filter((c) => c.defaultOrg && c.defaultOrg.toLowerCase() === workspaceSlug.toLowerCase())
    if (own.length === 1) return own[0]
  }
  return candidates.length === 1 ? candidates[0] : null
}

/** IdP error codes that mean "can't sign in without the user" (OpenID Connect Core 3.1.2.6). */
export const SILENT_SIGN_IN_ERRORS = new Set(['login_required', 'interaction_required', 'consent_required', 'account_selection_required'])

/**
 * After a failed passive attempt: `interactive` — the IdP's own sign-in
 * (top-level windows); `return` — back to the target with `?sso_error=`
 * (frames, where IdP pages can't be shown).
 */
export type SsoFallback = 'interactive' | 'return'

/** Extra options for an SSO start (AuthProvider.startSso). */
export interface SsoStartOptions {
  /** OIDC prompt=none / SAML IsPassive. */
  passive?: boolean
  /** What a failed passive attempt does (default interactive). */
  fallback?: SsoFallback
  /** Passed to the IdP's account picker; never trusted as identity. */
  loginHint?: string | null
  /** The flow runs inside a cross-site frame: its browser-binding cookie must be SameSite=None to be stored and sent there. */
  frame?: boolean
}

/** What a flow remembers about how it started (stored with the flow state). */
export interface SsoFlowMeta {
  idp: string
  redirect: string
  org: string | null
  passive: boolean
  fallback: SsoFallback
  loginHint: string | null
}

/** A passive attempt the IdP could not complete silently. */
export class InteractionRequired extends AuthError {
  constructor(readonly flow: SsoFlowMeta, message = 'The identity provider needs you to sign in') {
    super('sso_failed', message)
    this.name = 'AuthError'
  }
}

export function isInteractionRequired(error: unknown): error is InteractionRequired {
  return error instanceof InteractionRequired
}

/** Remember the flow on an error thrown after the flow was read (so failures can follow its fallback). */
export function withFlow<E>(error: E, flow: SsoFlowMeta | null): E {
  if (flow && error && typeof error === 'object') (error as { ssoFlow?: SsoFlowMeta }).ssoFlow = flow
  return error
}

export function flowOf(error: unknown): SsoFlowMeta | null {
  if (!error || typeof error !== 'object') return null
  return (error as { ssoFlow?: SsoFlowMeta }).ssoFlow ?? null
}

/** Flow meta from stored flow-state data (tolerant of flows started before this existed). */
export function flowMetaFrom(idp: string, data: Record<string, unknown>): SsoFlowMeta {
  return {
    idp,
    redirect: typeof data.redirect === 'string' ? data.redirect : '/home',
    org: typeof data.org === 'string' && data.org ? data.org : null,
    passive: data.passive === true,
    fallback: data.fallback === 'return' ? 'return' : 'interactive',
    loginHint: typeof data.loginHint === 'string' && data.loginHint ? data.loginHint : null,
  }
}

/** `path` (local) with ?sso_error=<code> set. */
export function withSsoError(path: string, code: string): string {
  const url = new URL(path, 'http://local.invalid')
  url.searchParams.set('sso_error', code)
  return `${url.pathname}${url.search}`
}

/** A login_hint worth passing on (an address or a user name), else null. */
export function cleanLoginHint(raw: string | null | undefined): string | null {
  const hint = String(raw ?? '').trim()
  return hint && hint.length <= 254 && /^[^\s<>"'\\]+$/.test(hint) ? hint : null
}

/** The automatic sign-in route. */
export const AUTO_SSO_PATH = '/auth/auto-sso'

/** Where the automatic sign-in reports back (frames and popups; components/embed/embed-sign-in.tsx). */
export const SSO_DONE_PATH = '/embed/auth/sso-done'

export type AutoSsoMode = 'top' | 'frame' | 'popup'
export type AutoSsoPurpose = 'launch' | 'login'

/** /auth/auto-sso?… for a target path. */
export function autoSsoPath(input: { redirect: string; org?: string | null; mode?: AutoSsoMode; purpose?: AutoSsoPurpose; loginHint?: string | null }): string {
  const q = new URLSearchParams({ redirect: input.redirect })
  if (input.org) q.set('org', input.org)
  if (input.mode && input.mode !== 'top') q.set('mode', input.mode)
  if (input.purpose === 'login') q.set('for', 'login')
  if (input.loginHint) q.set('login_hint', input.loginHint)
  return `${AUTO_SSO_PATH}?${q}`
}

/**
 * Workspace hint on launch URLs (`?ut_org=<workspace slug>`): which
 * workspace's IdP a signed-out visitor is sent to. Unsigned on purpose — it
 * selects an IdP, never an identity (equivalent to the public
 * /auth/sso/<id>/start?org=). Extensions add it with ctx.launchUrl().
 */
export const LAUNCH_ORG_PARAM = 'ut_org'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

export function cleanOrgHint(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return SLUG_RE.test(slug) ? slug : null
}
