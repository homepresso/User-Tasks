/** The form's AI assistant setting (layout.assistant) survives normalising and compacting. */
import { describe, expect, it } from 'vitest'
import { compactLayoutForSave, normalizeFormLayout } from '@/lib/forms/layout'
import { formAssistantSetting } from '@/lib/assistants/types'

const keys = ['a', 'b']
const rows = keys.map((k) => ({ columns: 1, cells: [{ field_key: k, span: 1 }] }))

describe('layout.assistant', () => {
  it('normalises on / off and drops anything else', () => {
    expect(normalizeFormLayout({ rows, assistant: 'off' }, keys)?.assistant).toBe('off')
    expect(normalizeFormLayout({ rows, assistant: 'on' }, keys)?.assistant).toBe('on')
    expect(normalizeFormLayout({ rows, assistant: 'maybe' }, keys)?.assistant).toBeUndefined()
  })

  it('keeps a trivial layout when only the assistant setting differs', () => {
    const layout = normalizeFormLayout({ rows, assistant: 'off' }, keys)!
    const saved = compactLayoutForSave(layout, keys)
    expect(saved?.assistant).toBe('off')
    expect(formAssistantSetting(saved)).toBe('off')
    expect(compactLayoutForSave({ rows }, keys)).toBeNull()
  })

  it('round-trips on a paged layout', () => {
    const paged = normalizeFormLayout({ mode: 'steps', pages: [{ id: 'p1', title: 'One', rows }], rows: [], assistant: 'on' }, keys)!
    expect(compactLayoutForSave(paged, keys)?.assistant).toBe('on')
  })
})
