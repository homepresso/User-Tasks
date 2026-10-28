/** login / logout / whoami */

import type { Command } from 'commander'
import { apiKeyAuth, revokeToken } from '@usertasks/sdk'
import type { OAuthCredentials } from '../config'
import { CliUsageError } from '../exit-codes'
import { browserLogin, buildOAuthCredentials } from '../oauth'
import type { Runtime } from '../runtime'
import { normaliseServerUrl } from '../settings'

interface Me {
  tenant: { id: string; name: string | null; slug: string | null }
  user: { id: string; email: string | null } | null
  auth: { kind: string; key_type: string; oauth_scopes: string[] | null; expires_at: string | null }
  permissions: string[]
  resource_scopes: { workflow_ids: string[]; table_ids: string[] }
}

async function readApiKey(runtime: Runtime, value: string | true): Promise<string> {
  let key: string
  if (value === '-') key = await runtime.io.readStdin()
  else if (typeof value === 'string') key = value
  else if (runtime.io.stdinIsTTY) key = await runtime.io.promptSecret('API key: ')
  else key = await runtime.io.readStdin()
  key = key.trim()
  if (!key) throw new CliUsageError('No API key given (pass --api-key <key>, or --api-key - to read it from stdin)')
  return key
}

function clearCredentials(runtime: Runtime, profileName: string) {
  runtime.store.update((config) => {
    const target = config.profiles[profileName]
    if (target) {
      delete target.credentials
      target.updated_at = new Date().toISOString()
    }
  })
}

/** Revoke refresh (whole rotation chain) then access token. False when the server could not confirm. */
async function revokeAll(runtime: Runtime, credentials: OAuthCredentials): Promise<boolean> {
  const endpoint = credentials.revocation_endpoint
  if (!endpoint) return false
  const tokens: [string | undefined, 'refresh_token' | 'access_token'][] = [
    [credentials.refresh_token, 'refresh_token'],
    [credentials.access_token, 'access_token'],
  ]
  let ok = true
  for (const [token, hint] of tokens) {
    if (!token) continue
    try {
      await revokeToken({ revocationEndpoint: endpoint, clientId: credentials.client_id, token, tokenTypeHint: hint, fetch: runtime.io.fetch })
    } catch {
      ok = false
    }
  }
  return ok
}

function describeIdentity(me: Me): string {
  const tenant = me.tenant.name ?? me.tenant.slug ?? me.tenant.id
  const who = me.user?.email ?? (me.auth.key_type === 'tenant' ? 'tenant key' : me.user?.id ?? 'unknown user')
  return `${who} @ ${tenant}`
}

