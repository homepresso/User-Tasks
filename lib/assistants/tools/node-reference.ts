/**
 * workflow_node_reference: the canonical config of the node types (and item
 * kinds) the Agent is about to build with — so it never reads existing
 * workflows to learn the format (in production one "build this process"
 * request spent its whole 400k-token budget reading the catalog and three
 * full workflow definitions, and built nothing).
 *
 * For each requested node type: label, purpose, settings (config keys), what
 * validation requires, the variables it sets and one minimal example — from
 * lib/workflow-schema.ts NODE_CATALOG, lib/docs/node-docs.ts NODE_DOCS (the
 * hand-written reference behind /docs/workflows/nodes, typed per NodeType so a
 * new node cannot go undocumented) and lib/workflow-validation.ts
 * validateNode. For each requested item kind (form, data_table,
 * decision_table, report, workflow, custom_action, …): its create tool's full
 * argument schema with every help text — the tool list the model always sees
 * carries shortened descriptions (designer.ts trimSchema) pointing here.
 */
import { NODE_CATALOG, type NodeType } from '@/lib/workflow-schema'
import { NODE_DOCS } from '@/lib/docs/node-docs'
import { validateNode } from '@/lib/workflow-validation'
import type { AssistantToolDef } from '../engine'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments are JSON */

export const NODE_REFERENCE_TOOL = 'workflow_node_reference'

/** Item kinds → their create tool (the reference is that tool's full argument schema). */
export const ITEM_REFERENCE: Record<string, string> = {
  workflow: 'workflows_create',
  form: 'forms_create',
  data_table: 'data_tables_create',
  decision_table: 'decision_tables_create',
  report: 'reports_create',
  custom_action: 'workflow_activities_create',
  form_control: 'form_controls_create',
  email_template: 'email_templates_create',
  agent: 'agents_create',
}

/** The reference item kind for a tool name (forms_update → form), or null. */
export function referenceKindOf(tool: string): string | null {
  for (const [kind, create] of Object.entries(ITEM_REFERENCE)) {
    const prefix = create.replace(/_create$/, '')
    if (tool === create || tool.startsWith(`${prefix}_`)) return kind
  }
  return null
}

const WORKFLOW_SHAPE = 'A workflow: { name, trigger_type, nodes: [{ id, type, label, config }], edges: [{ source, target, label? }] } — the trigger node (type = trigger_type) first; positions are optional (laid out automatically). A condition / switch_case / user_task edge label must equal its branch label / case / outcome. Reference values with {{…}} as in the wiring guide.'

