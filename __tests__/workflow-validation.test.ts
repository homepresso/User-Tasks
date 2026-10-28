import { describe, it, expect } from 'vitest'
import { validateNode, validateWorkflow, type WorkflowValidationResult } from '@/lib/workflow-validation'
import type { WorkflowNode } from '@/lib/workflow-schema'

function makeNode(type: string, config: Record<string, any> = {}): WorkflowNode {
  return { id: 'test-1', type: type as any, label: 'Test', position: { x: 0, y: 0 }, config }
}

describe('validateNode', () => {
  // ─── Triggers (should always pass) ───
  describe('trigger nodes', () => {
    it('task_created passes with no config', () => {
      expect(validateNode(makeNode('task_created'))).toEqual([])
    })

    it('webhook_received passes with no config', () => {
      expect(validateNode(makeNode('webhook_received'))).toEqual([])
    })

    it('schedule passes with no config', () => {
      expect(validateNode(makeNode('schedule'))).toEqual([])
    })

    it('schedule passes with a complete config', () => {
      expect(validateNode(makeNode('schedule', { schedule_mode: 'daily', time_of_day: '09:00', timezone: 'UTC' }))).toEqual([])
    })

    it('schedule fails when partially configured (mode set, fields invalid)', () => {
      const errors = validateNode(makeNode('schedule', { schedule_mode: 'daily', time_of_day: '25:99' }))
      expect(errors).toContain('Schedule is incomplete — choose a repeat mode and fill in its fields')
    })

    it('schedule fails when fields set but mode missing', () => {
      const errors = validateNode(makeNode('schedule', { interval_minutes: 15 }))
      expect(errors).toHaveLength(1)
    })
  })

  // ─── Logic Nodes ───
  describe('condition node', () => {
    it('fails without any condition defined', () => {
      const errors = validateNode(makeNode('condition'))
      expect(errors).toContain('No condition defined')
    })

    it('passes with groups', () => {
      const errors = validateNode(makeNode('condition', { groups: [{ logic: 'and', rules: [] }] }))
      expect(errors).toEqual([])
    })

    it('passes with field', () => {
      const errors = validateNode(makeNode('condition', { field: 'status' }))
      expect(errors).toEqual([])
    })

    it('passes with branches', () => {
      const errors = validateNode(makeNode('condition', {
        branches: [{ label: 'High', logic: 'AND', rules: [{ field: '{{priority}}', operator: 'equals', value: 'high' }] }],
        has_else: true,
      }))
      expect(errors).toEqual([])
    })
  })

  describe('switch_case node', () => {
    it('fails without field', () => {
      const errors = validateNode(makeNode('switch_case', { cases: [{}] }))
      expect(errors).toContain('Value field required')
    })

    it('fails without cases', () => {
      const errors = validateNode(makeNode('switch_case', { field: 'status' }))
      expect(errors).toContain('No cases defined')
    })

    it('passes with field and cases', () => {
      const errors = validateNode(makeNode('switch_case', { field: 'status', cases: [{ value: 'open' }] }))
      expect(errors).toEqual([])
    })
  })

  // ─── Operation Nodes ───
  describe('set_variable node', () => {
    it('fails without name', () => {
      expect(validateNode(makeNode('set_variable'))).toContain('Variable name required')
    })

    it('passes with name', () => {
      expect(validateNode(makeNode('set_variable', { name: 'x' }))).toEqual([])
    })
  })

  describe('math node', () => {
    it('fails without expression', () => {
      expect(validateNode(makeNode('math'))).toContain('Expression required')
    })

    it('passes with expression', () => {
      expect(validateNode(makeNode('math', { expression: '1+1' }))).toEqual([])
    })
  })

  describe('text_template node', () => {
    it('fails without template', () => {
      expect(validateNode(makeNode('text_template'))).toContain('Template required')
    })
  })

  // ─── Action Nodes ───
  describe('http_request node', () => {
    it('fails without url', () => {
      expect(validateNode(makeNode('http_request'))).toContain('URL required')
    })

    it('passes with url', () => {
      expect(validateNode(makeNode('http_request', { url: 'https://example.com' }))).toEqual([])
    })
  })

  describe('update_task node', () => {
    it('fails without field', () => {
      expect(validateNode(makeNode('update_task'))).toContain('Field required')
    })
  })

  describe('send_email node', () => {
    it('fails without to and subject', () => {
      const errors = validateNode(makeNode('send_email'))
      expect(errors).toContain('Recipient required')
      expect(errors).toContain('Subject required')
    })
  })

  describe('delay node', () => {
    it('fails without duration', () => {
      expect(validateNode(makeNode('delay'))).toContain('Duration required')
    })
  })

  describe('loop node', () => {
    it('fails without items', () => {
      expect(validateNode(makeNode('loop'))).toContain('Items collection required')
    })
  })

  describe('loop_n_times node', () => {
    it('fails without count', () => {
      expect(validateNode(makeNode('loop_n_times'))).toContain('Count required')
    })
  })

  describe('log node', () => {
    it('fails without message', () => {
      expect(validateNode(makeNode('log'))).toContain('Message required')
    })
  })

  describe('auto_action node', () => {
    it('fails without any action', () => {
      expect(validateNode(makeNode('auto_action'))).toContain('No action configured')
    })

    it('passes with status', () => {
      expect(validateNode(makeNode('auto_action', { status: 'completed' }))).toEqual([])
    })
  })

  describe('call_reference node', () => {
    it('fails without reference_id', () => {
      expect(validateNode(makeNode('call_reference'))).toContain('No reference selected')
    })

    it('fails when required inputs are missing', () => {
      const errors = validateNode(makeNode('call_reference', {
        reference_id: 'ref-1',
        _ref_inputs: [{ name: 'api_key', required: true }],
        input_mappings: {},
      }))
      expect(errors).toContain('Input "api_key" required')
    })

    it('passes with reference and required inputs mapped', () => {
      const errors = validateNode(makeNode('call_reference', {
        reference_id: 'ref-1',
        _ref_inputs: [{ name: 'api_key', required: true }],
        input_mappings: { api_key: '{{secret}}' },
      }))
      expect(errors).toEqual([])
    })
  })

  describe('user_task node', () => {
    it('fails without task_title', () => {
      const errors = validateNode(makeNode('user_task'))
      expect(errors).toContain('Task title required')
    })

    it('fails without assignee for individual assignment', () => {
      const errors = validateNode(makeNode('user_task', { task_title: 'Do this' }))
      expect(errors).toContain('Assignee required')
    })

    it('passes with title and assignee', () => {
      const errors = validateNode(makeNode('user_task', {
        task_title: 'Do this',
        assignee_id: 'user-1',
      }))
      expect(errors).toEqual([])
    })

    it('passes with scaffold aliases for title and assignee', () => {
      const errors = validateNode(makeNode('user_task', {
        title: 'Do this',
        assign_to_user_id: 'user-1',
      }))
      expect(errors).toEqual([])
    })

    it('fails for team assignment without team_id', () => {
      const errors = validateNode(makeNode('user_task', {
        task_title: 'Do this',
        assignment_type: 'team',
      }))
      expect(errors).toContain('Team required')
    })

    it('fails when invite on redirect is enabled without redirect', () => {
      const errors = validateNode(makeNode('user_task', {
        task_title: 'Do this',
        assignee_id: 'user-1',
        allow_invite_on_redirect: true,
      }))
      expect(errors).toContain('Enable redirect before invite on redirect')
    })

    it('fails when redirect assignment mode is invalid', () => {
      const errors = validateNode(makeNode('user_task', {
        task_title: 'Do this',
        assignee_id: 'user-1',
        allow_redirect: true,
        redirect_assignment_mode: 'invalid',
      }))
      expect(errors).toContain('Redirect assignment mode must be single or many')
    })

    it('fails when capped redirect recipient limit is invalid', () => {
      const errors = validateNode(makeNode('user_task', {
        task_title: 'Do this',
        assignee_id: 'user-1',
        allow_redirect: true,
        redirect_assignment_mode: 'many',
        redirect_recipient_limit_mode: 'capped',
        redirect_recipient_limit: 0,
      }))
      expect(errors).toContain('Redirect recipient limit must be greater than 0')
    })

    it('passes with valid fields', () => {
      const errors = validateNode(makeNode('user_task', {
        task_title: 'Do this',
        assignee_id: 'user-1',
        fields: [
          { label: 'Amount', type: 'number', required: true },
          { key: 'category', label: 'Category', type: 'choice', options: ['A', 'B'] },
        ],
      }))
      expect(errors).toEqual([])
    })

    it('fails on duplicate field keys, choice fields without options and blank fields', () => {
      const errors = validateNode(makeNode('user_task', {
        task_title: 'Do this',
        assignee_id: 'user-1',
        fields: [
          { label: 'Amount', type: 'number' },
          { key: 'amount', label: 'Total', type: 'number' },
          { label: 'Category', type: 'choice', options: [' '] },
          { label: '' },
        ],
      }))
      expect(errors).toContain('Duplicate task field key "amount"')
      expect(errors).toContain('Choice field "Category" needs at least one option')
      expect(errors).toContain('Every task field needs a label or key')
    })
  })

  describe('parallel node', () => {
    it('fails with fewer than 2 branches', () => {
      const errors = validateNode(makeNode('parallel', { branches: [{ label: 'A' }] }))
      expect(errors).toContain('At least 2 branches required')
    })

    it('passes with 2+ branches', () => {
      const errors = validateNode(makeNode('parallel', {
        branches: [{ label: 'A' }, { label: 'B' }],
      }))
      expect(errors).toEqual([])
    })
  })

  describe('placeholder node', () => {
    it('always passes', () => {
      expect(validateNode(makeNode('placeholder'))).toEqual([])
    })
  })

  describe('collection nodes', () => {
    const collectionTypes = ['collection_count', 'collection_get', 'collection_filter', 'collection_sort', 'collection_unique', 'collection_join']
    for (const type of collectionTypes) {
      it(`${type} fails without collection`, () => {
        expect(validateNode(makeNode(type))).toContain('Collection required')
      })

      it(`${type} passes with collection`, () => {
        expect(validateNode(makeNode(type, { collection: '{{items}}' }))).toEqual([])
      })
    }
  })

  describe('sub-workflow and event nodes', () => {
    it('call_sub_workflow fails without sub_workflow_id', () => {
      expect(validateNode(makeNode('call_sub_workflow'))).toContain('Sub-workflow required')
    })

    it('call_sub_workflow passes with sub_workflow_id', () => {
      expect(validateNode(makeNode('call_sub_workflow', { sub_workflow_id: 'wf-1' }))).toEqual([])
    })

    it('goto_activity fails without target_node_id', () => {
      expect(validateNode(makeNode('goto_activity'))).toContain('Target activity required')
    })

    it('goto_activity passes with target_node_id', () => {
      expect(validateNode(makeNode('goto_activity', { target_node_id: 'n1' }))).toEqual([])
    })

    it('server_event fails without event_name', () => {
      expect(validateNode(makeNode('server_event'))).toContain('Event name required')
    })

    it('server_event with api_reference requires reference_id', () => {
      const errors = validateNode(makeNode('server_event', {
        event_name: 'order.paid',
        outbound_action: 'api_reference',
      }))
      expect(errors).toContain('API reference required')
    })

    it('server_event with data_table requires table_id', () => {
      const errors = validateNode(makeNode('server_event', {
        event_name: 'order.paid',
        outbound_action: 'data_table',
      }))
      expect(errors).toContain('Data table required')
    })

    it('server_event passes with event_name and no outbound', () => {
      expect(validateNode(makeNode('server_event', { event_name: 'order.paid' }))).toEqual([])
    })
  })

  describe('governance nodes', () => {
    it('add_user_to_role fails without user and role', () => {
      const errors = validateNode(makeNode('add_user_to_role'))
      expect(errors).toContain('User required')
      expect(errors).toContain('Role required')
    })

    it('add_user_to_role passes with user and role_id', () => {
      expect(validateNode(makeNode('add_user_to_role', { user_id: 'user-1', role_id: 'role-1' }))).toEqual([])
    })

    it('remove_user_from_role passes with user and role_name', () => {
      expect(validateNode(makeNode('remove_user_from_role', { user_id: 'user-1', role_name: 'Admin' }))).toEqual([])
    })

    it('check_permission requires user and permission', () => {
      const errors = validateNode(makeNode('check_permission'))
      expect(errors).toContain('User required')
      expect(errors).toContain('Permission required')
    })

    it('check_permission passes with user and permission', () => {
      expect(validateNode(makeNode('check_permission', { user_id: 'user-1', permission: 'team.change_roles' }))).toEqual([])
    })
  })

  describe('decision table node', () => {
    it('fails without a selected business rule', () => {
      expect(validateNode(makeNode('decision_table'))).toContain('Business rule required')
    })

    it('passes with a selected business rule', () => {
      expect(validateNode(makeNode('decision_table', { decision_table_id: 'dt-1' }))).toEqual([])
    })

    it('fails when a required mapped input is missing', () => {
      expect(validateNode(makeNode('decision_table', {
        decision_table_id: 'dt-1',
        _decision_inputs: [{ key: 'amount', required: true }],
        input_mappings: {},
      }))).toContain('Input "amount" required')
    })
  })

  describe('run_agent node', () => {
    it('fails without an agent', () => {
      expect(validateNode(makeNode('run_agent'))).toContain('Agent is required')
    })

    it('fails without a prompt or message', () => {
      expect(validateNode(makeNode('run_agent', { agent_id: 'agent-1' }))).toContain('Prompt / message required')
    })

    it('passes with agent and prompt', () => {
      expect(validateNode(makeNode('run_agent', {
        agent_id: 'agent-1',
        user_message: 'Summarize {{ticket_title}}',
      }))).toEqual([])
    })
  })

  describe('string operation nodes', () => {
    it('modify_string fails without operation', () => {
      expect(validateNode(makeNode('modify_string'))).toContain('Operation required')
    })

    it('regex fails without pattern', () => {
      expect(validateNode(makeNode('regex'))).toContain('Pattern required')
    })

    it('format_date fails without date', () => {
      expect(validateNode(makeNode('format_date'))).toContain('Date value required')
    })

    it('format_date passes with date', () => {
      expect(validateNode(makeNode('format_date', { date: '{{now}}' }))).toEqual([])
    })

    it('date_math fails without date', () => {
      expect(validateNode(makeNode('date_math'))).toContain('Date value required')
    })

    it('date_math passes with input', () => {
      expect(validateNode(makeNode('date_math', { input: '{{date}}' }))).toEqual([])
    })

    it('pause_until fails without date', () => {
      expect(validateNode(makeNode('pause_until'))).toContain('Date required')
    })

    it('create_subtask fails without title', () => {
      expect(validateNode(makeNode('create_subtask'))).toContain('Title required')
    })

    it('update_data_table fails without table_id', () => {
      expect(validateNode(makeNode('update_data_table'))).toContain('No table selected')
    })

    it('update_data_table accepts row-match aliases for update operations', () => {
      expect(validateNode(makeNode('update_data_table', {
        table_id: 'table-1',
        operation: 'update',
        match_column: 'Email',
        match_value: '{{personal_email}}',
      }))).toEqual([])
    })

    it('update_data_table accepts canonical row-match fields for update operations', () => {
      expect(validateNode(makeNode('update_data_table', {
        table_id: 'table-1',
        operation: 'update',
        row_match_field: 'Email',
        row_match_value: '{{personal_email}}',
      }))).toEqual([])
    })
  })

  describe('end_workflow node', () => {
    it('passes with no config', () => {
      expect(validateNode(makeNode('end_workflow'))).toEqual([])
    })
  })

  describe('file nodes', () => {
    it('file_to_base64 fails without file_url', () => {
      expect(validateNode(makeNode('file_to_base64'))).toContain('File URL required')
    })

    it('base64_to_file fails without required fields', () => {
      const errors = validateNode(makeNode('base64_to_file'))
      expect(errors).toContain('Base64 data required')
      expect(errors).toContain('File name required')
    })

    it('download_file fails without url', () => {
      expect(validateNode(makeNode('download_file'))).toContain('URL required')
    })

    it('read_file fails without file_url', () => {
      expect(validateNode(makeNode('read_file'))).toContain('File URL required')
    })
  })
})

