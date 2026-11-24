/**
 * "One response per person" (wizard forms) under a double submit (gap: two quick
 * submits both counted). The policy's read check runs before the insert, so two
 * submissions racing past it both stored. Rows under the policy are now stored
 * flagged `single_response`, and a partial unique index (migration
 * 20270126140000) makes the second insert fail — refused with the policy's message.
 * The DB itself is simulated here (a unique check on the flagged rows); the
 * migration is checked for the index it promises.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ONE_RESPONSE_MESSAGE, SINGLE_RESPONSE_INDEX, assertWizardResponsePolicy, insertSubmissionRow } from '@/lib/services/form-wizard-policy'

/* eslint-disable @typescript-eslint/no-explicit-any -- a fake PostgREST client */

const TENANT = 't1'
const FORM = 'f1'
const ME = 'u1'

/** form_wizard_projects + form_submissions with the partial unique index; `hasColumn: false` = migration not applied. */
function fakeDb(options: { multiple: boolean; hasColumn?: boolean }) {
  const rows: Array<Record<string, any>> = []
  const project = { spec: { audience: { multiple_responses: options.multiple } }, status: 'created' }
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const db = {
    rows,
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const q: any = {
        select() { return q },
        eq(col: string, v: unknown) { filters.push([col, v]); return q },
        limit() { return q },
        async maybeSingle() { await tick(); return { data: table === 'form_wizard_projects' ? project : null, error: null } },
        then(resolve: (v: unknown) => void) {
          // The read check: earlier responses of this person (both racers read before either inserts).
          tick().then(() => resolve({ data: rows.filter((r) => filters.every(([c, v]) => r[c] === v)).map((r) => ({ id: r.id })), error: null }))
        },
        insert(row: Record<string, any>) {
          return {
            select() { return this },
            async single() {
              await tick()
              if (options.hasColumn === false && 'single_response' in row) return { data: null, error: { code: 'PGRST204', message: "Could not find the 'single_response' column of 'form_submissions' in the schema cache" } }
              if (row.single_response && rows.some((r) => r.single_response && r.tenant_id === row.tenant_id && r.form_id === row.form_id && r.submitted_by === row.submitted_by)) {
                return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${SINGLE_RESPONSE_INDEX}"` } }
              }
              const stored = { id: `s${rows.length + 1}`, ...row }
              rows.push(stored)
              return { data: stored, error: null }
            },
          }
        },
      }
      return q
    },
  }
  return db
}

/** The submit path's order (lib/services/form-submissions.ts submitForm): policy check, then the insert. */
async function submit(db: any, actor: string | null) {
  const { singleResponse } = await assertWizardResponsePolicy(db, TENANT, FORM, actor)
  const { data, error, duplicateResponse } = await insertSubmissionRow(db, { tenant_id: TENANT, form_id: FORM, submitted_by: actor, values: {} }, 'id', { singleResponse })
  if (duplicateResponse) throw new Error(ONE_RESPONSE_MESSAGE)
  if (error || !data) throw new Error(error?.message ?? 'failed')
  return data
}

describe('one response per person under a double submit', () => {
  it('two submissions at the same moment: exactly one counts, the other is refused', async () => {
    const db = fakeDb({ multiple: false })
    const results = await Promise.allSettled([submit(db, ME), submit(db, ME)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(String(refused.reason)).toMatch(/already responded/)
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].single_response).toBe(true)
  })

  it('a later submission is still refused by the read check', async () => {
    const db = fakeDb({ multiple: false })
    await submit(db, ME)
    await expect(submit(db, ME)).rejects.toThrow(/already responded/)
  })

  it('other people, anonymous visitors and forms allowing many responses are not limited', async () => {
    const one = fakeDb({ multiple: false })
    await Promise.all([submit(one, ME), submit(one, 'u2')])
    expect(one.rows).toHaveLength(2)
    const anon = fakeDb({ multiple: false })
    await Promise.all([submit(anon, null), submit(anon, null)])
    expect(anon.rows.every((r) => !r.single_response)).toBe(true)
    const many = fakeDb({ multiple: true })
    await Promise.all([submit(many, ME), submit(many, ME)])
    expect(many.rows).toHaveLength(2)
    expect(many.rows.every((r) => !('single_response' in r))).toBe(true)
  })

  it('before the migration is applied: stored without the flag (the read check as before)', async () => {
    const db = fakeDb({ multiple: false, hasColumn: false })
    const row = await submit(db, ME)
    expect(row).toBeTruthy()
    expect('single_response' in db.rows[0]).toBe(false)
  })

  it('the migration adds the flag and the partial unique index', () => {
    const sql = readFileSync('supabase/migrations/20270126140000_form_submissions_one_response.sql', 'utf8')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS single_response boolean NOT NULL DEFAULT false/)
    expect(sql).toMatch(new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${SINGLE_RESPONSE_INDEX}\\s+ON public\\.form_submissions \\(tenant_id, form_id, submitted_by\\)\\s+WHERE single_response AND submitted_by IS NOT NULL`))
    expect(readFileSync('docs/migrations.md', 'utf8')).toContain('20270126140000_form_submissions_one_response')
  })
})
