import { z } from 'zod'
import { defineEndpoint } from './registry'

/**
 * Automatic single sign-on for the workspace (lib/providers/auth/sso/auto.ts):
 * tenants.settings.sso. Reads are open to any member; changing needs
 * settings.edit.
 */

const settings = {
  auto_sign_in: z.boolean().describe('Sign in automatically with SSO when UserTasks is opened from another system (a SharePoint add-in button, a portal link to an extension page): no sign-in page — passive first (OIDC prompt=none, SAML IsPassive), then the identity provider\'s own sign-in if it needs the person. Default true; applies when an identity provider resolves'),
  sso_only: z.boolean().describe('SSO only: skip the sign-in page — /login goes straight to the identity provider. Default false. /login?local=1, errors and signing out still show the page'),
  idp: z.string().nullable().describe('The identity provider (its id) to sign in with; null = automatic: the one that provisions into this workspace (defaultOrg), else the instance\'s only one'),
}

const ssoResponse = z.object({
  ...settings,
  instance_sso_only: z.boolean().describe('The instance skips the sign-in page for every workspace (AUTH_SSO_ONLY)'),
  providers: z.array(z.object({ id: z.string(), name: z.string() })).describe('Identity providers automatic sign-in can use on this instance'),
  effective_idp: z.string().nullable().describe('The identity provider signed-out visitors are sent to now; null = none applies (the sign-in page shows)'),
})

const tags = ['Workspace']

export const getWorkspaceSsoEndpoint = defineEndpoint({
  method: 'GET', path: '/workspace/sso', operationId: 'getWorkspaceSso', tags,
  summary: 'Get the workspace\'s automatic sign-in settings (any member)',
  description: 'Automatic SSO when opened from another system, SSO only (skip the sign-in page), the identity provider, and which one is in effect. Nobody is ever signed in from what the launching system says: only the identity provider\'s signed answer counts.',
  permission: null,
  response: ssoResponse,
  cli: { resource: 'workspace-sso', verb: 'get' },
})

export const updateWorkspaceSsoEndpoint = defineEndpoint({
  method: 'PATCH', path: '/workspace/sso', operationId: 'updateWorkspaceSso', tags,
  summary: 'Change the workspace\'s automatic sign-in settings',
  description: 'Send only what changes. idp must be one of the instance\'s identity providers (or null for automatic). Audited.',
  permission: 'settings.edit',
  body: z.object({
    auto_sign_in: settings.auto_sign_in.optional(),
    sso_only: settings.sso_only.optional(),
    idp: z.string().max(40).nullable().optional().describe(settings.idp.description ?? ''),
  }),
  response: ssoResponse,
  cli: { resource: 'workspace-sso', verb: 'update' },
})

export const workspaceSsoEndpoints = [getWorkspaceSsoEndpoint, updateWorkspaceSsoEndpoint]