export function registerAuthCommands(program: Command, runtime: Runtime) {
  program
    .command('login')
    .description('Log in to a UserTasks server (browser login, or --api-key) and save it as a profile')
    .option('--api-key [key]', 'Log in with an API key (value, "-" for stdin, or omit to be prompted)')
    .option('--scopes <scopes>', 'OAuth scopes to request, comma or space separated (default: all except keys:write)')
    .option('--no-browser', 'Print the login URL instead of opening a browser')
    .addHelpText('after', [
      '',
      'Browser login opens the server\'s consent page and receives the result on',
      'http://127.0.0.1:<random port>/callback. It times out after 5 minutes.',
      'Tokens are saved in the profile (file mode 0600) and refreshed automatically.',
      'Add keys:write to --scopes to manage API keys from the CLI.',
      'API keys are checked with GET /api/v1/me before they are saved.',
    ].join('\n'))
    .action(async (opts: { apiKey?: string | true; scopes?: string; browser: boolean }, self: Command) => {
      const settings = runtime.settings(self)
      const url = normaliseServerUrl(runtime.requireUrl(settings))

      if (opts.apiKey !== undefined) {
        const key = await readApiKey(runtime, opts.apiKey)
        const me = await runtime.client(self, { auth: apiKeyAuth(key), url }).request<Me>('GET', '/me')
        runtime.store.update((config) => {
          config.profiles[settings.profileName] = {
            url,
            credentials: { type: 'api_key', api_key: key },
            tenant: me.tenant,
            user: me.user,
            updated_at: new Date().toISOString(),
          }
          config.current_profile = settings.profileName
        })
        runtime.info(self, `Logged in to ${url} as ${describeIdentity(me)} (profile "${settings.profileName}").`)
        return
      }

      const sameServer = settings.profile?.url && normaliseServerUrl(settings.profile.url) === url
      const io = runtime.io
      const result = await browserLogin<Me>({
        serverUrl: url,
        scopes: opts.scopes,
        savedClient: sameServer ? settings.profile?.oauth_client : undefined,
        fetch: io.fetch,
        timeoutMs: io.loginTimeoutMs,
        showUrl: (authorizeUrl) => {
          // Always shown (even with --quiet): the user may need to open it by hand.
          io.stderr.write(opts.browser
            ? `Opening your browser to log in. If it does not open, visit:\n\n  ${authorizeUrl}\n\nWaiting for the login to finish (5 minutes)...\n`
            : `Open this URL in a browser on this computer to log in:\n\n  ${authorizeUrl}\n\nWaiting for the login to finish (5 minutes)...\n`)
        },
        ...(opts.browser && io.openBrowser ? { openBrowser: (authorizeUrl: string) => io.openBrowser!(authorizeUrl) } : {}),
        verify: (tokens) => runtime.client(self, { auth: apiKeyAuth(tokens.access_token), url }).request<Me>('GET', '/me'),
      })

      const me = result.verified
      runtime.store.update((config) => {
        const previous = config.profiles[settings.profileName]
        const keepClient = previous?.url && normaliseServerUrl(previous.url) === url ? previous.oauth_client : undefined
        const oauthClient = result.registeredClient ?? keepClient
        config.profiles[settings.profileName] = {
          url,
          credentials: buildOAuthCredentials(result.clientId, result.meta, result.tokens),
          tenant: me.tenant,
          user: me.user,
          ...(oauthClient ? { oauth_client: oauthClient } : {}),
          updated_at: new Date().toISOString(),
        }
        config.current_profile = settings.profileName
      })
      runtime.info(self, `Logged in to ${url} as ${describeIdentity(me)} (profile "${settings.profileName}").`)
    })

  program
    .command('logout')
    .description('Remove the stored credential from a profile (browser logins are revoked on the server)')
    .action(async (_opts: unknown, self: Command) => {
      const settings = runtime.settings(self)
      const profile = settings.profile
      if (!profile?.credentials) {
        runtime.info(self, `Profile "${settings.profileName}" has no stored credential.`)
        return
      }
      if (profile.credentials.type === 'api_key') {
        // API keys stay valid server-side; revoke them in the app if needed.
        clearCredentials(runtime, settings.profileName)
        runtime.info(self, `Logged out of profile "${settings.profileName}" (${profile.url}). The API key itself was not revoked.`)
        return
      }

      // Under the lock so a concurrent refresh can't write tokens back after we revoke.
      const revoked = await runtime.store.withLock(async () => {
        const current = runtime.store.read().profiles[settings.profileName]?.credentials
        if (current?.type !== 'oauth') return true
        const ok = await revokeAll(runtime, current)
        clearCredentials(runtime, settings.profileName)
        return ok
      })
      runtime.info(self, revoked
        ? `Logged out of profile "${settings.profileName}" (${profile.url}); the session was revoked on the server.`
        : `Logged out of profile "${settings.profileName}" (${profile.url}), but the server could not be reached to revoke the session; revoke it in the app if needed.`)
    })

  program
    .command('whoami')
    .description('Show the tenant, user and permissions of the active credential')
    .action(async (_opts: unknown, self: Command) => {
      const settings = runtime.settings(self)
      const me = await runtime.client(self).request<Me>('GET', '/me')
      if (settings.output === 'table') {
        runtime.print(self, {
          profile: settings.apiKeySource === 'env' ? `${settings.profileName} (key from USERTASKS_API_KEY)` : settings.profileName,
          ...(settings.oauth?.refresh_token ? { session: 'browser login (refreshes automatically)' } : {}),
          url: settings.url,
          tenant: [me.tenant.name, me.tenant.slug && `(${me.tenant.slug})`].filter(Boolean).join(' ') || me.tenant.id,
          tenant_id: me.tenant.id,
          user: me.user?.email ?? me.user?.id ?? null,
          auth: `${me.auth.kind} (${me.auth.key_type})`,
          scopes: me.auth.oauth_scopes?.length ? me.auth.oauth_scopes.join(' ') : null,
          expires_at: me.auth.expires_at,
          permissions: me.permissions.length ? me.permissions : null,
        })
        return
      }
      runtime.print(self, { profile: settings.profileName, url: settings.url, ...me })
    })
}
