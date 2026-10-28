import { describe, expect, it } from 'vitest'
import { fkOrder, targetConnectionFrom, targetPrivileges } from '@/lib/admin/switch/db-copy'
import type { SqlClient } from '@/lib/admin/ops/instance-db'

/**
 * The database switch's target connection and privilege report
 * (lib/admin/switch/db-copy) without a server: the URL built from parts
 * (credentials encoded, TLS mode added), the one-time DBA SQL for a role
 * that owns nothing and may create no roles, and the foreign-key order.
 * The copy itself is exercised against PostgreSQL in
 * packages/admin/test/db-switch-auto.test.ts.
 */

function fake(answers: Array<[RegExp, Array<Record<string, unknown>>]>): SqlClient {
  return {
    async query(text: string) {
      const sql = text.replace(/\s+/g, ' ')
      if (/session_replication_role/.test(sql)) throw new Error('permission denied to set parameter "session_replication_role"')
      for (const [re, rows] of answers) if (re.test(sql)) return { rows: rows as never }
      throw new Error(`unexpected query: ${sql}`)
    },
  }
}

describe('database switch target', () => {
  it('builds the URL from host / port / database / user / password, with the TLS mode', () => {
    const conn = targetConnectionFrom({ 'target-host': 'db.internal', 'target-database': 'ut prod', 'target-user': 'app@x', 'target-password': 'p@ss:w/rd', 'target-sslmode': 'verify-full', 'target-auth': 'azure' })!
    const url = new URL(conn.url)
    expect(url.hostname).toBe('db.internal')
    expect(url.port).toBe('5432')
    expect(decodeURIComponent(url.pathname.slice(1))).toBe('ut prod')
    expect(decodeURIComponent(url.username)).toBe('app@x')
    expect(decodeURIComponent(url.password)).toBe('p@ss:w/rd')
    expect(url.searchParams.get('sslmode')).toBe('verify-full')
    expect(conn.auth).toBe('azure')
    expect(targetConnectionFrom({ 'target-host': 'db' })).toBeNull()
    expect(targetConnectionFrom({ 'target-url': 'postgres://u@h/d?sslmode=require', 'target-sslmode': 'disable' })!.url).toBe('postgres://u@h/d?sslmode=require')
  })

  it('a role that owns nothing and may create no roles gets the exact DBA SQL', async () => {
    const db = fake([
      [/AS owns_public/, [{ user: 'app', db: 'ut', superuser: false, createrole: false, create_db: false, owns_public: false, owner: 'postgres' }]],
      [/FROM pg_roles r WHERE r.rolname = ANY/, []],
      [/FROM pg_available_extensions/, [{ name: 'pgcrypto', installed: null, trusted: true }, { name: 'pg_trgm', installed: null, trusted: false }]],
    ])
    const report = await targetPrivileges(db)
    expect(report.replicaMode).toBe(false)
    expect(report.checks.filter((c) => c.severity === 'error').map((c) => c.name)).toEqual(['database owner', 'roles'])
    expect(report.dbaSql).toEqual([
      '-- Run once as a superuser / admin role, connected to ut; then test the connection again.',
      'ALTER DATABASE "ut" OWNER TO "app";',
      'CREATE ROLE "anon" NOLOGIN NOINHERIT;',
      'CREATE ROLE "authenticated" NOLOGIN NOINHERIT;',
      'CREATE ROLE "service_role" NOLOGIN NOINHERIT BYPASSRLS;',
      'CREATE ROLE "authenticator" NOLOGIN NOINHERIT;',
      'GRANT anon, authenticated, service_role TO authenticator;',
      'GRANT anon, authenticated, service_role TO "app";',
      'CREATE EXTENSION IF NOT EXISTS pg_trgm;',
    ])
  })

  it('orders parents before children', async () => {
    const db = fake([[/contype = 'f'/, [{ child: 'public.tasks', parent: 'public.tenants' }, { child: 'public.comments', parent: 'public.tasks' }, { child: 'public.tasks', parent: 'public.tasks' }]]])
    const t = (name: string) => ({ schema: 'public', name, columns: ['id'] })
    const order = await fkOrder(db, [t('comments'), t('tasks'), t('tenants')])
    expect(order.map((x) => x.name)).toEqual(['tenants', 'tasks', 'comments'])
  })
})

describe('database switch target auth', () => {
  it('--target-auth aws signs RDS IAM tokens for the target endpoint (region from the host), independent of the app DATABASE_AUTH', async () => {
    const { targetClientConfig } = await import('@/lib/admin/switch/db-copy')
    const prev = process.env.DATABASE_AUTH
    process.env.DATABASE_AUTH = 'azure'
    try {
      const config = targetClientConfig({ url: 'postgres://app@ut.cluster-abc.eu-west-1.rds.amazonaws.com:5432/ut', auth: 'aws', sslmode: null, ca: null })
      expect(config.host).toBe('ut.cluster-abc.eu-west-1.rds.amazonaws.com')
      expect(config.user).toBe('app')
      expect(typeof config.password).toBe('function')
      expect(config.ssl).toBeTruthy()
      const plain = targetClientConfig({ url: 'postgres://u:p@h/d', auth: null, sslmode: null, ca: null })
      expect(plain).toMatchObject({ connectionString: 'postgres://u:p@h/d' })
    } finally {
      if (prev === undefined) delete process.env.DATABASE_AUTH
      else process.env.DATABASE_AUTH = prev
    }
  })
})
