import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as sso from '@/lib/services/workspace-sso'
import { messageOf } from './_util'

/*
 * Automatic single sign-on for the workspace (lib/providers/auth/sso/auto.ts):
 * read by any member, changed with settings.edit (audited in the service).
 * Thin wrappers over lib/services/workspace-sso.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

export function registerWorkspaceSsoTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('workspace_sso_get', 'Get the workspace\'s automatic sign-in settings: auto_sign_in (sign in with SSO, without the sign-in page, when UserTasks is opened from another system such as a SharePoint add-in button), sso_only (skip the sign-in page), idp (the identity provider; null = automatic), plus the instance\'s identity providers and the one in effect.', {},
    async () => run(async () => ({ sso: await sso.getWorkspaceSso(svc()) })))

  server.tool('workspace_sso_update', 'Change the workspace\'s automatic sign-in settings (settings.edit). Send only what changes. Audited.', {
    auto_sign_in: z.boolean().optional().describe('Sign in automatically with SSO when opened from another system (default true)'),
    sso_only: z.boolean().optional().describe('Skip the sign-in page: /login goes straight to the identity provider (default false)'),
    idp: z.string().max(40).nullable().optional().describe('Identity provider id from workspace_sso_get providers; null = automatic'),
  }, async (args) => run(async () => ({ sso: await sso.setWorkspaceSso(svc(), args) })))
}
