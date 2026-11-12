/**
 * The `.env.local` half of `npm run setup:local` (scripts/setup-local.ts):
 * pure functions, so the rules are unit-tested without touching a real file
 * (__tests__/setup-local-env.test.ts).
 *
 * Rules:
 * - No .env.local yet: start from .env.example and fill in the Supabase URL
 *   and keys (from `supabase status -o env`), a fresh ENCRYPTION_KEY and
 *   CRON_SECRET, DEPLOYMENT_MODE=self_hosted and the localhost app URL.
 * - .env.local exists: only empty or missing values are filled. A value that
 *   is already there is kept; when it differs from the local Supabase, that
 *   is reported. `--force` replaces the Supabase URL and keys (nothing else).
 * - ENCRYPTION_KEY and CRON_SECRET are never replaced once set, not even with
 *   --force: a new ENCRYPTION_KEY makes every stored secret unreadable.
 * - The line endings of the file are kept (CRLF on a Windows checkout).
 * - Reports name variables only, never values.
 */
import { randomBytes } from 'node:crypto'
import { parseEnvFile } from '../../packages/admin/src/local-env'

/** What `supabase status -o env` printed, parsed. */
export type SupabaseStatus = Record<string, string>

export interface LocalSupabaseKeys {
  url: string
  anonKey: string
  serviceRoleKey: string
  dbUrl?: string
}

/**
 * The keys the app needs from `supabase status -o env` (Supabase CLI 2.x and
 * 3.x print API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL; PUBLISHABLE_KEY /
 * SECRET_KEY are the newer names, used only when the legacy ones are gone).
 * Null when the output doesn't have them (the stack isn't running).
 */
export function supabaseKeysFromStatus(status: SupabaseStatus): LocalSupabaseKeys | null {
  const url = status.API_URL?.trim()
  const anonKey = (status.ANON_KEY || status.PUBLISHABLE_KEY)?.trim()
  const serviceRoleKey = (status.SERVICE_ROLE_KEY || status.SECRET_KEY)?.trim()
  if (!url || !anonKey || !serviceRoleKey) return null
  return { url, anonKey, serviceRoleKey, dbUrl: status.DB_URL?.trim() || undefined }
}

/** Parses `supabase status -o env` output (KEY="value" lines, CRLF tolerated). */
export function parseSupabaseStatus(output: string): SupabaseStatus {
  return parseEnvFile(output)
}

/** 32 random bytes, base64 (44 characters): the format lib/secret-crypto.ts expects. */
export function generateEncryptionKey(random: (n: number) => Buffer = randomBytes): string {
  return random(32).toString('base64')
}

/** 32 random bytes, hex (64 characters), like `openssl rand -hex 32`. */
export function generateCronSecret(random: (n: number) => Buffer = randomBytes): string {
  return random(32).toString('hex')
}

/** True when `value` is a usable ENCRYPTION_KEY (32 bytes as hex or base64). */
export function isValidEncryptionKey(value: string): boolean {
  const raw = value.trim()
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return true
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return false
  return Buffer.from(raw, 'base64').length === 32
}

export interface PlanEnvInput {
  /** .env.example. */
  template: string
  /** The current .env.local, or null when there isn't one. */
  existing: string | null
  supabase: LocalSupabaseKeys
  /** Replace the Supabase URL and keys even when they're already set. */
  force?: boolean
  appUrl?: string
  random?: (n: number) => Buffer
}

export interface EnvPlan {
  /** The file to write. */
  text: string
  /** True when `text` differs from `existing` (or there was no file). */
  changed: boolean
  created: boolean
  /** Variables given a value from the local Supabase or a default. */
  filled: string[]
  /** Variables given a newly generated secret. */
  generated: string[]
  /** Variables replaced because of --force. */
  replaced: string[]
  /** Plain-English notes: values kept that differ from the local stack, bad formats. */
  warnings: string[]
  /** The values the file ends up with, for the managed variables. */
  values: Record<string, string>
}

type Source = 'supabase' | 'default' | 'secret'

interface Managed {
  key: string
  source: Source
  value: string
}

const LOCAL_HOSTS = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i