/** Markdown links and docs pointers out of a NODE_DOCS text. */
const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s*[—-]\s*see \/docs\/[\w/#-]+/g, '').replace(/\s*\(see \/docs\/[\w/#-]+\)/g, '')

/** The reference entry of one node type (null: unknown type). */
export function nodeReference(type: string): Record<string, unknown> | null {
  const node = NODE_CATALOG.find((n) => n.type === type)
  if (!node) return null
  const doc = NODE_DOCS[node.type as NodeType]
  let required: string[] = []
  try { required = validateNode({ id: 'ref', type: node.type as NodeType, label: node.label, position: { x: 0, y: 0 }, config: {} }) } catch { required = [] }
  return {
    type: node.type,
    label: node.label,
    category: node.category,
    purpose: node.description,
    settings: plain(doc?.settings ?? ''),
    ...(required.length ? { required: required.slice(0, 8) } : {}),
    ...(doc?.outputs ? { sets: plain(doc.outputs) } : {}),
    ...(doc?.example ? { example: { id: node.type.replace(/_/g, '-'), type: node.type, label: node.label, config: node.type === 'user_task' ? { ...doc.example, allow_redirect: true } : doc.example } } : {}),
    ...(node.type === 'user_task' ? { agent_defaults: 'allow_redirect: true (the assignee may redirect the task) on every User Task you create, unless the person asked for no redirect (then false).' } : {}),
  }
}

/**
 * Solution patterns (the Solution blueprint's shapes, compact): how the
 * platform expresses parent / child tables, config lookups, a line-items
 * List with its Add rule (the legacy grid for existing forms), admin forms,
 * the child-row loop, report charts and packaging.
 */
export const SOLUTION_PATTERNS: Record<string, unknown> = {
  parent_child: {
    about: 'A child table links to its parent with a lookup column holding the parent\'s title / reference value. Create the parent first; refer to it with {{ref:<parent key>.id}}.',
    parent: { kind: 'data_table', role: 'parent', args: { name: 'Purchase requests', columns: [{ name: 'Reference', type: 'text', required: true }, { name: 'Title', type: 'text', required: true }, { name: 'Total', type: 'number' }, { name: 'Status', type: 'select', options: ['Submitted', 'Approved', 'Declined'] }] } },
    child: { kind: 'data_table', role: 'child', args: { name: 'Line items', columns: [{ name: 'Request', type: 'lookup', required: true, lookup: { sourceTableId: '{{ref:requests.id}}', sourceColumn: 'reference' } }, { name: 'Request id', type: 'text' }, { name: 'Item', type: 'text', required: true }, { name: 'Quantity', type: 'number' }, { name: 'Unit price', type: 'number' }] } },
  },
  config_lookup: {
    about: 'A config table admins maintain, looked up from forms (the stored value is value_column).',
    table: { kind: 'data_table', role: 'config', args: { name: 'Categories', columns: [{ name: 'Name', type: 'text', required: true }, { name: 'Active', type: 'boolean' }] } },
    field: { key: 'category', label: 'Category', type: 'lookup', required: true, help_text: 'Start typing, then pick a category', lookup: { source: 'table', table_id: '{{ref:categories.id}}', search_columns: ['name'], display_columns: ['name'], value_column: 'name', filters: [{ column: 'active', operator: 'eq', value: 'true' }] } },
  },
  list_field: {
    about: 'Child rows entered on the application form (several lists per form are fine, each with its own inputs, button and rule): a List field (type list — the rows live in the submission, an array of row objects) shown as a list view, one input field per column, an "Add item" button field, and a form rule on the button\'s click: add_list_row maps each column to its input ({{<input key>}}), checks required inputs / column types / max_rows, appends the row and clears the inputs. remove_list_row { list_field, row: last|first|<n> } and clear_list { list_field } also exist. The workflow gets {{form.<list>}} (loop over it), {{form.<list>_count}} and {{form.<list>_total_<column>}} per sum total. A column of type lookup ({ lookup: { source: table, table_id, display_columns, value_column } } or an API reference) stores the chosen value and <column>_label ({{item.product}}, {{item.product_label}}); its filters may read the same row ({{row.<column>}}). Editing rows already in the list: list.row_buttons [{ id: "edit", label: "Edit" }] + a rule { event: "list_row_button", if event.button eq "edit", then: [{ type: "edit_list_row", list_field, row: "{{event.row_number}}", assign: { <input>: "{{row.<column>}}" } }] } — the next add_list_row then updates that row; cancel_list_edit { list_field, fields } resets the inputs. Row selection: list.selectable "single" | "multiple" (click / checkboxes); rules read {{form.<list>_selected}}, {{form.<list>_selected_row.<column>}}, {{form.<list>_selected_count}}; remove_list_row / edit_list_row / update_list_row take row: "selected" (with empty_text when nothing is selected), remove_list_row and clear_list take confirm_text ("Delete {{count}} rows?"); a button field\'s button.requires_selection: <list> keeps it disabled until a row is selected; a table step with each_selected: <list> runs once per selected row ({{row.<column>}}). Events list_row_select and list_selection_change. Editable table rules (a List or an editable Data table, field: <key>): new_row { field, position?: end|start|after_selected, values? } makes a pending row with the columns\' defaults and the current row ({{form.<field>_current_row.<column>}}, {{form.<field>_current_index}}); set_row_values { field, row: current|selected|<n>|{{event.row_number}}, row_key?, values: { <column>: <template> } }; commit_row { field, row, commit_mode?: stage|save_now (Data table: writes the row at once, {{result.id}}), on_failure: [...] } checks the row (cells show errors); discard_row / revert_row; delete_row { field, row: selected, confirm_text, commit_mode? }; refresh_table { field, keep_pending?: ask }; open_row_form { field, row: current | selected | new | <n>, child?, parent_row? } opens a row as a form in a dialog. list.row_editing inline | popout | both (default both: cells in place plus an Open row icon and Add in form; the pop-out is one column on phones, two on wider screens; phones use it whenever allowed); list.row_form { title: "Expense: {{row.description}}", layout: [{ section: "Cost" }, { column: "amount" }], hide_view_icon? } — read-only Lists (submissions, completed tasks) show View row unless hidden. list.on_submit_pending block (default) | exclude | commit; list.row_commit_controls shows ✓ / ✕. Events row_created, row_values_changed, row_committed, row_commit_failed, cell_change. A column read_only: true is "read-only when editing": rows already in the list keep it (inline cells, Edit-row inputs and set_row_values / update_list_row leave it alone) — set it in new_row values or the column default; list.key_column lets the server keep stored read-only values of rows the form opened with.',
    fields: [
      { key: 'line_items_item', label: 'Item', type: 'text' },
      { key: 'line_items_quantity', label: 'Quantity', type: 'number', min: 1, default: '1' },
      { key: 'line_items_unit_price', label: 'Unit price', type: 'currency', currency: 'NZD' },
      { key: 'add_item', label: 'Add item', type: 'button', button: { style: 'primary', icon: 'plus', actions: [] } },
      { key: 'line_items', label: 'Line items', type: 'list', required: true, list: { columns: [
        { key: 'item', label: 'Item', type: 'text', required: true },
        { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1 },
        { key: 'unit_price', label: 'Unit price', type: 'currency', currency: 'NZD' },
        { key: 'total', label: 'Total', type: 'calculated', formula: 'quantity * unit_price', currency: 'NZD' },
      ], totals: [{ column: 'total', fn: 'sum' }], max_rows: 50 } },
    ],
    layout: { rules: [{ id: 'r_add_item', name: 'Add item to the list', event: 'button_click', target: 'add_item', then: [
      { type: 'add_list_row', list_field: 'line_items', values: { item: '{{line_items_item}}', quantity: '{{line_items_quantity}}', unit_price: '{{line_items_unit_price}}' }, require: ['line_items_item', 'line_items_quantity'] },
    ] }] },
    total_note: 'The total is {{form.line_items_total_total}} in the workflow (worked out on the server); no Label needed.',
  },
  child_rows_from_list: {
    about: 'In the main workflow: insert the parent row (output_row_id_var "parent_id"), then one child row per List row. Body edge label "Each item", then "Done". In the body {{item.<column>}} and {{index}} (0-based) work.',
    nodes: [
      { id: 'save_request', type: 'update_data_table', label: 'Save request', config: { table_id: '{{ref:requests.id}}', table_name: '{{ref:requests.name}}', operation: 'insert', column_values: { reference: '{{submission.reference}}', title: '{{form.title}}', total: '{{form.line_items_total_total}}' }, output_row_id_var: 'parent_id' } },
      { id: 'lines', type: 'loop', label: 'Each line item', config: { items: '{{form.line_items}}', item_var: 'item', index_var: 'index' } },
      { id: 'add_line', type: 'update_data_table', label: 'Add line item', config: { table_id: '{{ref:line_items.id}}', table_name: '{{ref:line_items.name}}', operation: 'insert', column_values: { request: '{{submission.reference}}', request_id: '{{parent_id}}', item: '{{item.item}}', quantity: '{{item.quantity}}', unit_price: '{{item.unit_price}}' }, output_row_id_var: 'line_row_id' } },
    ],
    edges: [{ source: 'save_request', target: 'lines' }, { source: 'lines', target: 'add_line', label: 'Each item' }, { source: 'lines', target: 'thresholds', label: 'Done' }],
  },
  repeating_section: {
    about: 'Card-style multi-entry (InfoPath repeating section): prefer a Repeating section when each entry is a small form of its own (several controls, dropdowns bound to a table, files, notes); prefer a List for tabular rows. Field type repeating_section with repeating_section { fields [any controls but data_table / custom / signature — inner keys unique over the whole form], layout { rows [{ columns, cells [{ field_key: <inner key>, span }] }], rules? [rules run per item: {{item.<key>}} / {{row.<key>}} the item, {{parent.<key>}} the outer item, {{form.<key>}} the form] }, add_label, item_title ("Expense {{index}}: {{item.description}}"), min_items?, max_items? (default 50), start_items?, confirm_remove?, totals [{ field, fn: sum|avg|count }] }. A dropdown inside an item can cascade on another control of the same item (dynamic.options base_filter value "{{item.country}}"). The value is the List shape — an array of items; the run gets {{form.<key>}}, {{form.<key>_count}}, {{form.<key>_total_<field>}}. Save each item to a table: a Loop over {{form.<key>}} with an update_data_table insert in its "Each item" branch ({{item.<field>}}, {{index}}); a nested section is looped inside it ({{parent_item.*}} the outer item). The form\'s List rule actions and data / API outputs accept it as their List.',
    field: { key: 'expenses', label: 'Expenses', type: 'repeating_section', required: true, repeating_section: {
      fields: [
        { key: 'description', label: 'Description', type: 'text', required: true },
        { key: 'category', label: 'Category', type: 'choice', options: [], dynamic: { options: { kind: 'table', table_id: '{{ref:expense_categories.id}}', value: 'name', open_access: true, base_filter: { match: 'all', conditions: [{ column: 'country', operator: 'eq', value: '{{item.country}}' }] } } } },
        { key: 'country', label: 'Country', type: 'choice', options: ['US', 'CA'], default: 'US' },
        { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD', required: true },
        { key: 'spent_on', label: 'Date', type: 'date', default: '{{today}}' },
        { key: 'receipt', label: 'Receipt', type: 'attachments' },
      ],
      layout: { rows: [
        { columns: 3, cells: [{ field_key: 'description', span: 2 }, { field_key: 'spent_on', span: 1 }] },
        { columns: 3, cells: [{ field_key: 'country', span: 1 }, { field_key: 'category', span: 1 }, { field_key: 'amount', span: 1 }] },
        { columns: 1, cells: [{ field_key: 'receipt', span: 1 }] },
      ], rules: [{ id: 'receipt_over_75', event: 'always', if: { match: 'all', conditions: [{ column: 'item.amount', operator: 'gt', value: '75' }, { column: 'item.receipt', operator: 'is_not_set' }] }, then: [{ type: 'field_error', field: 'receipt', text: 'Attach a receipt over USD 75' }] }] },
      add_label: 'Add expense', item_title: 'Expense {{index}}: {{item.description}}', min_items: 1, start_items: 1, totals: [{ field: 'amount', fn: 'sum' }],
    } },
    nodes: [
      { id: 'each', type: 'loop', label: 'Each expense', config: { items: '{{form.expenses}}', item_var: 'item', index_var: 'index' } },
      { id: 'save', type: 'update_data_table', label: 'Save expense', config: { table_id: '{{ref:expense_lines.id}}', table_name: '{{ref:expense_lines.name}}', operation: 'insert', column_values: { description: '{{item.description}}', category: '{{item.category}}', amount: '{{item.amount}}', spent_on: '{{item.spent_on}}', line_no: '{{index}}' } } },
    ],
    edges: [{ source: 'each', target: 'save', label: 'Each item' }],
  },
  nested_list: {
    about: 'Rows inside rows (orders → lines): a List column of type list holds a nested List ({ columns, totals?, min_rows?, max_rows? }; at most 3 levels). The value nests: [{ customer, lines: [{ sku, qty, price, amount }], lines_count, lines_total_amount }]; the run also gets {{form.orders_lines_count}} (all lines), {{form.orders_lines_counts}} (per order) and {{form.orders_total_lines_amount}}. On the form each order row expands to an editable table of its lines. List rule steps take child: "lines" and parent_row: current|selected|first|last|<n>|{{event.row_number}} ({{row.*}} = the line, {{parent.*}} = the order). In the workflow: Loop over {{form.orders}}, and in its "Each item" branch a Loop over {{item.lines}} — inside it {{item.*}} is the line and {{parent_item.*}} the order ({{parent_index}} its position); after the inner loop ("Done") {{item}} is the order again. Distinct item_var names (order / line) work too.',
    field: { key: 'orders', label: 'Orders', type: 'list', required: true, list: { entry_mode: 'inline', columns: [
      { key: 'customer', label: 'Customer', type: 'text', required: true },
      { key: 'lines', label: 'Lines', type: 'list', required: true, list: { columns: [
        { key: 'sku', label: 'SKU', type: 'text', required: true },
        { key: 'qty', label: 'Qty', type: 'number', min: 1, default: '1' },
        { key: 'price', label: 'Price', type: 'currency', currency: 'USD' },
        { key: 'amount', label: 'Amount', type: 'calculated', formula: 'qty * price', currency: 'USD' },
      ], totals: [{ column: 'amount', fn: 'sum' }] } },
    ] } },
    nodes: [
      { id: 'orders', type: 'loop', label: 'Each order', config: { items: '{{form.orders}}', item_var: 'item', index_var: 'index' } },
      { id: 'lines', type: 'loop', label: 'Each line', config: { items: '{{item.lines}}', item_var: 'item', index_var: 'line_index' } },
      { id: 'add_line', type: 'update_data_table', label: 'Add order line', config: { table_id: '{{ref:order_lines.id}}', table_name: '{{ref:order_lines.name}}', operation: 'insert', column_values: { customer: '{{parent_item.customer}}', sku: '{{item.sku}}', qty: '{{item.qty}}', amount: '{{item.amount}}' } } },
    ],
    edges: [{ source: 'orders', target: 'lines', label: 'Each item' }, { source: 'lines', target: 'add_line', label: 'Each item' }],
  },
  rule_data_actions: {
    about: 'Form rules that read / write data or call an API, usually on a Button field\'s click (event button_click, target the button key) or a field change (value_change). Steps run on the server from the saved form. table_read { table_id, row_id | filter }, table_list { table_id, filter { match, conditions [{ column, operator eq|neq|gt|gte|lt|lte|like|ilike|starts_with|ends_with|is_null|not_null|in, value }] }, sort [{ column, direction }], limit }, table_create { table_id, column_values }, table_update { table_id, row_id | filter, column_values }, table_delete { table_id, row_id, confirm_text? }, call_reference { reference_id, inputs, wait? (false = fire and forget), timeout_ms?, rows_path? + filter / sort / limit on the response rows }. Values / inputs: {{form.x}}, {{row.x}} (a List row button), {{var.x}}, {{param.x}}, {{user.id|email|name}}, {{today}}. outputs [{ path, to }] write the result into a field, a Label, a read-only field, var.<name>, a List (to: <list key>, columns { <column>: <item path> }, mode replace|append) or a choice\'s options (as: "options", value_path, label_path). A list result into ONE value uses the first row only (TOP 1): pin the row with a filter (row_id eq …) or sort + limit 1. on_success / on_failure: steps after it ({{result.*}}, {{error.message}}). open_access: true lets people without data permissions use the step; allow_anonymous for public forms.',
    lookup_customer: { fields: [{ key: 'email', label: 'Email', type: 'email' }, { key: 'find_customer', label: 'Find customer', type: 'button', button: { style: 'secondary', icon: 'eye', actions: [] } }, { key: 'customer_name', label: 'Customer', type: 'text', read_only: true }, { key: 'address', label: 'Address', type: 'textarea' }],
      layout: { rules: [{ id: 'r_find_customer', name: 'Find the customer in the CRM', event: 'button_click', target: 'find_customer', then: [{ type: 'call_reference', reference_id: '<CRM reference id>', inputs: { email: '{{form.email}}' }, outputs: [{ path: 'customer.name', to: 'customer_name' }, { path: 'customer.address', to: 'address' }], on_failure: [{ type: 'message', text: 'No customer with {{form.email}}: {{error.message}}', tone: 'warning' }] }] }] } },
    load_products: { layout: { rules: [{ id: 'r_load_products', name: 'Load the products', event: 'form_load', then: [{ type: 'table_list', table_id: '{{ref:products.id}}', table_name: '{{ref:products.name}}', filter: { match: 'all', conditions: [{ column: 'active', operator: 'eq', value: 'true' }] }, sort: [{ column: 'name', direction: 'asc' }], limit: 100, open_access: true, outputs: [{ path: '', to: 'products', columns: { sku: 'sku', name: 'name', price: 'price', product_id: 'row_id' } }] }] }] } },
  },
  cascading_options: {
    about: 'Cascading drop-downs (Country → State → City): give each dependent choice field a dynamic options binding that reads its parent — dynamic.options { kind: "table", table_id, value, label, base_filter { conditions [{ column: <parent column>, operator: "eq", value: "{{form.<parent key>}}" }] }, sort } or { kind: "reference", reference_id, input_mappings { <input>: "{{form.<parent key>}}" }, results_path, value, label }. It refreshes when the parent changes, shows "Loading options…" meanwhile, clears a child value the new options no longer offer (a saved valid one is kept), and offers nothing while the parent is empty (when_inputs_blank: "keep" keeps the options). An autocomplete (type lookup) cascades through its own source the same way (lookup.filters value "{{task_data.<parent>}}" / input_mappings). Alternative with rules: value_change on the parent → call_reference / table_list with outputs [{ path, to: <child>, as: "options", value_path, label_path }].',
    fields: [
      { key: 'country', label: 'Country', type: 'choice', dynamic: { options: { kind: 'table', table_id: '{{ref:countries.id}}', value: 'code', label: 'name', sort: [{ column: 'name', direction: 'asc' }] } } },
      { key: 'state', label: 'State', type: 'choice', dynamic: { options: { kind: 'table', table_id: '{{ref:states.id}}', value: 'code', label: 'name', base_filter: { match: 'all', conditions: [{ column: 'country', operator: 'eq', value: '{{form.country}}' }] } } } },
      { key: 'city', label: 'City', type: 'choice', dynamic: { options: { kind: 'table', table_id: '{{ref:cities.id}}', value: 'name', label: 'name', base_filter: { match: 'all', conditions: [{ column: 'state', operator: 'eq', value: '{{form.state}}' }] } } } },
    ],
  },
  line_items_grid: {
    about: 'LEGACY — only for editing an existing form that already has an editable grid; new child rows use list_field. Child rows entered on the application form: an editable Data table field on the child table that starts empty; its value is { added, updated, deleted } → the workflow inserts form.<key>.added.',
    field: { key: 'line_items', label: 'Line items', type: 'data_table', data_table: { source: 'table', mode: 'edit', table_id: '{{ref:line_items.id}}', allow_add: true, allow_delete: true, key_column: 'row_id', columns: [{ key: 'item', label: 'Item', type: 'text', required: true }, { key: 'quantity', label: 'Quantity', type: 'number', required: true }, { key: 'unit_price', label: 'Unit price', type: 'number', format: { kind: 'currency' } }], base_filter: { match: 'all', conditions: [{ column: 'request', operator: 'is_not_set' }] } } },
    total: { key: 'total', label: 'Total', type: 'label', label_config: { expression: 'SUMPRODUCT(control.line_items.rows, "quantity", "unit_price")', format: { kind: 'currency' }, include: true } },
  },
  admin_form: {
    about: 'Manage a config table: an editable grid on it, and the Submit button mirrors the changes back (insert added, update changed, delete deleted). Keep it out of the menu; share it with admins.',
    args: { name: 'Manage categories', available_in_menu: false, fields: [{ key: 'rows', label: 'Categories', type: 'data_table', data_table: { source: 'table', mode: 'edit', table_id: '{{ref:categories.id}}', allow_add: true, allow_delete: true, key_column: 'row_id', columns: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'active', label: 'Active', type: 'boolean' }] } }], buttons: [{ id: 'save', label: 'Save changes', kind: 'submit', style: 'primary', actions: [{ type: 'apply_table_changes', table_changes: { field: 'rows', target: 'table', table_id: '{{ref:categories.id}}', operation: 'auto', match_column: 'row_id', match_value: '{{key}}', mapping: { name: '{{row.name}}', active: '{{row.active}}' } } }, { type: 'message', text: 'Saved: {{table_changes_summary}}' }] }] },
  },
  child_rows_loop: {
    about: 'LEGACY (forms with an editable line_items_grid; new builds use child_rows_from_list). In the main workflow, after inserting the parent row: one child row per added grid line. Body edge label "Each item", then "Done".',
    nodes: [
      { id: 'lines', type: 'loop', label: 'Each line item', config: { items: '{{form.line_items.added}}', item_var: 'line' } },
      { id: 'add_line', type: 'update_data_table', label: 'Add line item', config: { table_id: '{{ref:line_items.id}}', table_name: '{{ref:line_items.name}}', operation: 'insert', column_values: { request: '{{submission.reference}}', item: '{{line.item}}', quantity: '{{line.quantity}}', unit_price: '{{line.unit_price}}' }, output_row_id_var: 'line_row_id' } },
    ],
    edges: [{ source: 'save_request', target: 'lines' }, { source: 'lines', target: 'add_line', label: 'Each item' }, { source: 'lines', target: 'thresholds', label: 'Done' }],
  },
  image_field: {
    about: 'A picture the person provides (type image): one file object (not a list) uploaded like an attachment — checked by content, GPS / EXIF metadata stripped. In the workflow {{form.<key>}} is that object: attach it to an email, pass it to Analyze Image or a file step. image { max_mb? (default 10, max 20), types? [png|jpeg|webp|gif], camera? (phone camera), default_file? { name, url } }. A static logo / picture in the layout is a display_image element instead (no value; alt text required).',
    fields: [
      { key: 'damage_photo', label: 'Photo of the damage', type: 'image', required: true, image: { max_mb: 10, types: ['jpeg', 'png'], camera: true } },
      { key: 'logo', label: 'Logo', type: 'display_image', display_image: { src: 'https://example.com/logo.png', alt: 'Acme Ltd logo', width: 'sm', align: 'left' } },
    ],
    email_attachment: { node: 'send_email', config: { attachments: '{{form.damage_photo}}' } },
  },
  signature_field: {
    about: 'An electronic signature (type signature; not a cryptographic digital signature): drawn or typed, stored as { file (PNG), method, typed_name?, signed_at, user_id?, user_name?, ip?, user_agent? } — the person, time and (capture_audit) IP / browser are set by the server. Put it last on the form with a statement; required = a signature must be present. resign_on_change clears it when other answers change after signing.',
    field: { key: 'signature', label: 'Signature', type: 'signature', required: true, signature: { mode: 'both', statement: 'I confirm the information above is correct.', capture_audit: true } },
    in_workflow: 'Signed by {{form.signature.user_name}} at {{form.signature.signed_at}}; the image is {{form.signature.file}} (attach it or place it in a Word template).',
  },
  text_controls: {
    about: 'Rich text, text lists and linked URLs. rich_text: formatted text stored as sanitised HTML (p, br, strong, em, u, s, ul, ol, li, h3, h4, blockquote, code, https / mailto links) with the plain text in {{form.<key>_text}} — use _text in conditions and plain e-mails. text_list: an array of strings (bulleted / numbered / plain), loop over it or join it. url + url_config shows link text in read-only views; the value stays the URL (http, https, mailto only). A plain textarea stays plain text.',
    fields: [
      { key: 'summary', label: 'Summary', type: 'rich_text', required: true, rich_text: { max_length: 5000, toolbar: 'basic' } },
      { key: 'next_actions', label: 'Next actions', type: 'text_list', text_list: { style: 'numbered', max_items: 10 } },
      { key: 'contract_name', label: 'Contract name', type: 'text' },
      { key: 'contract_url', label: 'Contract link', type: 'url', url_config: { text_field: 'contract_name', new_tab: true } },
    ],
    in_workflow: 'Condition on {{form.summary_text}}; loop over {{form.next_actions}} ({{item}} is one item).',
  },
  people_picker: {
    about: 'A person / group picker: type user with user_config { multiple?, allow_teams?, max? }. Without multiple / allow_teams the value is one user id (unchanged). With either it is an array of { kind: user|team, id, name } — ids checked against the workspace and names set by the server. Loop over it to assign one task per pick, or use {{item.id}} with {{item.kind}}. multi_choice display: checkboxes | listbox (InfoPath multiple-selection list box).',
    fields: [
      { key: 'reviewers', label: 'Reviewers', type: 'user', required: true, user_config: { multiple: true, allow_teams: true, max: 5 } },
      { key: 'regions', label: 'Regions', type: 'multi_choice', options: ['North', 'South', 'East', 'West'], display: 'listbox' },
    ],
  },
  form_logic: {
    about: 'Form logic without code (InfoPath-style): (1) a choice group — layout.choice_groups [{ key, label, sections: [2-6 section keys on one page], default?, display? radio|tabs|dropdown }]: one alternative section shows at a time; the chosen section key is submitted as <key> ({{form.<key>}} in rules, set_values can pick one, value_change target <key> reacts); the others\' fields are not required and stored empty. (2) List validations — a column\'s validations [{ if, message }] (error on the cell) and list.row_validations [{ if, message, column? }] (error on the row); subjects row.<column>, parent.<column> (nested List), form.<field>, user.roles; checked in the browser and on the server (errors like orders[1].lines[0].qty). (3) Roles / teams — conditions on user.roles / user.teams (the person\'s role and team names and ids): operator contains = has the role, neq = has not; the server judges them with its own view of the person. (4) Cross-field checks — an always / before_submit rule with field_error / block_submit (re-checked on the server).',
    fields: [
      { key: 'amount', label: 'Amount (USD)', type: 'currency', currency: 'USD', required: true },
      { key: 'card_number', label: 'Card number', type: 'text', required: true },
      { key: 'iban', label: 'IBAN', type: 'text', required: true },
      { key: 'lines', label: 'Lines', type: 'list', list: { entry_mode: 'inline', display: 'cards', columns: [
        { key: 'item', label: 'Item', type: 'text', required: true },
        { key: 'qty', label: 'Qty', type: 'number', validations: [{ if: { match: 'all', conditions: [{ column: 'row.qty', operator: 'gt', value: '100' }] }, message: 'At most 100 per line' }] },
        { key: 'price', label: 'Price', type: 'currency', currency: 'USD' },
        { key: 'total', label: 'Total', type: 'calculated', formula: 'qty * price', currency: 'USD' },
      ], row_validations: [{ if: { match: 'all', conditions: [{ column: 'row.total', operator: 'gt', value: '5000' }, { column: 'user.roles', operator: 'neq', value: 'Manager' }] }, message: 'Lines over $5,000 need a manager', column: 'total' }] } },
    ],
    layout: {
      rows: [
        { columns: 1, cells: [{ field_key: 'amount', span: 1 }] },
        { columns: 1, cells: [{ field_key: 'card_number', span: 1 }], section: 'card' },
        { columns: 1, cells: [{ field_key: 'iban', span: 1 }], section: 'bank' },
        { columns: 1, cells: [{ field_key: 'lines', span: 1 }] },
      ],
      sections: [{ key: 'card', title: 'Card' }, { key: 'bank', title: 'Bank transfer' }],
      choice_groups: [{ key: 'payment', label: 'How will you pay?', sections: ['card', 'bank'], display: 'radio' }],
      rules: [{ id: 'r_big_amount', name: 'Large amounts need a manager', event: 'before_submit', if: { match: 'all', conditions: [{ column: 'amount', operator: 'gt', value: '10000' }, { column: 'user.roles', operator: 'neq', value: 'Manager' }] }, then: [{ type: 'field_error', field: 'amount', text: 'Amounts over $10,000 need a manager' }] }],
    },
  },
  conditional_styling: {
    about: 'Conditional styling (InfoPath conditional formatting) — theme tones, never CSS: an always rule with set_style { targets: ["field:<key>" | "section:<key>"], style: { tone? success|warning|danger|info|neutral|accent, background?, text?, bold?, italic?, underline?, strike?, border?, icon? } } styles its targets while the condition holds and drops it when it stops (set_style is for event always only; several rules on one target merge, the later wins per property). A List (any level) takes row_styles [{ if (row.<column>, parent.<column>, form.<field>, user.*), style, column? }] — the whole row, or only that column\'s cell. Presentation only: also drawn read-only (tasks, submissions, the row pop-out). Accessibility: don\'t rely on colour alone — add icon: true (announced: Alert, Warning, OK…) and bold.',
    fields: [
      { key: 'amount', label: 'Amount (USD)', type: 'currency', currency: 'USD', required: true },
      { key: 'expenses', label: 'Expenses', type: 'list', list: { entry_mode: 'inline', columns: [
        { key: 'description', label: 'Description', type: 'text', required: true },
        { key: 'status', label: 'Status', type: 'choice', options: ['Open', 'Paid', 'Rejected'] },
        { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD' },
      ], row_styles: [
        { if: { match: 'all', conditions: [{ column: 'row.amount', operator: 'gt', value: '1000' }] }, style: { tone: 'danger', background: true, icon: true } },
        { if: { match: 'all', conditions: [{ column: 'row.status', operator: 'eq', value: 'Paid' }] }, style: { tone: 'success', text: true, bold: true }, column: 'status' },
      ] } },
    ],
    layout: {
      rows: [{ columns: 1, cells: [{ field_key: 'amount', span: 1 }] }, { columns: 1, cells: [{ field_key: 'expenses', span: 1 }] }],
      rules: [
        { id: 'r_amount_high', name: 'Large amounts in red', event: 'always', if: { match: 'all', conditions: [{ column: 'amount', operator: 'gt', value: '5000' }] }, then: [{ type: 'set_style', targets: ['field:amount'], style: { tone: 'danger', background: true, text: true, bold: true, icon: true } }] },
        { id: 'r_amount_ok', name: 'Small amounts in green', event: 'always', if: { match: 'all', conditions: [{ column: 'amount', operator: 'lte', value: '500' }] }, then: [{ type: 'set_style', targets: ['field:amount'], style: { tone: 'success', text: true, icon: true } }] },
      ],
    },
  },
  report_charts: {
    about: 'A report per main table with summary charts (config may be an object in build_plan). A data table\'s report columns are data_<column key>, plus id, created_at and updated_at.',
    args: { name: 'Purchase requests', category: 'Purchase requests', config: { data_source: '{{ref:requests.source}}', columns: ['data_reference', 'data_title', 'data_category', 'data_total', 'data_status', 'created_at'], visualization: 'table', sort: { field: 'created_at', direction: 'desc' }, charts: [
      { id: 'count', title: 'Requests', type: 'number', measure: { fn: 'count' } },
      { id: 'by_status', title: 'By status', type: 'donut', dimension: { field: 'data_status' }, measure: { fn: 'count' } },
      { id: 'over_time', title: 'Over time', type: 'column', dimension: { field: 'created_at', bucket: 'week' }, measure: { fn: 'count' }, range_days: 90 },
      { id: 'by_category', title: 'Spend by category', type: 'bar', dimension: { field: 'data_category' }, measure: { fn: 'sum', field: 'data_total' } },
    ] } },
  },
  package: { about: 'build_plan package option, after the person chose "Package this solution": every created item becomes one package (1.0.0), registered for one-click uninstall.', example: { name: 'Purchase requests', description: 'Purchase requests with line items, category admin, approval thresholds and reports', share: false } },
}

/** The pattern names a request may ask for ("solution" = all of them but the legacy grid ones). */
export const PATTERN_NAMES = ['solution', ...Object.keys(SOLUTION_PATTERNS)]
const LEGACY_PATTERNS = new Set(['line_items_grid', 'child_rows_loop'])

/** The closest known node types for an unknown name (typo / guessed name). */
function suggestions(type: string): string[] {
  const t = type.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const parts = t.split('_').filter((p) => p.length > 2)
  return NODE_CATALOG.filter((n) => n.type.includes(t) || parts.some((p) => n.type.includes(p) || n.label.toLowerCase().includes(p))).map((n) => n.type).slice(0, 5)
}

export interface NodeReferenceDeps {
  /** The create tool's full model-facing argument schema and description (before trimming), or null when not offered. */
  itemSchema: (tool: string) => { description: string; parameters: Record<string, unknown> } | null
}

/** The reference payload for some node types and item kinds. */
export function buildReference(args: Record<string, any>, deps: NodeReferenceDeps): Record<string, unknown> {
  const types = (Array.isArray(args.types) ? args.types : typeof args.types === 'string' ? args.types.split(',') : []).map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 25)
  const items = (Array.isArray(args.items) ? args.items : typeof args.items === 'string' ? args.items.split(',') : []).map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 6)
  const patternNames = (Array.isArray(args.patterns) ? args.patterns : typeof args.patterns === 'string' ? args.patterns.split(',') : []).map((t: unknown) => String(t).trim()).filter(Boolean)
  const patterns: Record<string, unknown> = {}
  for (const p of patternNames.includes('solution') ? [...Object.keys(SOLUTION_PATTERNS).filter((k) => !LEGACY_PATTERNS.has(k)), ...patternNames.filter((k) => LEGACY_PATTERNS.has(k))] : patternNames) if (SOLUTION_PATTERNS[p]) patterns[p] = SOLUTION_PATTERNS[p]
  if (!types.length && !items.length && Object.keys(patterns).length) return { patterns }
  if (!types.length && !items.length) return { error: 'Pass `types` (node types, e.g. ["form_submitted", "user_task"]) and / or `items` (form, data_table, decision_table, report, workflow, custom_action) — workflows_catalog lists the node types.' }
  const nodes: Record<string, unknown>[] = []
  const unknown: Array<{ type: string; did_you_mean: string[] }> = []
  for (const t of [...new Set(types as string[])]) {
    const ref = nodeReference(t)
    if (ref) nodes.push(ref)
    else unknown.push({ type: t, did_you_mean: suggestions(t) })
  }
  const itemRefs: Record<string, unknown> = {}
  for (const kind of [...new Set(items as string[])]) {
    const tool = ITEM_REFERENCE[kind]
    const schema = tool ? deps.itemSchema(tool) : null
    itemRefs[kind] = schema ? { create_tool: tool, description: schema.description, arguments: schema.parameters } : { error: tool ? `You can't create ${kind.replace(/_/g, ' ')}s here` : `Unknown item kind: ${kind} (one of ${Object.keys(ITEM_REFERENCE).join(', ')})` }
  }
  return {
    ...(nodes.length ? { workflow_shape: WORKFLOW_SHAPE, nodes } : {}),
    ...(unknown.length ? { unknown_types: unknown } : {}),
    ...(items.length ? { items: itemRefs } : {}),
    ...(Object.keys(patterns).length ? { patterns } : {}),
  }
}

