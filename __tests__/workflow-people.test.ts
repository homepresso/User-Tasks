import { describe, expect, it } from 'vitest'
import { resolveExpression } from '@/lib/expression-resolver'
import { evaluateFunction, FUNCTION_CATALOG } from '@/lib/expression-functions'
import { PEOPLE, buildDirectory, lookupPerson, usesPeopleFunctions } from '@/lib/workflow-people'

const MAYA = '0a000000-0000-4000-8000-0000000000a1'
const SAM = '0a000000-0000-4000-8000-0000000000a2'
const dir = buildDirectory([{ id: MAYA, display_name: 'Maya Patel', email: 'maya.patel@example.com' }, { id: SAM, display_name: null, email: 'sam.torres@example.com' }])

describe('USER_NAME / USER_EMAIL', () => {
  it('the directory: display name, else the email’s local part', () => {
    expect(dir.get(MAYA)).toEqual({ name: 'Maya Patel', email: 'maya.patel@example.com' })
    expect(dir.get(SAM)).toEqual({ name: 'sam.torres', email: 'sam.torres@example.com' })
  })
  it('resolve a user id (or a person value) from the run’s directory', () => {
    const variables: Record<string | symbol, unknown> = { workflow_started_by: MAYA, owner: { id: SAM, name: 'x' }, [PEOPLE]: dir }
    expect(resolveExpression('{{=USER_NAME(workflow_started_by)}}', { variables } as never)).toBe('Maya Patel')
    expect(resolveExpression('{{=USER_EMAIL(workflow_started_by)}}', { variables } as never)).toBe('maya.patel@example.com')
    expect(resolveExpression('Moved by {{=USER_NAME(owner)}}', { variables } as never)).toBe('Moved by sam.torres')
    expect(resolveExpression(`{{=COALESCE(USER_NAME("${SAM}"), "Someone")}}`, { variables } as never)).toBe('sam.torres')
    // Unknown id, empty id: empty.
    expect(resolveExpression('{{=COALESCE(USER_NAME("nobody"), "Someone")}}', { variables } as never)).toBe('Someone')
    expect(evaluateFunction('USER_NAME("")', variables as never)).toBe('')
  })
  it('outside a workflow (no directory) they are empty; the directory is never saved with the variables', () => {
    expect(evaluateFunction(`USER_NAME("${MAYA}")`, {})).toBe('')
    expect(lookupPerson(null, MAYA)).toBeNull()
    const variables = { a: 1, [PEOPLE]: dir }
    expect(JSON.parse(JSON.stringify(variables))).toEqual({ a: 1 })
    // A template can't reach it by name.
    expect(resolveExpression('{{PEOPLE}}', { variables } as never)).toBe('')
  })
  it('steps that use them are found in any config; both are in the function catalogue', () => {
    expect(usesPeopleFunctions({ column_values: { changed_by: '{{=USER_NAME(workflow_started_by)}}' } })).toBe(true)
    expect(usesPeopleFunctions({ to: '{{= USER_EMAIL (x) }}' })).toBe(true)
    expect(usesPeopleFunctions({ text: 'USER_NAMES are fine' })).toBe(false)
    expect(usesPeopleFunctions(null)).toBe(false)
    expect(FUNCTION_CATALOG.map((f) => f.name)).toEqual(expect.arrayContaining(['USER_NAME', 'USER_EMAIL']))
  })
})