/** Builds the new .env.local. Pure: nothing is read or written. */
export function planEnvFile(input: PlanEnvInput): EnvPlan {
  const random = input.random ?? randomBytes
  const appUrl = input.appUrl ?? 'http://localhost:3000'
  const created = input.existing === null
  const base = input.existing ?? input.template
  const eol = base.includes('\r\n') ? '\r\n' : '\n'
  const lines = base.replace(/\r\n/g, '\n').split('\n')

  const managed: Managed[] = [
    { key: 'NEXT_PUBLIC_SUPABASE_URL', source: 'supabase', value: input.supabase.url },
    { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', source: 'supabase', value: input.supabase.anonKey },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', source: 'supabase', value: input.supabase.serviceRoleKey },
    { key: 'NEXT_PUBLIC_APP_URL', source: 'default', value: appUrl },
    { key: 'DEPLOYMENT_MODE', source: 'default', value: 'self_hosted' },
    { key: 'ENCRYPTION_KEY', source: 'secret', value: '' },
    { key: 'CRON_SECRET', source: 'secret', value: '' },
  ]

  const filled: string[] = []
  const generated: string[] = []
  const replaced: string[] = []
  const warnings: string[] = []
  const values: Record<string, string> = {}
  const current = parseEnvFile(base)

  const fresh = (item: Managed): string => {
    if (item.source !== 'secret') return item.value
    return item.key === 'ENCRYPTION_KEY' ? generateEncryptionKey(random) : generateCronSecret(random)
  }

  for (const item of managed) {
    // The active line: the last uncommented KEY= line (later lines win, as in dotenv).
    let index = -1
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`^\\s*(?:export\\s+)?${item.key}\\s*=`).test(lines[i])) index = i
    }
    const existingValue = index >= 0 ? (current[item.key] ?? '').trim() : ''
    let next: string | null = null

    if (!existingValue) {
      next = fresh(item)
      ;(item.source === 'secret' ? generated : filled).push(item.key)
    } else if (item.source === 'supabase' && existingValue !== item.value) {
      if (created || input.force) {
        // A new file always takes the running stack's values (.env.example has the default URL).
        next = item.value
        ;(created ? filled : replaced).push(item.key)
      } else if (item.key === 'NEXT_PUBLIC_SUPABASE_URL') {
        warnings.push(
          LOCAL_HOSTS.test(existingValue)
            ? `${item.key} in .env.local (${existingValue}) isn't the local Supabase (${item.value}). Kept it; run again with --force to point .env.local at the local Supabase.`
            : `.env.local points at another Supabase (${hostOf(existingValue)}), not the local one. Kept it; run again with --force to use the local Supabase instead.`,
        )
      } else {
        warnings.push(`${item.key} in .env.local doesn't match the local Supabase. Kept it; run again with --force to replace it.`)
      }
    } else if (item.key === 'ENCRYPTION_KEY' && !isValidEncryptionKey(existingValue) && !existingValue.startsWith('secret://')) {
      warnings.push('ENCRYPTION_KEY in .env.local is not 32 bytes of base64 or hex. Kept it (changing it would make stored secrets unreadable); fix it by hand if the app complains.')
    }

    if (next === null) {
      values[item.key] = existingValue
      continue
    }
    values[item.key] = next
    const line = `${item.key}=${next}`
    if (index >= 0) lines[index] = line
    else {
      // Not in the file (or only commented out): add it at the end.
      while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
      if (!lines.some((l) => l === ADDED_HEADER)) lines.push('', ADDED_HEADER)
      lines.push(line, '')
    }
  }

  // Runtime-only names win over NEXT_PUBLIC_*: say so when they point elsewhere.
  for (const [override, key] of [['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'], ['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'], ['APP_URL', 'NEXT_PUBLIC_APP_URL']] as const) {
    const value = current[override]?.trim()
    if (value && value !== values[key]) warnings.push(`${override} is set in .env.local and takes precedence over ${key}. Remove it (or make it match) to use the value setup wrote.`)
  }

  let text = lines.join(eol)
  if (!text.endsWith(eol)) text += eol
  return { text, changed: created || text !== input.existing, created, filled, generated, replaced, warnings, values }
}

const ADDED_HEADER = '# ── Added by npm run setup:local ─────────────────────────────────────────'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'an address that is not a URL'
  }
}

/** True when the URL is the local machine (the only case setup touches the database). */
export function isLocalUrl(url: string | undefined): boolean {
  return Boolean(url && LOCAL_HOSTS.test(url.trim()))
}

/** One-line summary of a plan, naming variables only. */
export function describePlan(plan: EnvPlan): string[] {
  const out: string[] = []
  if (plan.created) out.push('Created .env.local from .env.example.')
  else if (!plan.changed) out.push('.env.local already has everything it needs; left it as it was.')
  else out.push('Updated .env.local (only the values that were missing).')
  if (plan.filled.length) out.push(`  Filled in: ${plan.filled.join(', ')}`)
  if (plan.generated.length) out.push(`  Generated new secrets: ${plan.generated.join(', ')} (not shown here; they're in .env.local)`)
  if (plan.replaced.length) out.push(`  Replaced (--force): ${plan.replaced.join(', ')}`)
  return out
}