export function nodeReferenceTool(deps: NodeReferenceDeps): AssistantToolDef {
  return {
    name: NODE_REFERENCE_TOOL,
    description: 'The canonical format to build with: for each workflow node type, its config keys, required settings, the variables it sets and a minimal example; for each item kind (form, data_table, decision_table, report, workflow, custom_action), the full arguments of its create tool; solution patterns (parent / child tables, config lookups, child rows as a List field with an Add button rule, the child-row loop, admin forms, report charts, packaging). Use this instead of reading existing workflows / forms to learn the format. Ask only for what you will use.',
    parameters: {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'string' }, description: 'Node types (from workflows_catalog), e.g. ["form_submitted", "user_task", "update_data_table", "condition", "send_email"]' },
        items: { type: 'array', items: { type: 'string', enum: Object.keys(ITEM_REFERENCE) }, description: 'Item kinds whose create arguments you need, e.g. ["form", "data_table", "decision_table"]' },
        patterns: { type: 'array', items: { type: 'string', enum: PATTERN_NAMES }, description: 'Solution patterns (compact shapes): parent_child tables, config_lookup, list_field (child rows: inputs + Add button + add_list_row rule + List), child_rows_from_list (the workflow loop), nested_list (orders → lines: a List column of type list, the nested loop with parent_item), repeating_section (card-style multi-entry: any controls per item, per-item rules and cascades, the Loop that saves each item to a table — prefer it over a List for card-style entries, a List for tabular rows), rule_data_actions (buttons / rules that read, list, create, update, delete table rows or call an API reference, with outputs into fields, Lists and options), cascading_options (dependent drop-downs), image_field (a picture upload / a display image), signature_field (an electronic signature), form_logic (choice groups, List column / row validations, role and team conditions, cross-field checks), conditional_styling (set_style in always rules, List row_styles: colour fields, sections, rows and cells with theme tones), text_controls (rich text, text list, URL link text), people_picker (several people / teams, multi-select list box), admin_form, report_charts, package — "solution" for all; line_items_grid / child_rows_loop are legacy (editing existing grid forms only)' },
      },
    },
    mode: 'read',
    label: () => 'Reading the build reference',
    maxResultChars: 40_000,
    run: async (args) => {
      const result = buildReference(args, deps)
      return { result, ok: !('error' in result) }
    },
  }
}
