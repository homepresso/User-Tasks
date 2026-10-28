/**
 * Resolve the effective profile, server, credential and output format.
 *
 * Precedence (highest first): command-line flags → environment
 * (USERTASKS_PROFILE / USERTASKS_URL / USERTASKS_API_KEY / USERTASKS_OUTPUT)
 * → the selected profile in the config file → defaults.
 *
 * A profile's stored credential (API key or browser-login tokens) is only
 * used when the effective server is the profile's own server, so `--url` can
 * never send it somewhere else. USERTASKS_API_KEY beats stored OAuth tokens.
 */

import { CliUsageError } from './exit-codes'
import { DEFAULT_PROFILE, type ConfigFile, type OAuthCredentials, type Profile } from './config'

export type OutputFormat = 'table' | 'json' | 'yaml'
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['table', 'json', 'yaml']

export interface GlobalFlags {
  profile?: string
  url?: string
  output?: string
  file?: string
  all?: boolean
  limit?: string
  offset?: string
  yes?: boolean
  quiet?: boolean
  debug?: boolean
}

export interface ResolvedSettings {
  profileName: string
  /** Whether the profile was chosen explicitly (flag or env) rather than by default. */
  profileExplicit: boolean
  profile?: Profile
  /** Server origin without trailing slash or /api/v1, if known. */
  url?: string
  apiKey?: string
  apiKeySource?: 'env' | 'profile'
  /** Browser-login tokens of the profile (only when no API key applies). */
  oauth?: OAuthCredentials
  output: OutputFormat
}

/** `https://host/api/v1/` → `https://host`. Throws a usage error for non-http(s) values. */
export function normaliseServerUrl(input: string): string {
  const trimmed = input.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new CliUsageError(`Invalid server URL: ${input}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new CliUsageError(`Server URL must be http(s): ${input}`)
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '')
  return `${url.origin}${path}`
}

export function parseOutputFormat(value: string): OutputFormat {
  const lower = value.trim().toLowerCase()
  // `text` (used by `logs tail -o text`) is the human-readable format.
  if (lower === 'text') return 'table'
  if (!(OUTPUT_FORMATS as readonly string[]).includes(lower)) {
    throw new CliUsageError(`Unknown output format "${value}" (expected ${OUTPUT_FORMATS.join(', ')})`)
  }
  return lower as OutputFormat
}

const nonEmpty = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined)

export function resolveSettings(input: { flags: GlobalFlags; env: NodeJS.ProcessEnv; config: ConfigFile; stdoutIsTTY: boolean }): ResolvedSettings {
  const { flags, env, config } = input
  const explicitProfile = nonEmpty(flags.profile) ?? nonEmpty(env.USERTASKS_PROFILE)
  const profileName = explicitProfile ?? config.current_profile ?? DEFAULT_PROFILE
  const profile = config.profiles[profileName]

  const rawUrl = nonEmpty(flags.url) ?? nonEmpty(env.USERTASKS_URL) ?? profile?.url
  const url = rawUrl ? normaliseServerUrl(rawUrl) : undefined

  const envKey = nonEmpty(env.USERTASKS_API_KEY)
  const profileUrl = profile?.url ? normaliseServerUrl(profile.url) : undefined
  const sameServer = Boolean(url && url === profileUrl)
  const profileKey = profile?.credentials?.type === 'api_key' && sameServer ? profile.credentials.api_key : undefined
  const oauth = !envKey && profile?.credentials?.type === 'oauth' && sameServer ? profile.credentials : undefined

  const rawOutput = nonEmpty(flags.output) ?? nonEmpty(env.USERTASKS_OUTPUT)
  const output = rawOutput ? parseOutputFormat(rawOutput) : input.stdoutIsTTY ? 'table' : 'json'

  return {
    profileName,
    profileExplicit: Boolean(explicitProfile),
    profile,
    url,
    ...(envKey ? { apiKey: envKey, apiKeySource: 'env' as const } : profileKey ? { apiKey: profileKey, apiKeySource: 'profile' as const } : {}),
    ...(oauth ? { oauth } : {}),
    output,
  }
}
