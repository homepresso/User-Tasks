import { describe, expect, it, vi } from 'vitest'

const recorded = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('@/lib/assistants/limits', () => ({ recordAssistantUsage: async (_db: unknown, rec: Record<string, unknown>) => { recorded.push(rec) } }))
vi.mock('@/lib/secret-fields', () => ({ decryptSensitiveFields: (c: unknown) => c }))
vi.mock('@/lib/agent-executor', () => ({
  executeAgent: async () => ({ status: 'completed', response: '{"names":["Ana Diaz"],"addresses":[]}', usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 }, steps: [{ type: 'llm', usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 } }] }),
}))

import { findWithAgent } from '@/lib/documents/pii/ai'

describe('Redact Document AI detection records its usage', () => {
  it('records tokens under source redact_ai through the shared recorder — never the text', async () => {
    const agent = { id: 'a1', tenant_id: 't1', model: 'gpt-4.1', is_active: true, integration: { type: 'openai', config: { base_url: 'https://api.openai.com/v1', auth_config: { key_value: 'sk-x' } } } }
    const db = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: agent, error: null }) }) }) }) }) }
    const result = await findWithAgent(db as never, 't1', 'a1', 'Call Ana Diaz tomorrow')
    expect(result.values).toEqual([{ type: 'person_name', text: 'Ana Diaz' }])
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ tenantId: 't1', source: 'redact_ai', provider: 'openai', model: 'gpt-4.1', llmCalls: 1, usageMissing: false, status: 'completed' })
    expect(JSON.stringify(recorded[0])).not.toContain('Ana Diaz')
  })
})
