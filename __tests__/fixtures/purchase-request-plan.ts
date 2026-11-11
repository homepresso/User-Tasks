/**
 * The Solution blueprint's worked example as a build_plan call: purchase
 * requests with line items (parent / child), a categories config table with
 * its admin form, an approval-thresholds decision table, task forms, the
 * approval workflow (the List's rows inserted in a loop) and two reports with
 * charts — packaged as one solution. Shared by the unit tests and the mocked
 * LLM used for the browser check (printed as JSON from here).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function purchaseRequestPlan(stamp = ''): { title: string; items: any[]; package: any } {
  const prefill = { title: '{{form.title}}', total: '{{form.line_items_total_total}}' }
  const taskForm = (name: string) => ({
    fields: [
      { key: 'title', label: 'Request', type: 'text', read_only: true, default: '{{form.title}}' },
      { key: 'total', label: 'Total', type: 'currency', currency: 'NZD', read_only: true, default: '{{form.line_items_total_total}}' },
      { key: 'comment', label: 'Comment', type: 'textarea', help_text: `Shown to the requester (${name})` },
    ],
  })
  const task = (label: string, formKey: string) => ({
    task_title: `${label}: {{submission.reference}} {{form.title}}`, outcomes: ['Approve', 'Decline'], form_id: `{{ref:${formKey}.id}}`,
    field_values: prefill, assignment_type: 'individual', assignee_id: '@me',
  })
  return {
    title: `Purchase requests${stamp}`,
    items: [
      { key: 'categories', kind: 'data_table', role: 'config', name: `Categories${stamp}`, summary: 'Name, Active', args: { columns: [{ name: 'Name', type: 'text', required: true }, { name: 'Active', type: 'boolean' }] } },
      { key: 'requests', kind: 'data_table', role: 'parent', name: `Purchase requests${stamp}`, summary: 'Reference, Title, Requested by, Category → Categories, Total, Status, Approval level', args: { columns: [
        { name: 'Reference', type: 'text', required: true }, { name: 'Title', type: 'text', required: true }, { name: 'Requested by', type: 'text' },
        { name: 'Category', type: 'lookup', lookup: { sourceTableId: '{{ref:categories.id}}', sourceColumn: 'name' } },
        { name: 'Justification', type: 'longtext' }, { name: 'Total', type: 'number' },
        { name: 'Status', type: 'select', options: ['Submitted', 'Approved', 'Declined'] }, { name: 'Approval level', type: 'text' },
      ] } },
      { key: 'line_items', kind: 'data_table', role: 'child', name: `Line items${stamp}`, summary: 'Request → Purchase requests, Request id, Item, Quantity, Unit price', args: { columns: [
        { name: 'Request', type: 'lookup', required: true, lookup: { sourceTableId: '{{ref:requests.id}}', sourceColumn: 'reference' } }, { name: 'Request id', type: 'text' },
        { name: 'Item', type: 'text', required: true }, { name: 'Quantity', type: 'number', required: true }, { name: 'Unit price', type: 'number' },
      ] } },
      { key: 'thresholds', kind: 'decision_table', role: 'rule', name: `Approval thresholds${stamp}`, summary: 'Total ≤ 1,000 → Manager; over → Finance', args: {
        inputs: [{ key: 'total', label: 'Total', type: 'number' }], outputs: [{ key: 'approval_level', label: 'Approval level', type: 'text' }],
        rules: [
          { label: 'Up to 1,000', conditions: [{ inputKey: 'total', operator: 'less_than_or_equal', value: 1000 }], outputs: { approval_level: 'Manager' } },
          { label: 'Over 1,000', conditions: [], outputs: { approval_level: 'Finance' } },
        ],
      } },
      { key: 'start_form', kind: 'form', role: 'start', name: `Purchase request${stamp}`, summary: 'Title, category (lookup), justification, line items (inputs + Add item → a List with a total)', args: { available_in_menu: true, layout: { rules: [
        { id: 'r_add_item', name: 'Add item to the list', event: 'button_click', target: 'add_item', then: [{ type: 'add_list_row', list_field: 'line_items', values: { item: '{{line_items_item}}', quantity: '{{line_items_quantity}}', unit_price: '{{line_items_unit_price}}' }, require: ['line_items_item', 'line_items_quantity'] }] },
      ] }, fields: [
        { key: 'title', label: 'What are you buying?', type: 'text', required: true },
        { key: 'category', label: 'Category', type: 'lookup', required: true, help_text: 'Start typing, then pick a category', lookup: { source: 'table', table_id: '{{ref:categories.id}}', search_columns: ['name'], display_columns: ['name'], value_column: 'name' } },
        { key: 'justification', label: 'Justification', type: 'textarea' },
        { key: 'line_items_item', label: 'Item', type: 'text' },
        { key: 'line_items_quantity', label: 'Quantity', type: 'number', min: 1, default: '1' },
        { key: 'line_items_unit_price', label: 'Unit price', type: 'currency', currency: 'NZD' },
        { key: 'add_item', label: 'Add item', type: 'button', button: { style: 'primary', icon: 'plus', actions: [] } },
        { key: 'line_items', label: 'Line items', type: 'list', required: true, list: { columns: [
          { key: 'item', label: 'Item', type: 'text', required: true }, { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1 },
          { key: 'unit_price', label: 'Unit price', type: 'currency', currency: 'NZD' }, { key: 'total', label: 'Total', type: 'calculated', formula: 'quantity * unit_price', currency: 'NZD' },
        ], totals: [{ column: 'total', fn: 'sum' }], max_rows: 50 } },
      ] } },
      { key: 'manager_form', kind: 'form', role: 'task', name: `Manager approval${stamp}`, summary: 'Request, total (read-only), comment', args: taskForm('manager') },
      { key: 'finance_form', kind: 'form', role: 'task', name: `Finance approval${stamp}`, summary: 'Request, total (read-only), comment', args: taskForm('finance') },
      { key: 'admin_categories', kind: 'form', role: 'admin', name: `Manage categories${stamp}`, summary: 'Editable grid on Categories; Save mirrors the changes', args: {
        available_in_menu: false,
        fields: [{ key: 'rows', label: 'Categories', type: 'data_table', data_table: { source: 'table', mode: 'edit', table_id: '{{ref:categories.id}}', allow_add: true, allow_delete: true, key_column: 'row_id', columns: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'active', label: 'Active', type: 'boolean' }] } }],
        buttons: [{ id: 'save', label: 'Save changes', kind: 'submit', style: 'primary', actions: [
          { type: 'apply_table_changes', table_changes: { field: 'rows', target: 'table', table_id: '{{ref:categories.id}}', operation: 'auto', match_column: 'row_id', match_value: '{{key}}', mapping: { name: '{{row.name}}', active: '{{row.active}}' } } },
          { type: 'message', text: 'Saved: {{table_changes_summary}}' },
        ] }],
      } },
      { key: 'workflow', kind: 'workflow', role: 'process', name: `Purchase request approval${stamp}`, summary: 'Submit → save request + line items → thresholds → manager (→ finance over 1,000) → record → email', args: { trigger_type: 'form_submitted', nodes: [
        { id: 'trigger', type: 'form_submitted', label: 'Purchase request submitted', config: { form_id: '{{ref:start_form.id}}', form_name: '{{ref:start_form.name}}' } },
        { id: 'save_request', type: 'update_data_table', label: 'Save request', config: { table_id: '{{ref:requests.id}}', table_name: '{{ref:requests.name}}', operation: 'insert', column_values: { reference: '{{submission.reference}}', title: '{{form.title}}', requested_by: '{{submitted_by_name}}', category: '{{form.category}}', justification: '{{form.justification}}', total: '{{form.line_items_total_total}}', status: 'Submitted' }, output_row_id_var: 'parent_id' } },
        { id: 'lines', type: 'loop', label: 'Each line item', config: { items: '{{form.line_items}}', item_var: 'item', index_var: 'index' } },
        { id: 'add_line', type: 'update_data_table', label: 'Add line item', config: { table_id: '{{ref:line_items.id}}', table_name: '{{ref:line_items.name}}', operation: 'insert', column_values: { request: '{{submission.reference}}', request_id: '{{parent_id}}', item: '{{item.item}}', quantity: '{{item.quantity}}', unit_price: '{{item.unit_price}}' }, output_row_id_var: 'line_row_id' } },
        { id: 'thresholds', type: 'decision_table', label: 'Approval thresholds', config: { decision_table_id: '{{ref:thresholds.id}}', decision_table_name: '{{ref:thresholds.name}}', input_mappings: { total: '{{form.line_items_total_total}}' } } },
        { id: 'manager', type: 'user_task', label: 'Manager approval', config: task('Approve purchase', 'manager_form') },
        { id: 'route', type: 'condition', label: 'Needs Finance?', config: { branches: [{ label: 'Finance', logic: 'and', rules: [{ field: '{{approval_level}}', operator: 'equals', value: 'Finance' }] }], has_else: true } },
        { id: 'finance', type: 'user_task', label: 'Finance approval', config: task('Finance approval', 'finance_form') },
        { id: 'approved', type: 'update_data_table', label: 'Record approval', config: { table_id: '{{ref:requests.id}}', table_name: '{{ref:requests.name}}', operation: 'update', row_id: '{{parent_id}}', column_values: { status: 'Approved', approval_level: '{{approval_level}}' } } },
        { id: 'declined', type: 'update_data_table', label: 'Record decline', config: { table_id: '{{ref:requests.id}}', table_name: '{{ref:requests.name}}', operation: 'update', row_id: '{{parent_id}}', column_values: { status: 'Declined', approval_level: '{{approval_level}}' } } },
        { id: 'notify', type: 'send_email', label: 'Tell the requester', config: { to: '{{submitted_by_email}}', subject: 'Purchase request {{submission.reference}}: {{outcome}}', body: '<p>Your request “{{form.title}}” was {{outcome}}.</p><p>{{outcome_notes}}</p>' } },
      ], edges: [
        { source: 'trigger', target: 'save_request' }, { source: 'save_request', target: 'lines' },
        { source: 'lines', target: 'add_line', label: 'Each item' }, { source: 'lines', target: 'thresholds', label: 'Done' },
        { source: 'thresholds', target: 'manager' },
        { source: 'manager', target: 'route', label: 'Approve' }, { source: 'manager', target: 'declined', label: 'Decline' },
        { source: 'route', target: 'finance', label: 'Finance' }, { source: 'route', target: 'approved', label: 'Else' },
        { source: 'finance', target: 'approved', label: 'Approve' }, { source: 'finance', target: 'declined', label: 'Decline' },
        { source: 'approved', target: 'notify' }, { source: 'declined', target: 'notify' },
      ] } },
      { key: 'requests_report', kind: 'report', role: 'summary', name: `Purchase requests${stamp}`, summary: 'Count, by status, by category, over time, spend', args: { category: `Purchase requests${stamp}`, config: {
        data_source: '{{ref:requests.source}}', columns: ['data_reference', 'data_title', 'data_category', 'data_total', 'data_status', 'created_at'], visualization: 'table', sort: { field: 'created_at', direction: 'desc' },
        charts: [
          { id: 'count', title: 'Requests', type: 'number', measure: { fn: 'count' } },
          { id: 'by_status', title: 'By status', type: 'donut', dimension: { field: 'data_status' }, measure: { fn: 'count' } },
          { id: 'by_category', title: 'Spend by category', type: 'bar', dimension: { field: 'data_category' }, measure: { fn: 'sum', field: 'data_total' } },
          { id: 'over_time', title: 'Requests over time', type: 'column', dimension: { field: 'created_at', bucket: 'week' }, measure: { fn: 'count' }, range_days: 90 },
        ],
      } } },
      { key: 'lines_report', kind: 'report', role: 'summary', name: `Line items${stamp}`, summary: 'Top items by quantity', args: { category: `Purchase requests${stamp}`, config: {
        data_source: '{{ref:line_items.source}}', columns: ['data_request', 'data_item', 'data_quantity', 'data_unit_price', 'created_at'], visualization: 'table',
        charts: [{ id: 'top_items', title: 'Top items', type: 'bar', dimension: { field: 'data_item' }, measure: { fn: 'sum', field: 'data_quantity' }, top_n: 10 }],
      } } },
    ],
    package: { name: `Purchase requests${stamp}`, description: 'Purchase requests with line items, a categories admin form, approval thresholds, the approval workflow and reports' },
  }
}
