import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Upgrades never remove anything people built (docs: Self-hosting → Upgrade
 * to a new release). Every migration after the pre-release clean-ups must be
 * additive: no statement that runs while the migration is applied may drop a
 * table, column or schema, or delete / truncate rows.
 *
 * What counts as "runs while applied": top-level statements and DO blocks
 * (including EXECUTE strings inside them). Bodies of CREATE FUNCTION /
 * PROCEDURE are skipped: they run later (housekeeping, triggers) and are
 * reviewed as code. Temporary tables (pg_temp) are fine.
 *
 * A statement that really must remove something needs a reviewed marker on
 * one of the three lines above it, with the reason:
 *
 *   -- migration-safety: reviewed — <why no user data is lost>
 *
 * and the release notes must say so.
 */

const DIR = join(process.cwd(), 'supabase/migrations')
/** The last pre-release migration that removed something (retired features / unused legacy table). */
const LAST_PRE_RELEASE_REMOVAL = '20261029000000'

const MARKER = /--\s*migration-safety:\s*reviewed\b\s*\S/i

const RULES: Array<{ name: string; re: RegExp }> = [
  { name: 'DROP TABLE', re: /\bdrop\s+table\b(?!\s+(?:if\s+exists\s+)?pg_temp\.)/i },
  { name: 'DROP COLUMN', re: /\bdrop\s+column\b/i },
  { name: 'DROP SCHEMA', re: /\bdrop\s+schema\b/i },
  { name: 'DROP MATERIALIZED VIEW', re: /\bdrop\s+materialized\s+view\b/i },
  { name: 'TRUNCATE', re: /(?:^|[;\s'(])truncate\s+(?:table\s+)?(?!on\b)[a-z_"]/i },
  { name: 'DELETE FROM', re: /\bdelete\s+from\b/i },
]

/** Replace a span with spaces, keeping newlines so line numbers stay right. */
const blank = (s: string) => s.replace(/[^\n]/g, ' ')

/**
 * The SQL that runs while the migration is applied: comments removed, and
 * dollar-quoted bodies of CREATE FUNCTION / PROCEDURE blanked out. DO blocks
 * and ordinary strings stay (EXECUTE 'DELETE …' inside a DO block runs now).
 */
export function executedSql(sql: string): string {
  let out = ''
  let i = 0
  let statementStart = 0
  while (i < sql.length) {
    const rest = sql.slice(i)
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      out += blank(sql.slice(i, stop))
      i = stop
      continue
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2
      out += blank(sql.slice(i, stop))
      i = stop
      continue
    }
    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue }
        if (sql[j] === "'") break
        j++
      }
      out += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    const tag = /^\$([a-z_][a-z0-9_]*)?\$/i.exec(rest)
    if (tag) {
      const end = sql.indexOf(tag[0], i + tag[0].length)
      const stop = end === -1 ? sql.length : end + tag[0].length
      const head = out.slice(statementStart)
      const isRoutineBody = /\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(head)
      const body = sql.slice(i, stop)
      out += isRoutineBody ? blank(body) : body
      i = stop
      continue
    }
    if (sql[i] === ';') statementStart = out.length + 1
    out += sql[i]
    i++
  }
  return out
}

export function removals(sql: string): Array<{ line: number; rule: string; text: string }> {
  const executed = executedSql(sql).split('\n')
  const original = sql.split('\n')
  const found: Array<{ line: number; rule: string; text: string }> = []
  executed.forEach((line, n) => {
    for (const rule of RULES) {
      if (!rule.re.test(line)) continue
      const above = original.slice(Math.max(0, n - 3), n + 1)
      if (above.some((l) => MARKER.test(l))) continue
      found.push({ line: n + 1, rule: rule.name, text: original[n].trim() })
    }
  })
  return found
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()

describe('migration safety: upgrades never remove user data', () => {
  it('finds the migrations', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.startsWith(LAST_PRE_RELEASE_REMOVAL))).toBe(true)
  })

  it('every migration after the pre-release clean-ups is additive', () => {
    const problems: string[] = []
    for (const file of files.filter((f) => f.slice(0, 14) > LAST_PRE_RELEASE_REMOVAL)) {
      for (const r of removals(readFileSync(join(DIR, file), 'utf8'))) {
        problems.push(`${file}:${r.line} ${r.rule}: ${r.text}`)
      }
    }
    expect(problems, 'Migrations must not remove data. If one really must, add "-- migration-safety: reviewed — <reason>" above the statement and say so in the release notes.\n' + problems.join('\n')).toEqual([])
  })

  it('the check catches removals that run at upgrade time', () => {
    expect(removals('DROP TABLE public.tasks;').map((r) => r.rule)).toEqual(['DROP TABLE'])
    expect(removals('ALTER TABLE public.tasks DROP COLUMN title;').map((r) => r.rule)).toEqual(['DROP COLUMN'])
    expect(removals('TRUNCATE public.tasks;').map((r) => r.rule)).toEqual(['TRUNCATE'])
    expect(removals('DELETE FROM public.tasks WHERE true;').map((r) => r.rule)).toEqual(['DELETE FROM'])
    expect(removals("DO $$ BEGIN EXECUTE 'DELETE FROM public.notifications'; END $$;").map((r) => r.rule)).toEqual(['DELETE FROM'])
    expect(removals('DROP SCHEMA app_old CASCADE;').map((r) => r.rule)).toEqual(['DROP SCHEMA'])
  })

  it('allows routine bodies, temp tables, privileges, comments and reviewed statements', () => {
    expect(removals(`CREATE OR REPLACE FUNCTION public.purge() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  DELETE FROM public.event_stream WHERE created_at < now() - interval '7 days';
END $fn$;`)).toEqual([])
    expect(removals('drop table if exists pg_temp._theme_refresh;')).toEqual([])
    expect(removals('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.agents FROM anon, authenticated;')).toEqual([])
    expect(removals('GRANT SELECT, DELETE ON public.agents TO service_role;')).toEqual([])
    expect(removals('-- we never DROP TABLE here\nSELECT 1;')).toEqual([])
    expect(removals('DROP POLICY IF EXISTS p ON public.tasks;\nDROP INDEX IF EXISTS i;\nDROP FUNCTION IF EXISTS f();\nDROP TRIGGER IF EXISTS t ON public.tasks;')).toEqual([])
    expect(removals('-- migration-safety: reviewed — empty cache table, rebuilt on first use\nTRUNCATE app_cache.entries;')).toEqual([])
  })
})
