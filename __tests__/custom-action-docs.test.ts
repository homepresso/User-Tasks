import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { ACTION_CAPABILITIES, ACTION_ERROR_CODES, ACTION_FIELD_TYPES } from '@/lib/custom-actions/contract'
import { CUSTOM_ACTIONS_PAGE, OFFICIAL_ACTIONS, OFFICIAL_ACTIONS_PAGE } from '@/lib/docs/content/custom-actions'
import { getDocPage } from '@/lib/docs/registry'

const manifestPath = (slug: string) => path.join(process.cwd(), 'gallery/actions', slug, 'manifest.json')

describe('custom workflow action docs', () => {
  it('are registered in the docs', () => {
    expect(getDocPage('workflows/custom-actions')).toBe(CUSTOM_ACTIONS_PAGE)
    expect(getDocPage('workflows/official-actions')).toBe(OFFICIAL_ACTIONS_PAGE)
  })

  it('document every field type, capability and error code of the contract', () => {
    const body = CUSTOM_ACTIONS_PAGE.body
    for (const type of ACTION_FIELD_TYPES) expect(body, type).toContain(`\`${type}\``)
    for (const capability of ACTION_CAPABILITIES) expect(body, capability).toContain(`\`${capability}\``)
    for (const code of ACTION_ERROR_CODES) expect(body, code).toContain(`| \`${code}\` |`)
    expect(body).toContain('/downloads/action-starter.zip')
    expect(body).toContain('CUSTOM_ACTIONS_DISABLED')
  })

  it('list six official actions with unique keys and gallery links', () => {
    expect(OFFICIAL_ACTIONS.map((a) => a.key)).toEqual(['ut_math', 'ut_text', 'ut_dates', 'ut_data', 'ut_validate', 'ut_crypto'])
    for (const action of OFFICIAL_ACTIONS) expect(OFFICIAL_ACTIONS_PAGE.body).toContain(`(/gallery/actions/${action.slug})`)
  })

  // Each gallery action's manifest is the source of truth once it is built.
  it.each(OFFICIAL_ACTIONS.map((a) => [a.slug, a] as const))('%s: the documented functions match the manifest', (slug, action) => {
    if (!existsSync(manifestPath(slug))) return
    const manifest = JSON.parse(readFileSync(manifestPath(slug), 'utf8'))
    expect(manifest.key).toBe(action.key)
    expect(action.operations.map((op) => op.id)).toEqual(manifest.operations.map((op: { id: string }) => op.id))
    expect(action.operations.map((op) => op.label)).toEqual(manifest.operations.map((op: { label: string }) => op.label))
  })
})
