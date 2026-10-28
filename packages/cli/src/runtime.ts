/** Per-invocation services shared by every command. */

import type { Command } from 'commander'
import { UsertasksClient, apiKeyAuth, oauthAuth, type TokenProvider } from '@usertasks/sdk'
import { ConfigStore, defaultConfigPath } from './config'
import { CliAuthError, CliUsageError } from './exit-codes'
import type { Io } from './io'
import { profileTokenStore } from './oauth'
import { render } from './output'
import { resolveSettings, type GlobalFlags, type ResolvedSettings } from './settings'

export const CLI_VERSION = '0.1.0'

export class Runtime {
  readonly store: ConfigStore

  constructor(readonly io: Io) {
    this.store = new ConfigStore(io.configPath ?? defaultConfigPath(io.env))
  }

  flags(command: Command): GlobalFlags {
    return command.optsWithGlobals() as GlobalFlags
  }

  settings(command: Command): ResolvedSettings {
    return resolveSettings({
      flags: this.flags(command),
      env: this.io.env,
      config: this.store.read(),
      stdoutIsTTY: Boolean(this.io.stdout.isTTY),
    })
  }

  requireUrl(settings: ResolvedSettings): string {
    if (!settings.url) {
      throw new CliUsageError(`No server URL for profile "${settings.profileName}". Pass --url <server>, set USERTASKS_URL, or run \`usertasks login --url <server>\`.`)
    }
    return settings.url
  }

  /** Client for the resolved server; `auth` overrides the resolved credential. */
  client(command: Command, options: { auth?: TokenProvider; url?: string; timeoutMs?: number } = {}): UsertasksClient {
    const settings = this.settings(command)
    const url = options.url ?? this.requireUrl(settings)
    let auth = options.auth
    if (!auth) {
      if (settings.apiKey) {
        auth = apiKeyAuth(settings.apiKey)
      } else if (settings.oauth) {
        auth = oauthAuth({
          store: profileTokenStore(this.store, settings.profileName),
          clientId: settings.oauth.client_id,
          tokenUrl: settings.oauth.token_endpoint,
          ...(this.io.fetch ? { fetch: this.io.fetch } : {}),
        })
      } else {
        throw new CliAuthError(`Not logged in to ${url} (profile "${settings.profileName}"). Run \`usertasks login\` (or \`usertasks login --api-key\`), or set USERTASKS_API_KEY.`)
      }
    }
    const debug = this.flags(command).debug
    return new UsertasksClient({
      baseUrl: url,
      auth,
      fetch: this.io.fetch,
      userAgent: `usertasks-cli/${CLI_VERSION}`,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(debug ? { debug: (message: string) => this.io.stderr.write(`debug: ${message}\n`) } : {}),
    })
  }

  print(command: Command, value: unknown, options: { listKey?: string } = {}) {
    const text = render(value, this.settings(command).output, options)
    if (text) this.io.stdout.write(`${text}\n`)
  }

  /** Informational message on stderr (suppressed by --quiet). */
  info(command: Command, message: string) {
    if (!this.flags(command).quiet) this.io.stderr.write(`${message}\n`)
  }

  /**
   * Confirm a destructive action. Skipped (proceeds) with --yes or when stdin
   * is not a terminal, so scripts and CI never hang on a prompt.
   */
  async confirm(command: Command, question: string): Promise<boolean> {
    if (this.flags(command).yes || !this.io.stdinIsTTY) return true
    return this.io.confirm(question)
  }
}
