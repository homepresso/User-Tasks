/**
 * A function call's result read further — FIRST(rows).amount — in a whole
 * expression, as an argument and inside an operator expression. Before this
 * the text came back literally (`FIRST(accounts).arr`), so a step reading the
 * first row of a list wrote the expression's text or lost the value.
 */
import { describe, expect, it } from 'vitest'
import { resolveExpression } from '@/lib/expression-resolver'
import { splitMemberAccess } from '@/lib/expression-functions'

const variables = { accounts: [{ arr: 5000, customer_since: '', owner: { name: 'Maya Patel' } }], amount: '100', list: [{ id: 'A' }, { id: 'B' }], csv: 'a,b' }
const run = (expr: string) => resolveExpression(expr, { variables } as never)

describe('member access on a call result', () => {
  it('reads a field, a nested field and an index', () => {
    expect(run('{{=FIRST(accounts).arr}}')).toBe(5000)
    expect(run('{{=FIRST(accounts).owner.name}}')).toBe('Maya Patel')
    expect(run('{{=INDEX(list, 2).id}}')).toBe('B')
    expect(run('{{=SPLIT(csv, ",")[1]}}')).toBe('b')
    expect(run('Owner: {{=FIRST(accounts).owner.name}}')).toBe('Owner: Maya Patel')
  })
  it('as an argument and in arithmetic', () => {
    expect(run('{{=ROUND(TO_NUMBER(COALESCE(FIRST(accounts).arr, 0)) + TO_NUMBER(amount), 0)}}')).toBe(5100)
    expect(run('{{=COALESCE(FIRST(accounts).customer_since, "new")}}')).toBe('new')
    expect(run('{{=IF(true, FIRST(list).id, "")}}')).toBe('A')
    expect(run('{{=FIRST(accounts).arr + 1}}')).toBe(5001)
  })
  it('a member named like a run variable stays the member', () => {
    const vars = { lead_id: 'LD-NEW', leads: [{ lead_id: 'LD-OLD' }], n: 1 }
    expect(resolveExpression('{{=IF(n > 0, FIRST(leads).lead_id, "")}}', { variables: vars } as never)).toBe('LD-OLD')
    expect(resolveExpression('{{=CONCAT("dup of ", FIRST(leads).lead_id, " not ", lead_id)}}', { variables: vars } as never)).toBe('dup of LD-OLD not LD-NEW')
  })
  it('missing, inherited or non-object paths are empty; quoted parens are not calls', () => {
    expect(run('{{=FIRST(accounts).missing}}')).toBeNull()
    expect(run('{{=FIRST(accounts).__proto__}}')).toBeNull()
    expect(run('{{=FIRST(list).id.deeper}}')).toBeNull()
    expect(run('{{=CONCAT("a).b", "c")}}')).toBe('a).bc')
    expect(splitMemberAccess('FIRST(x)')).toBeNull()
    expect(splitMemberAccess('FIRST(x) + 1')).toBeNull()
    expect(splitMemberAccess('FIRST(x).a[2].b')).toEqual({ call: 'FIRST(x)', path: ['a', 2, 'b'] })
  })
})
