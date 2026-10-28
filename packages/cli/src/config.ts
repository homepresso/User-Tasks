/**
 * Profile store: `$XDG_CONFIG_HOME/usertasks/config.json`
 * (`~/.config/usertasks/config.json`; `%APPDATA%\usertasks\config.json` on
 * Windows). The directory is created 0700 and the file written 0600 via a
 * temp file + rename, so a crash never leaves a truncated config and the
 * secret is never readable by other users, even briefly.
 *
 * `withLock()` serialises OAuth refreshes across processes with a lock file
 * next to the config (`config.json.lock`, created with O_EXCL): the server
 * revokes the whole session if a rotated refresh token is presented twice.
 */

import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { open, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface ApiKeyCredentials {
  type: 'api_key'
  api_key: string
}

/** Browser-login tokens. Expiry is ISO 8601; endpoints come from discovery at login. */
export interface OAuthCredentials {
  type: 'oauth'
  client_id: string
  access_token: string
  refresh_token?: string
  expires_at?: string
  scope?: string
  token_endpoint: string
  revocation_endpoint?: string
}

export type Credentials = ApiKeyCredentials | OAuthCredentials

export interface Profile {
  /** Server origin, e.g. `https://tasks.example.com`. */
  url: string
  credentials?: Credentials
  tenant?: { id: string; name: string | null; slug: string | null }
  user?: { id: string; email: string | null } | null
  /**
   * Client registered via dynamic registration on servers without the
   * first-party CLI client; reused while its loopback port is free.
   */
  oauth_client?: { client_id: string; redirect_uri: string }
  updated_at?: string
}

export interface ConfigFile {
  version: 1
  current_profile?: string
  profiles: Record<string, Profile>
}

export const DEFAULT_PROFILE = 'default'

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'usertasks', 'config.json')
  const base = env.XDG_CONFIG_HOME?.trim() || join(home, '.config')
  return join(base, 'usertasks', 'config.json')
}

function emptyConfig(): ConfigFile {
  return { version: 1, profiles: {} }
}

export class ConfigStore {
  constructor(readonly path: string) {}

  read(): ConfigFile {
    let text: string
    try {
      text = readFileSync(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig()
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Config file ${this.path} is not valid JSON; fix or delete it.`)
    }
    const config = parsed as Partial<ConfigFile>
    return {
      version: 1,
      ...(typeof config.current_profile === 'string' ? { current_profile: config.current_profile } : {}),
      profiles: config.profiles && typeof config.profiles === 'object' ? config.profiles : {},
    }
  }

  write(config: ConfigFile): void {
    const dir = dirname(this.path)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)

    const temp = join(dir, `.config.json.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
    const fd = openSync(temp, 'wx', 0o600)
    try {
      writeSync(fd, `${JSON.stringify(config, null, 2)}\n`)
      fsyncSync(fd)
    } catch (error) {
      closeSync(fd)
      unlinkSync(temp)
      throw error
    }
    closeSync(fd)
    try {
      chmodSync(temp, 0o600)
      renameSync(temp, this.path)
    } catch (error) {
      try {
        unlinkSync(temp)
      } catch {
        // already gone
      }
      throw error
    }
  }

  get lockPath(): string {
    return `${this.path}.lock`
  }

  /**
   * Run `fn` holding the config lock. A lock older than `staleMs` (a crashed
   * process) is broken; waiting longer than `timeoutMs` fails. Callers must
   * re-read the config inside `fn`.
   */
  async withLock<T>(fn: () => Promise<T>, options: { staleMs?: number; timeoutMs?: number; pollMs?: number } = {}): Promise<T> {
    const staleMs = options.staleMs ?? 60_000 // > the SDK's 30 s OAuth request timeout
    const timeoutMs = options.timeoutMs ?? 60_000
    const pollMs = options.pollMs ?? 50
    const dir = dirname(this.path)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const started = Date.now()
    for (;;) {
      try {
        const handle = await open(this.lockPath, 'wx', 0o600)
        try {
          await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`)
        } finally {
          await handle.close()
        }
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      try {
        const info = await stat(this.lockPath)
        if (Date.now() - info.mtimeMs > staleMs) {
          await unlink(this.lockPath).catch(() => {})
          continue
        }
      } catch {
        continue // released between open() and stat()
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for ${this.lockPath}; delete it if no other usertasks process is running.`)
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs + Math.random() * pollMs))
    }
    try {
      return await fn()
    } finally {
      await unlink(this.lockPath).catch(() => {})
    }
  }

  update(mutate: (config: ConfigFile) => void): ConfigFile {
    const config = this.read()
    mutate(config)
    this.write(config)
    return config
  }
}