describe('validateWorkflow', () => {
  it('returns valid for empty node list', () => {
    const result = validateWorkflow([])
    expect(result.valid).toBe(true)
    expect(result.totalErrors).toBe(0)
    expect(result.nodeErrors).toEqual([])
  })

  it('returns valid when all nodes pass', () => {
    const nodes: WorkflowNode[] = [
      makeNode('task_created'),
      makeNode('set_variable', { name: 'x' }),
      makeNode('log', { message: 'done' }),
    ]
    const result = validateWorkflow(nodes)
    expect(result.valid).toBe(true)
    expect(result.totalErrors).toBe(0)
  })

  it('flags a schedule-triggered workflow with an unconfigured schedule node', () => {
    const nodes: WorkflowNode[] = [makeNode('schedule'), makeNode('log', { message: 'hi' })]
    const result = validateWorkflow(nodes, 'schedule')
    expect(result.valid).toBe(false)
    expect(result.nodeErrors[0].errors).toContain('Schedule not configured — this workflow will never run')
  })

  it('passes a schedule-triggered workflow with a configured schedule node', () => {
    const nodes: WorkflowNode[] = [
      makeNode('schedule', { schedule_mode: 'hourly', minute_of_hour: 0 }),
      makeNode('log', { message: 'hi' }),
    ]
    expect(validateWorkflow(nodes, 'schedule').valid).toBe(true)
  })

  it('returns invalid with error details for failing nodes', () => {
    const nodes: WorkflowNode[] = [
      { ...makeNode('set_variable'), id: 'n1', label: 'Set Var' },
      { ...makeNode('http_request'), id: 'n2', label: 'HTTP' },
    ]
    const result = validateWorkflow(nodes)
    expect(result.valid).toBe(false)
    expect(result.totalErrors).toBe(2)
    expect(result.nodeErrors).toHaveLength(2)
    expect(result.nodeErrors[0].nodeId).toBe('n1')
    expect(result.nodeErrors[1].nodeId).toBe('n2')
  })

  it('counts total errors across nodes', () => {
    const nodes: WorkflowNode[] = [
      makeNode('send_email'), // 2 errors: no to, no subject
      makeNode('base64_to_file'), // 2 errors: no base64_data, no file_name
    ]
    const result = validateWorkflow(nodes)
    expect(result.totalErrors).toBe(4)
  })
})
