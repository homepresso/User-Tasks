/**
 * Server side of the embedded designers (lib/embed/designers.ts): the checks
 * every /embed/workflows|forms|runs route makes before it renders the
 * designer in EmbeddedDesignerShell — workspace address, signed in (inside a
 * frame: the sign-in that works there), the role's permission for the page
 * (the same rule as the app route, lib/route-permissions.ts) — and the launch
 * parameters (return target and host origin, validated against the approved
 * embedding origins). Server-only.
 */

import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { notFound, redirect, unstable_rethrow } from 'next/navigation'
import { getEmbedPolicy } from '@/lib/embedding'
import { frameContext } from '@/lib/forms/embed'
import { holdsPermission } from '@/lib/permissions'
import { fromSession } from '@/lib/services/context'
import { enforceHostWorkspace } from '@/lib/workspace-host'
import { loadExtensionUiState } from '@/lib/extensions/ui-server'
import { EmbedNotice } from '@/components/embed/designer-states'
import { EmbedAutoSignIn, EmbedSignIn } from '@/components/embed/embed-sign-in'
import { autoSsoPath, cleanOrgHint, LAUNCH_ORG_PARAM, SSO_DONE_PATH } from '@/lib/providers/auth/sso/auto'
import { resolveAutoSso } from '@/lib/providers/auth/sso/auto-server'
import { loadWorkspaceEmbedding } from '@/lib/embedding-server'
import type { EmbeddedDesignerShellProps } from '@/components/embed/designer-shell'
import { parseLaunchOptions, type DesignerKind } from './designers'

export type Query = Record<string, string | string[] | undefined>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function queryString(query: Query): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, value)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export type DesignerGate =
  | { kind: 'ok'; shell: Omit<EmbeddedDesignerShellProps, 'children'> }
  | { kind: 'node'; node: ReactNode }

/**
 * Checks for one embedded designer page. `embedPath` is this page (no query),
 * `appPath` the same page in the full app; `allOf` the role permissions the
 * app route needs.
 */
export async function embedDesignerGate(input: { kind: DesignerKind; id: string; embedPath: string; appPath: string; query: Query; allOf: string[] }): Promise<DesignerGate> {
  if (!UUID_RE.test(input.id)) notFound()
  // Before sign-in only the instance list is known; afterwards the workspace's own approved sites count too.
  let options = parseLaunchOptions(input.query, getEmbedPolicy().origins)
  const qs = queryString(input.query)
  const here = `${input.embedPath}${qs}`
  const backHref = () => options.ret?.url ?? null

  const host = await enforceHostWorkspace({ allowSignedOut: true })
  if (host.kind === 'non_member') {
    return { kind: 'node', node: <EmbedNotice title="You can't open this here" body="You are signed in to UserTasks, but not as a member of this workspace." backHref={backHref()} backLabel={options.ret?.label ?? null} /> }
  }
  let ctx
  try {
    ctx = await fromSession()
  } catch (error) {
    unstable_rethrow(error)
    const h = await headers()
    const where = frameContext((name) => h.get(name))
    // Automatic sign-in with the workspace's IdP (lib/providers/auth/sso/auto.ts), as on /embed/x/…: at the top
    // level the round trip (or the sign-in page) comes back here; in a frame a silent attempt, then a popup.
    const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
    const auto = await resolveAutoSso({ org: cleanOrgHint(one(input.query[LAUNCH_ORG_PARAM])), purpose: 'launch' }).catch(() => null)
    if (where === 'top') redirect(auto ? autoSsoPath({ redirect: here, org: auto.org }) : `/login?redirect=${encodeURIComponent(here)}`)
    const loginHref = auto ? autoSsoPath({ redirect: input.appPath, org: auto.org }) : `/login?redirect=${encodeURIComponent(input.appPath)}`
    if (auto) {
      return {
        kind: 'node',
        node: <EmbedAutoSignIn idpName={auto.idpName} newTabHref={loginHref} reloadHref={here}
          silentUrl={autoSsoPath({ redirect: SSO_DONE_PATH, org: auto.org, mode: 'frame' })}
          popupUrl={autoSsoPath({ redirect: SSO_DONE_PATH, org: auto.org, mode: 'popup' })} />,
      }
    }
    return { kind: 'node', node: <EmbedSignIn loginHref={loginHref} reloadHref={here} /> }
  }
  // Per-workspace trusted embedding (lib/embedding-server.ts): the workspace's approved sites are return targets too.
  const workspace = ctx.tenantId ? await loadWorkspaceEmbedding(ctx.tenantId).catch(() => null) : null
  if (workspace?.supported && workspace.origins.length) options = parseLaunchOptions(input.query, [...getEmbedPolicy().origins, ...workspace.origins])
  const allowed = ctx.permissions === null || input.allOf.every((p) => holdsPermission(ctx.permissions!, p))
  if (!allowed) {
    return { kind: 'node', node: <EmbedNotice title="Not authorized" body="Your role in this workspace doesn't include this page. Ask a workspace admin if you need access." backHref={backHref()} backLabel={options.ret?.label ?? null} /> }
  }
  const extensionUi = await loadExtensionUiState(ctx)
  return {
    kind: 'ok',
    shell: { kind: input.kind, id: input.id.toLowerCase(), appPath: input.appPath, ret: options.ret, hostOrigin: options.hostOrigin, header: options.header, carried: options.carried, extensionUi },
  }
}
