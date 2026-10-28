import { describe, it, expect } from 'vitest'
import { getNodeConfigSummary } from '@/lib/workflow-utils'

describe('getNodeConfigSummary', () => {
  it('returns null for unconfigured node', () => {
    expect(getNodeConfigSummary({ type: 'update_task', config: {} })).toBeNull()
  })

  it('returns null for unknown node type', () => {
    expect(getNodeConfigSummary({ type: 'nonexistent', config: { anything: true } })).toBeNull()
  })

  // ─── Condition ───
  it('summarizes condition with groups', () => {
    const summary = getNodeConfigSummary({
      type: 'condition',
      config: {
        groups: [{ logic: 'and', rules: [{ field: 'status', operator: '==', value: 'open' }] }],
      },
    })
    expect(summary).toBe('status == open')
  })

  it('summarizes condition with branches', () => {
    const summary = getNodeConfigSummary({
      type: 'condition',
      config: {
        branches: [{ label: 'Yes', rules: [{ field: 'priority', operator: '>', value: '3' }] }],
      },
    })
    expect(summary).toBe('priority > 3')
  })

  it('summarizes condition with simple field', () => {
    const summary = getNodeConfigSummary({
      type: 'condition',
      config: { field: 'status', operator: '==', value: 'done' },
    })
    expect(summary).toBe('status == done')
  })

  // ─── Simple Nodes ───
  it('summarizes update_task', () => {
    expect(getNodeConfigSummary({ type: 'update_task', config: { field: 'status', value: 'done' } }))
      .toBe('status = done')
  })

  it('summarizes set_variable', () => {
    expect(getNodeConfigSummary({ type: 'set_variable', config: { name: 'x', expression: '42' } }))
      .toBe('x = 42')
  })

  it('summarizes delay', () => {
    expect(getNodeConfigSummary({ type: 'delay', config: { duration: '5', unit: 'minutes' } }))
      .toBe('5 minutes')
  })

  it('summarizes http_request', () => {
    expect(getNodeConfigSummary({ type: 'http_request', config: { method: 'POST', url: 'https://api.example.com' } }))
      .toBe('POST https://api.example.com')
  })

  it('summarizes send_email with truncation', () => {
    const longEmail = 'very-long-email-address@example.com'
    const summary = getNodeConfigSummary({ type: 'send_email', config: { to: longEmail } })
    expect(summary).toBe(`To: ${longEmail.slice(0, 25)}...`)
  })

  it('summarizes auto_action', () => {
    expect(getNodeConfigSummary({ type: 'auto_action', config: { status: 'completed', outcome: 'approved' } }))
      .toBe('→ completed, outcome: approved')
  })

  it('summarizes goto_activity', () => {
    expect(getNodeConfigSummary({ type: 'goto_activity', config: { target_node_label: 'Review Step' } }))
      .toBe('→ Review Step')
  })

  it('summarizes parallel', () => {
    expect(getNodeConfigSummary({ type: 'parallel', config: { mode: 'parallel', branches: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] } }))
      .toBe('⫘ 3 branches')
  })

  it('summarizes sequential parallel', () => {
    expect(getNodeConfigSummary({ type: 'parallel', config: { mode: 'sequential', branches: [{ label: 'A' }, { label: 'B' }] } }))
      .toBe('→ 2 branches')
  })

  it('summarizes loop', () => {
    expect(getNodeConfigSummary({ type: 'loop', config: { items: '{{tasks}}' } }))
      .toBe('each in {{tasks}}')
  })

  it('summarizes loop_n_times', () => {
    expect(getNodeConfigSummary({ type: 'loop_n_times', config: { count: '10' } }))
      .toBe('10 times')
  })

  it('summarizes log with truncation', () => {
    const long = 'This is a very long log message that should be truncated'
    expect(getNodeConfigSummary({ type: 'log', config: { message: long } }))
      .toBe(long.slice(0, 30))
  })

  it('summarizes math', () => {
    expect(getNodeConfigSummary({ type: 'math', config: { expression: '{{a}} + {{b}}' } }))
      .toBe('{{a}} + {{b}}')
  })

  it('summarizes call_sub_workflow', () => {
    expect(getNodeConfigSummary({ type: 'call_sub_workflow', config: { sub_workflow_name: 'Approval Flow' } }))
      .toBe('→ Approval Flow')
  })

  it('summarizes decision_table', () => {
    expect(getNodeConfigSummary({ type: 'decision_table', config: { decision_table_name: 'Expense Approval Matrix' } }))
      .toBe('→ Expense Approval Matrix')
  })

  it('summarizes add_user_to_role', () => {
    expect(getNodeConfigSummary({
      type: 'add_user_to_role',
      config: { user_label: 'Andy Hayes', role_label: 'Approver' },
    })).toBe('Andy Hayes → Approver')
  })

  it('summarizes remove_user_from_role', () => {
    expect(getNodeConfigSummary({
      type: 'remove_user_from_role',
      config: { user_label: 'Andy Hayes', role_label: 'Approver' },
    })).toBe('Andy Hayes × Approver')
  })

  it('summarizes check_permission', () => {
    expect(getNodeConfigSummary({
      type: 'check_permission',
      config: { user_label: 'Andy Hayes', permission: 'team.change_roles' },
    })).toBe('Andy Hayes · team.change_roles')
  })

  it('summarizes user_task', () => {
    expect(getNodeConfigSummary({ type: 'user_task', config: { task_title: 'Review document', assignment_type: 'team' } }))
      .toBe('Review document → team')
  })

  it('summarizes user_task redirect and invite options', () => {
    expect(getNodeConfigSummary({
      type: 'user_task',
      config: { task_title: 'Review document', allow_redirect: true, allow_invite_on_redirect: true },
    })).toBe('Review document redirect + invite')
  })

  it('summarizes user_task redirect to many', () => {
    expect(getNodeConfigSummary({
      type: 'user_task',
      config: { task_title: 'Review document', allow_redirect: true, redirect_assignment_mode: 'many' },
    })).toBe('Review document redirect many')
  })

  it('summarizes user_task redirect to many with cap', () => {
    expect(getNodeConfigSummary({
      type: 'user_task',
      config: {
        task_title: 'Review document',
        allow_redirect: true,
        redirect_assignment_mode: 'many',
        redirect_recipient_limit_mode: 'capped',
        redirect_recipient_limit: 3,
      },
    })).toBe('Review document redirect many max 3')
  })

  it('summarizes placeholder with note', () => {
    expect(getNodeConfigSummary({ type: 'placeholder', config: { note: 'TODO: add logic' } }))
      .toBe('TODO: add logic')
  })

  it('summarizes server_event', () => {
    expect(getNodeConfigSummary({ type: 'server_event', config: { event_name: 'order.paid' } }))
      .toBe('order.paid')
  })

  it('summarizes server_event with api reference', () => {
    expect(getNodeConfigSummary({ type: 'server_event', config: { event_name: 'order.paid', outbound_action: 'api_reference', reference_name: 'Payment API' } }))
      .toBe('order.paid → Payment API')
  })

  it('summarizes call_reference with method', () => {
    expect(getNodeConfigSummary({ type: 'call_reference', config: { reference_name: 'Users API', reference_method: 'GET' } }))
      .toBe('GET Users API')
  })

  it('summarizes call_reference without method', () => {
    expect(getNodeConfigSummary({ type: 'call_reference', config: { reference_name: 'Users API' } }))
      .toBe('Users API')
  })

  it('summarizes text_template', () => {
    expect(getNodeConfigSummary({ type: 'text_template', config: { template: 'Hello {{name}}' } }))
      .toBe('Hello {{name}}')
  })

  it('summarizes update_data_table with table_name and operation', () => {
    expect(getNodeConfigSummary({ type: 'update_data_table', config: { table_name: 'Orders', operation: 'list' } }))
      .toBe('list → Orders')
  })

  it('summarizes update_data_table without a name lookup by a short id, never the raw GUID', () => {
    expect(getNodeConfigSummary({ type: 'update_data_table', config: { table_id: 'abcdefgh-1234-5678' } }))
      .toBe('insert → Data table (abcdefgh)')
  })

  it('summarizes file_to_base64', () => {
    expect(getNodeConfigSummary({ type: 'file_to_base64', config: { file_url: 'https://cdn.example.com/docs/report.pdf' } }))
      .toBe('← report.pdf')
  })

  it('summarizes download_file', () => {
    expect(getNodeConfigSummary({ type: 'download_file', config: { url: 'https://cdn.example.com/image.png' } }))
      .toBe('← image.png')
  })

  it('summarizes user_task without team', () => {
    expect(getNodeConfigSummary({ type: 'user_task', config: { task_title: 'Approve' } }))
      .toBe('Approve')
  })

  it('summarizes condition returning null for empty config', () => {
    expect(getNodeConfigSummary({ type: 'condition', config: {} })).toBeNull()
  })

  it('summarizes condition with branches but empty rules', () => {
    expect(getNodeConfigSummary({ type: 'condition', config: { branches: [{ label: 'A', rules: [] }] } })).toBeNull()
  })
})
