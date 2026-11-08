import { describe, it, expect } from 'vitest'
import { buildModelMessages, safeToolArguments } from '@/lib/assistants/engine'

describe('cut-off tool calls', () => {
  it('safeToolArguments keeps valid JSON objects and replaces partial JSON with {}', () => {
    expect(safeToolArguments('{"a":1}')).toBe('{"a":1}')
    expect(safeToolArguments('{"title": "Patient business process')).toBe('{}')
    expect(safeToolArguments('[1,2]')).toBe('{}')
    expect(safeToolArguments('')).toBe('{}')
    expect(safeToolArguments(undefined)).toBe('{}')
  })

  it('never sends partial tool arguments from history back to the provider', () => {
    const history: any[] = [
      { role: 'user', content: 'build it' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'build_plan', arguments: '{"title": "Patient business process' } }] },
      { role: 'tool', tool_call_id: 'c1', name: 'build_plan', content: '{"error":"cut off"}' },
      { role: 'user', content: 'How many tasks does Noah have?' },
    ]
    const msgs = buildModelMessages('x', history, null)
    const assistant = msgs.find((m) => m.role === 'assistant') as any
    expect(assistant.tool_calls[0].function.arguments).toBe('{}')
    expect(assistant.tool_calls[0].function.name).toBe('build_plan')
    for (const m of msgs) for (const c of ((m as any).tool_calls ?? [])) expect(() => JSON.parse(c.function.arguments)).not.toThrow()
  })
})
