import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config/instance-settings', () => ({ getInstanceSetting: async () => null }))

import { recordAssistantUsage } from '@/lib/assistants/limits'

/** A db whose assistant_usage lacks `missing` columns (an older schema): inserts naming them fail like PostgREST. */
function fakeDb(missing: string[] = []) {
  const inserted: Array<Record<string, unknown>> = []
  const attempts: Array<Record<string, unknown>> = []
  const from = (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    insert: async (row: Record<string, unknown>) => {
      if (table !== 'assistant_usage') return { error: null }
      attempts.push({ ...row })
      const bad = missing.find((c) => c in row)
      if (bad) return { error: { message: `Could not find the '${bad}' column of 'assistant_usage' in the schema cache` } }
      inserted.push(row)
      return { error: null }
    },
  })
  return { db: { from } as never, inserted, attempts }
}

const base = {
  tenantId: 't1', userId: 'u1', capability: 'designer' as const, provider: 'openai', model: 'gpt-4.1', status: 'completed' as const,
  usage: { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010, cached_tokens: 400 }, llmCalls: 1, toolCalls: 0, usageMissing: false,
}

describe('recordAssistantUsage: source and cached tokens', () => {
  it('records the source and cached tokens', async () => {
    const { db, inserted } = fakeDb()
    await recordAssistantUsage(db, { ...base, source: 'pdf_import', modelRule: 'p1' })
    expect(inserted[0]).toMatchObject({ source: 'pdf_import', cached_tokens: 400, model_rule: 'p1', cost_status: 'priced' })
  })

  it('the Agent chat leaves source empty (= assistant)', async () => {
    const { db, inserted } = fakeDb()
    await recordAssistantUsage(db, { ...base, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    expect(inserted[0]).not.toHaveProperty('source')
    expect(inserted[0]).not.toHaveProperty('cached_tokens')
  })

  it('before migration 20270126130000 (and 20261231000001) the row is still recorded without the new columns', async () => {
    const { db, inserted, attempts } = fakeDb(['source', 'cached_tokens', 'model_rule'])
    await recordAssistantUsage(db, { ...base, source: 'redact_ai', modelRule: 'p1' })
    expect(attempts).toHaveLength(4)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ tenant_id: 't1', model: 'gpt-4.1', total_tokens: 1010 })
    expect(Object.keys(inserted[0])).not.toEqual(expect.arrayContaining(['source']))
  })
})
