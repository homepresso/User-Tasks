import pg from 'pg'
import { pgConnectionConfig } from '@/lib/providers/db/pg-auth'

/**
 * A PostgreSQL connection given as switch / install flags (a URL, or host /
 * port / database / user / password, TLS mode and CA, token auth): used by
 * the install profile checks (lib/install/checks.ts) and the Infrastructure
 * add-on's database switch.
 */

export interface TargetConnection {
  url: string
  auth: string | null
  sslmode: string | null
  ca: string | null
}

const flag = (flags: Record<string, unknown>, name: string): string | null => {
  const value = flags[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** --target-url, or the URL built from --target-host / -port / -database / -user / -password. */
export function targetConnectionFrom(flags: Record<string, unknown>): TargetConnection | null {
  let url = flag(flags, 'target-url')
  if (!url) {
    const host = flag(flags, 'target-host')
    const database = flag(flags, 'target-database')
    const user = flag(flags, 'target-user')
    if (!host || !database || !user) return null
    const u = new URL('postgres://placeholder')
    u.hostname = host
    u.port = flag(flags, 'target-port') ?? '5432'
    u.pathname = `/${encodeURIComponent(database)}`
    u.username = encodeURIComponent(user)
    const password = flag(flags, 'target-password')
    if (password) u.password = encodeURIComponent(password)
    url = u.toString()
  }
  const sslmode = flag(flags, 'target-sslmode')
  if (sslmode && !/[?&]sslmode=/.test(url)) url += `${url.includes('?') ? '&' : '?'}sslmode=${encodeURIComponent(sslmode)}`
  return { url, auth: flag(flags, 'target-auth'), sslmode, ca: flag(flags, 'target-ca') }
}

export function targetClientConfig(target: TargetConnection, application = 'usertasks-admin-target'): pg.ClientConfig {
  // The app's own DATABASE_AUTH / DATABASE_SSL_CA_FILE describe the source: the target gets its own.
  // aws (RDS IAM) takes its region from DATABASE_AWS_REGION / the host name / AWS_REGION and the
  // shipped RDS CA bundle, exactly like DATABASE_AUTH=aws (lib/providers/db/pg-auth).
  const caFile = target.ca && !target.ca.includes('-----BEGIN') ? target.ca : undefined
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_AUTH: target.auth && target.auth !== 'password' ? target.auth : undefined,
    DATABASE_SSL_CA_FILE: caFile,
  }
  const config = pgConnectionConfig(target.url, { application_name: application, connectionTimeoutMillis: 15_000 }, env) as pg.ClientConfig
  if (target.ca && !caFile) {
    // A CA given as PEM text: pg's connection-string ssl handling would replace an explicit ssl object, so set it here.
    config.ssl = { ca: target.ca, rejectUnauthorized: target.sslmode !== 'require' && target.sslmode !== 'prefer' }
  }
  return config
}

export async function connectTarget(target: TargetConnection, application?: string): Promise<pg.Client> {
  const client = new pg.Client(targetClientConfig(target, application))
  client.on('error', () => undefined)
  await client.connect()
  // Same text forms on both sides (checksums, json round trips).
  await client.query(`SET TIME ZONE 'UTC'; SET DateStyle = 'ISO, YMD'; SET extra_float_digits = 3; SET IntervalStyle = 'postgres'`)
  return client
}

