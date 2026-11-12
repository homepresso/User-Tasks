import fs from 'node:fs'
import path from 'node:path'

/**
 * `.env.local` / `.env` for `npm run bootstrap` and `usertasks-admin
 * bootstrap | setup-code` run from a source checkout, so the same command
 * works in PowerShell, cmd, bash and zsh (no `set -a; . ./.env.local`).
 *
 * Variables already set in the environment always win (as with Next.js and
 * `node --env-file`). Only these two commands load it: `db migrate` and the
 * switch commands keep requiring an explicit DATABASE_URL, so a checkout's
 * .env.local can't silently point them at another database.
 */

export const LOCAL_ENV_FILES = ['.env.local', '.env'] as const

/** KEY=value lines (export prefix, quotes, comments). Pure. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(lines[i])
    if (!match) continue
    const [, key] = match
    let value = match[2]
    const quote = value[0]
    if (quote === '"' || quote === "'" || quote === '`') {
      // Quoted: may span lines until the closing quote.
      let body = value.slice(1)
      while (!body.includes(quote) && i + 1 < lines.length) body += `\n${lines[++i]}`
      const end = body.indexOf(quote)
      value = end >= 0 ? body.slice(0, end) : body
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }
    out[key] = value
  }
  return out
}

/** Load the files in `dir` into `env` without overriding anything set. Returns the files loaded. */
export function loadLocalEnv(dir: string = process.cwd(), env: Record<string, string | undefined> = process.env): string[] {
  const loaded: string[] = []
  for (const name of LOCAL_ENV_FILES) {
    const file = path.join(dir, name)
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const [key, value] of Object.entries(parseEnvFile(text))) {
      if (env[key] === undefined) env[key] = value
    }
    loaded.push(name)
  }
  return loaded
}

/** The provider variables bootstrap / setup-code need that are missing, for the configured providers. */
export function missingProviderEnv(env: Record<string, string | undefined>): string[] {
  const has = (...names: string[]) => names.some((n) => Boolean(env[n]?.trim()))
  const missing: string[] = []
  const db = env.DB_PROVIDER?.trim().toLowerCase() || 'supabase'
  const auth = env.AUTH_PROVIDER?.trim().toLowerCase() || 'supabase'
  if (db === 'postgres') {
    if (!has('DATABASE_URL')) missing.push('DATABASE_URL')
  } else {
    if (!has('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL')) missing.push('NEXT_PUBLIC_SUPABASE_URL')
    if (!has('SUPABASE_SERVICE_ROLE_KEY')) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  }
  if (auth === 'supabase' && db === 'postgres') {
    if (!has('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL')) missing.push('NEXT_PUBLIC_SUPABASE_URL')
    if (!has('SUPABASE_SERVICE_ROLE_KEY')) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  }
  return missing
}

/** The friendly explanation when the environment isn't there (wrong folder, no .env.local). */
export function missingEnvMessage(missing: string[], dir: string, loaded: string[]): string {
  const lines = [`Missing environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`]
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    lines.push(`Run this from the UserTasks folder (the one with package.json); this folder is ${dir}.`)
  } else if (!loaded.length) {
    lines.push(`No .env.local in ${dir}: create one (see .env.example), or set the variables in your shell.`)
  } else {
    lines.push(`Add ${missing.length === 1 ? 'it' : 'them'} to ${loaded.join(' or ')} in ${dir}, or set ${missing.length === 1 ? 'it' : 'them'} in your shell.`)
  }
  lines.push('Supabase-free installs: set DB_PROVIDER=postgres, DATABASE_URL and AUTH_PROVIDER=builtin.')
  return lines.join('\n')
}
