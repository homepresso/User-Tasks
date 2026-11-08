/**
 * get_process_context: user-visible templates ("Raise a PO for {{item}}")
 * resolved against the run's variables, secrets masked, and "‹item›"
 * placeholders when there is no run (or a value is missing).
 */
import { describe, expect, it } from 'vitest'
import { describeProcess, describeStep, resolveTemplateText } from '@/lib/assistants/process'

/* eslint-disable @typescript-eslint/no-explicit-any */

const NODES = [
  { id: 'start', type: 'form_submitted', label: 'Request submitted', config: {} },
  { id: 'po', type: 'user_task', label: 'Raise PO', config: { task_title: 'Raise a PO for {{item}}', outcomes: ['Done'], assignee_id: 'u1' } },
  { id: 'mail', type: 'send_email', label: 'Tell vendor', config: { to: '{{form.vendor_email}}', subject: 'Order for {{form.item_name}} (key {{vendor_api_key}})' } },
  { id: 'end', type: 'end_workflow', label: 'End', config: { reason: 'Ordered {{item}}' } },
]
const EDGES = [
  { source: 'start', target: 'po' },
  { source: 'po', target: 'mail', label: 'Done' },
  { source: 'mail', target: 'end' },
]

describe('process templates', () => {
  it('a run: placeholders resolve to the run values', () => {
    const vars = { item: 'Laptop', form: { item_name: 'Dell XPS', vendor_email: 'v@x.test' }, vendor_api_key: 'abc123' }
    expect(resolveTemplateText('Raise a PO for {{item}}', vars)).toBe('Raise a PO for Laptop')
    expect(resolveTemplateText('Total {{=ROUND(price * qty, 0)}}', { price: 2.5, qty: 4 })).toBe('Total 10')
    const d = describeProcess({ workflow: { name: 'PO' }, nodes: NODES as any, edges: EDGES, currentNodeId: 'po', variables: vars })
    expect(d.now).toContain('(task “Raise a PO for Laptop”)')
    const steps = d.next[0].steps.join('\n')
    expect(steps).toContain('“Order for Dell XPS (key ••••)”')
    expect(steps).toContain('Ends: Ordered Laptop')
    expect(JSON.stringify(d)).not.toContain('abc123')
  })

  it('secrets are masked: credential-named variables, secret-shaped values, calculations over them', () => {
    const vars = { client_secret: 'hunter2', note: 'sk-ant-abcdefghijklmnopqrstuvwx', vendor: { password: 'pw' }, stored: 'enc:v1:deadbeef' }
    expect(resolveTemplateText('S {{client_secret}}', vars)).toBe('S ••••')
    expect(resolveTemplateText('N {{note}}', vars)).toBe('N ••••')
    expect(resolveTemplateText('P {{vendor.password}}', vars)).toBe('P ••••')
    expect(resolveTemplateText('E {{stored}}', vars)).toBe('E ••••')
    expect(resolveTemplateText('U {{=UPPER(client_secret)}}', vars)).not.toContain('HUNTER2')
  })

  it('no run: placeholders read as ‹name›; missing values and failures fall back the same way, never throw', () => {
    expect(resolveTemplateText('Raise a PO for {{item}}')).toBe('Raise a PO for ‹item›')
    expect(resolveTemplateText('Order for {{form.item_name}}')).toBe('Order for ‹item name›')
    expect(resolveTemplateText('Total {{=SUM(a, b)}}')).toBe('Total ‹calculated value›')
    expect(resolveTemplateText('For {{missing}}', { item: 'x' })).toBe('For ‹missing›')
    expect(resolveTemplateText('Broken {{=NOPE(', { item: 'x' })).not.toContain('{{')
    expect(() => resolveTemplateText('Bad {{=UNKNOWN_FN(1)}}', { item: 'x' })).not.toThrow()
    const step = describeStep(NODES[1] as any, {}, null)
    expect(step).toContain('(task “Raise a PO for ‹item›”)')
    const d = describeProcess({ workflow: { name: 'PO' }, nodes: NODES as any, edges: EDGES, fromStart: true })
    expect(d.next[0].steps.join('\n')).toContain('Raise a PO for ‹item›')
    expect(d.next[0].steps.join('\n')).not.toContain('{{')
  })
})
