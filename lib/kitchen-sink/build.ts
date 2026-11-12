/**
 * The "Kitchen sink — platform self-test" workflow and its import bundle.
 *
 * One builder produces both shipped files (scripts/build-kitchen-sink.ts
 * writes them; __tests__/kitchen-sink.test.ts checks they match):
 *  - test-workflows/17-kitchen-sink.json — the canvas, run end to end by
 *    __tests__/test-workflows-run.test.ts on every release;
 *  - examples/kitchen-sink/kitchen-sink.bundle.json — a config manifest
 *    (format_version 3) with the workflow and everything it needs: a
 *    sub-workflow, a scratch data table, a decision table, a form, a role and
 *    a custom action. Workflows → Import (or POST /api/v1/config/apply, MCP
 *    config_apply, `usertasks config apply`) installs it in one go; the fixed
 *    UUIDs below are remapped to the new local ids and re-importing updates
 *    in place.
 *
 * The workflow runs every non-API step type (see KITCHEN_SINK_EXCLUDED for
 * the ones it leaves out and why). After each group an assertion step (Branch
 * by Condition, actual value vs the expected literal) records a failure into
 * the `failures` list; the summary sets the run title ("Kitchen sink: 74/74
 * passed"), builds a `results` object and ends the run as completed, or as
 * failed with the failed checks listed. Pure: no I/O (server / scripts only).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow configs are free-form JSON */

import { createHash } from 'node:crypto'

export const KITCHEN_SINK_NAME = 'Kitchen sink — platform self-test'
export const KITCHEN_SINK_SUB_NAME = 'Kitchen sink — sub-workflow'

/** Source ids of the bundled assets (remapped to local ids on import). */
export const KITCHEN_SINK_IDS = {
  workflow: '7c5e0001-0000-4000-8000-000000000001',
  subWorkflow: '7c5e0001-0000-4000-8000-000000000002',
  dataTable: '7c5e0002-0000-4000-8000-000000000001',
  decisionTable: '7c5e0003-0000-4000-8000-000000000001',
  form: '7c5e0004-0000-4000-8000-000000000001',
  role: '7c5e0005-0000-4000-8000-000000000001',
  customAction: '7c5e0006-0000-4000-8000-000000000001',
} as const

export const KITCHEN_SINK_DATA_TABLE_NAME = 'Kitchen sink scratch rows'
export const KITCHEN_SINK_DECISION_TABLE_NAME = 'Kitchen sink pricing rules'
export const KITCHEN_SINK_FORM_NAME = 'Kitchen sink human check'
export const KITCHEN_SINK_ROLE_NAME = 'Kitchen sink test role'
export const KITCHEN_SINK_ROLE_PERMISSION = 'reports.view'
export const KITCHEN_SINK_ACTION_KEY = 'kitchen_sink_double'

/**
 * Step types the kitchen sink does not run, with the reason. Every other
 * NODE_CATALOG type must appear in the workflow (__tests__/kitchen-sink.test.ts).
 */
export const KITCHEN_SINK_EXCLUDED: Record<string, string> = {
  // Triggers: a run has one; the kitchen sink starts from Run now (webhook_received).
  task_created: 'trigger — fired by task events, not by a self-test run',
  task_received: 'trigger — fired by task events, not by a self-test run',
  task_submitted: 'trigger — fired by task events, not by a self-test run',
  task_updated: 'trigger — fired by task events, not by a self-test run',
  task_completed: 'trigger — fired by task events, not by a self-test run',
  task_rejected: 'trigger — fired by task events, not by a self-test run',
  workflow_error: 'trigger — fired when another run fails',
  workflow_sla: 'trigger — fired by the SLA monitor',
  retention_policy_review: 'trigger — fired by the retention scheduler',
  retention_policy_executed: 'trigger — fired by the retention scheduler',
  form_submitted: 'trigger — fired by a form submission',
  data_table_event: 'trigger — fired by data table writes',
  middleware_received: 'trigger — synchronous webhook endpoint',
  schedule: 'trigger — fired by the scheduler (add one to run the self-test nightly; see docs)',
  esign_event: 'trigger — fired by an e-signature provider (external)',
  // External services / providers.
  http_request: 'calls an external URL',
  call_reference: 'calls an integration reference (external API)',
  live_reference: 'fetches from an integration reference (external API)',
  server_event: 'waits for an external system to call back (and may call out first)',
  run_agent: 'calls an AI model provider',
  media_transcribe: 'needs a media / AI provider',
  media_analyze_image: 'needs a media / AI provider',
  media_analyze_video: 'needs a media / AI provider',
  media_redact_image: 'needs a media / AI provider',
  media_redact_video: 'needs a media / AI provider',
  media_generate_image: 'needs a media / AI provider',
  media_tts: 'needs a media / AI provider',
  media_tools: 'needs FFmpeg media tooling (provider-backed in most deployments)',
  esign_send: 'sends to an e-signature provider (external)',
  esign_wait: 'waits on an e-signature provider (external)',
  esign_envelope: 'calls an e-signature provider (external)',
  // Needs a run that a task started.
  update_task: "writes the run's own triggering task; a Run now start has none (Create Subtask and Auto Action cover task writes)",
}

// ─── Builder primitives ────────────────────────────────────────────────

type Node = { id: string; type: string; label: string; position: { x: number; y: number }; config: Record<string, any>; onError?: 'continue'; sectionId?: string; collapsed?: boolean }
type Edge = { id: string; source: string; target: string; label?: string }
type Pending = { source: string; label?: string }

const X = 480
const X_FAIL = X + 360
const ROW = 120
/** Sections flow down a column; a new section starts the next column once a column is this tall. */
const COLUMN_HEIGHT = 5200
const COLUMN_PITCH = 1800

interface Check { id: string; group: string; label: string }

class Graph {
  nodes: Node[] = []
  edges: Edge[] = []
  checks: Check[] = []
  pending: Pending[] = []
  y = 40
  /** x offset of the current column. */
  private ox = 0
  private section: { node: Node; group: string; checks: number } | null = null
  private edgeCount = 0

  edge(source: string, target: string, label?: string) {
    this.edges.push({ id: `e${++this.edgeCount}`, source, target, ...(label ? { label } : {}) })
  }

  /** A node at (x, y) in the current section; no edges. */
  place(id: string, type: string, label: string, config: Record<string, any>, at: { x: number; y: number }, extra: Partial<Node> = {}): Node {
    if (this.nodes.some((n) => n.id === id)) throw new Error(`duplicate node id ${id}`)
    const node: Node = { id, type, label, position: { x: at.x + this.ox, y: at.y }, config, ...extra }
    if (this.section) node.sectionId = this.section.node.id
    this.nodes.push(node)
    return node
  }

  /** The next step of the main chain: every pending edge leads here. */
  step(id: string, type: string, label: string, config: Record<string, any>, extra: Partial<Node> = {}): Node {
    const node = this.place(id, type, label, config, { x: X, y: this.y }, extra)
    this.connect(node.id)
    this.pending = [{ source: node.id }]
    this.y += ROW
    return node
  }

  connect(target: string) {
    for (const p of this.pending) this.edge(p.source, target, p.label)
    this.pending = []
  }

  /**
   * An assertion: a condition comparing the actual value (`field`) with the
   * expected literal. Pass continues; Else records the failure first.
   */
  check(id: string, label: string, field: string, operator: string, value: string, expected = value) {
    const group = this.section?.group ?? 'General'
    const cond = this.place(`chk_${id}`, 'condition', `Check: ${label}`, {
      match_mode: 'first',
      has_else: true,
      branches: [{ label: 'Pass', logic: 'and', rules: [{ field, operator, value }] }],
    }, { x: X, y: this.y })
    this.connect(cond.id)
    const fail = this.place(`fail_${id}`, 'json_add_to_array', `Record failure: ${label}`, {
      array_var: 'failures',
      fields: [
        { key: 'check', value: id },
        { key: 'group', value: group },
        { key: 'expected', value: `${operator} ${expected}`.trim() },
        { key: 'actual', value: field },
      ],
    }, { x: X_FAIL, y: this.y })
    this.edge(cond.id, fail.id, 'Else')
    this.pending = [{ source: cond.id, label: 'Pass' }, { source: fail.id }]
    this.checks.push({ id, group, label })
    if (this.section) this.section.checks++
    this.y += ROW
  }

  /** Start a labelled section (closed by end()). */
  begin(id: string, label: string, color: string) {
    if (this.y > COLUMN_HEIGHT) {
      this.ox += COLUMN_PITCH
      this.y = 40
    }
    const node: Node = { id, type: 'section_group', label, position: { x: 0, y: 0 }, config: { width: 0, height: 0, color }, collapsed: false }
    this.nodes.push(node)
    this.section = { node, group: label, checks: 0 }
    this.y += 40
  }

  /** Close the section: tally its checks and fit the frame around its steps. */
  end(tallyId?: string) {
    const section = this.section
    if (!section) throw new Error('no open section')
    if (tallyId && section.checks > 0) {
      this.step(tallyId, 'set_variable', `Tally: ${section.group} (${section.checks} check${section.checks === 1 ? '' : 's'})`, {
        assignments: [{ name: 'checks_run', expression: `{{=checks_run + ${section.checks}}}` }],
      })
    }
    const members = this.nodes.filter((n) => n.sectionId === section.node.id)
    const xs = members.map((n) => n.position.x)
    const ys = members.map((n) => n.position.y)
    const minX = Math.min(...xs) - 60
    const minY = Math.min(...ys) - 70
    section.node.position = { x: minX, y: minY }
    section.node.config = { width: Math.max(...xs) - minX + 300, height: Math.max(...ys) - minY + 110, color: section.node.config.color }
    this.section = null
    this.y += 60
  }
}

// ─── The workflow ──────────────────────────────────────────────────────

const REPORT_TEXT = 'Kitchen sink report KS_DOC_TOKEN. Contact ops@example.com about $1,250.00 due 2026-01-15. The kitchen sink checks every step.'
const FILE_TEXT = 'Kitchen sink file test'
const FILE_TEXT_BASE64 = 'S2l0Y2hlbiBzaW5rIGZpbGUgdGVzdA=='

/** A one-slide PowerPoint deck whose title is the placeholder KS_SLIDE_TITLE (built once with pizzip). */
const PPTX_TEMPLATE_BASE64 = 'UEsDBAoAAAAIAACIn1u5Pt1i6wAAACMCAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK1RyU7DMBD9FctXFE/KASGUpAeWI3AoH2A5k8TCmzxuVf6eSVIkQFW5cLJm3qpxsz16Jw6YycbQyo2qpcBgYm/D2Mq33VN1K7dds/tISIKpgVo5lZLuAMhM6DWpmDAwMsTsdeExj5C0edcjwnVd34CJoWAoVZk9ZNc84KD3rojHI6/XWJZLcb/y5qhW6pScNbowDDMKZ3UZHV0QHkL/q111aqZYuXBosomuTgkvfIdsexSvOpdn7dkOUiqQMhIHLAJ1ueuZyDgM1mAfzd6zRH038+7HqLy24a8y5HhJ67P57zaL61cDWH69+wRQSwMECgAAAAgAAIifW6EKJrKkAAAAGwEAAAsAAABfcmVscy8ucmVsc42PwQrCMAyGX6Xk7rJ5EJF1u4iwq8wHKF3WDdc2tFX07S2enHjwmD9fvp/U7cMu4k4hzt5JqIoSBDnth9kZCZf+tNlD29RnWlTKRJxmjiKfuChhSokPiFFPZFUsPJPLm9EHq1Ieg0FW+qoM4bYsdxg+HbB2im6QELqhAtE/mf5x+3GcNR29vlly6UfFF5HNKhhKEpgTcqCYwzddZDNgU+Pqy+YFUEsDBAoAAAAIAACIn1s27zrBswAAAFIBAAAUAAAAcHB0L3ByZXNlbnRhdGlvbi54bWyNUMsKgzAQ/JWw9xorVIr4uJSC0GP7AcHEGjAPdtPH5zf2hd68zbIzszNbNk8zsrtC0s5WsE1SYMp2Tmp7reByPm720NSlLzwqUjaIEHksaiwVooIhBF9wTt2gjKDEeWXjrndoRIgjXrlE8YheZuRZmubcCG3hq8c1etf3ulMH191MPP8xQTW+c9CgPf3c/Bq3eYtFpKkijbKVJwp/zLSsINvlwLCYILYyA16XfM7ly9/UL1BLAwQKAAAACAAAiJ9b7+oBEKIAAAAPAQAAHwAAAHBwdC9fcmVscy9wcmVzZW50YXRpb24ueG1sLnJlbHONz0sKwjAQBuCrhNnbqV2ISNNuROhW6gFCMk2DzYMkit7eIC4suHD5z+Mbpu0fdmF3isl4x2Fb1cDISa+M0xwu42mzh75rz7SIXCbSbEJiZcUlDnPO4YCY5ExWpMoHcqUz+WhFLjFqDEJehSZs6nqH8duAtckGxSEOqgE2PgP9Y/tpMpKOXt4sufzjBKbFKCqgiJoyh3f8VLdV0QC7FlefdS9QSwMECgAAAAgAAIifWweTIIMAAQAA4wEAABUAAABwcHQvc2xpZGVzL3NsaWRlMS54bWyNkc1qwzAQhF9F6N6sm0MpxnYgJIXQUAJ2z0FYcizQHyvVTd6+khzT9pbLIGlnPmZRtblqRSaBXlpT0+dVQYkwveXSXGr62b09vdJNU7nSK06i1fiS1XQMwZUAvh+FZn5lnTBxNljULMQrXoAj+44IrWBdFC+gmTT0nsdH8nYYZC92tv/SwoQZgkKxEGv6UTq/0NwjNIfCR0xO/6uUNutbxfOGrkMh5lNSM7XuhNnxMZ2QSF7TNSWGaVHTTgYlKNynyQhzZk64kYSbi76w+GAZwl9yuG4tvzUVK10STBKa9/bcHg+7/bk7dMd9BektKWZ1mbEkYa4Lv/1hWQnyrzU/UEsBAhQACgAAAAgAAIifW7k+3WLrAAAAIwIAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAKAAAACAAAiJ9boQomsqQAAAAbAQAACwAAAAAAAAAAAAAAAAAcAQAAX3JlbHMvLnJlbHNQSwECFAAKAAAACAAAiJ9bNu86wbMAAABSAQAAFAAAAAAAAAAAAAAAAADpAQAAcHB0L3ByZXNlbnRhdGlvbi54bWxQSwECFAAKAAAACAAAiJ9b7+oBEKIAAAAPAQAAHwAAAAAAAAAAAAAAAADOAgAAcHB0L19yZWxzL3ByZXNlbnRhdGlvbi54bWwucmVsc1BLAQIUAAoAAAAIAACIn1sHkyCDAAEAAOMBAAAVAAAAAAAAAAAAAAAAAK0DAABwcHQvc2xpZGVzL3NsaWRlMS54bWxQSwUGAAAAAAUABQBMAQAA4AQAAAAA'

export interface KitchenSinkWorkflow {
  version: 1
  nodes: Node[]
  edges: Edge[]
  user_variables: Array<Record<string, any>>
  swimlanes: unknown[]
}

export interface BuiltKitchenSink {
  workflow: KitchenSinkWorkflow
  subWorkflow: KitchenSinkWorkflow
  checks: Check[]
  /** Checks in the Human step section (counted as skipped when include_human_step is off). */
  humanChecks: number
  /** Checks that need a real task (skipped in designer test runs, whose User Task is simulated). */
  realTaskChecks: number
  bundle: Record<string, any>
}

const USER_VARIABLES = [
  { id: 'ks_v1', name: 'include_human_step', type: 'boolean', defaultValue: 'true', description: 'Pause once for a User Task assigned to you (Human step check). Turn off for unattended runs.' },
  { id: 'ks_v2', name: 'send_test_email', type: 'boolean', defaultValue: 'false', description: 'Email the summary to test_email_to with a "[Kitchen sink test]" subject.' },
  { id: 'ks_v3', name: 'test_email_to', type: 'string', format: 'email', defaultValue: '', description: 'Where the summary email goes when send_test_email is on (your own address).' },
]

function buildMain(): { g: Graph; humanChecks: number; realTaskChecks: number } {
  const g = new Graph()
  const ids = KITCHEN_SINK_IDS

  // ── Setup ──
  g.begin('sec_setup', 'Setup', '#64748B')
  g.step('trigger', 'webhook_received', 'Start (Run now)', {})
  g.step('set_title_running', 'set_title', 'Title: running', { title: 'Kitchen sink: running…' })
  g.step('init', 'set_variable', 'Initialise run state', {
    assignments: [
      { name: 'checks_run', expression: '0' },
      { name: 'checks_skipped', expression: '0' },
      { name: 'ks_run_key', expression: '{{=GUID()}}' },
      { name: 'ks_started_at', expression: '{{=NOW()}}' },
    ],
  })
  g.step('init_failures', 'json_build_array', 'Empty failures list', { items: [], output_var: 'failures' })
  g.step('init_skipped', 'json_build_array', 'Empty skipped list', { items: [], output_var: 'skipped' })
  g.step('placeholder', 'placeholder', 'Placeholder (no-op)', { note: 'Placeholder steps pass straight through' })
  g.step('log_start', 'log', 'Log: started', { message: 'Kitchen sink started — run key {{ks_run_key}}' })
  g.end()

  // ── Variables, math and formulas ──
  g.begin('sec_vars', 'Variables & formulas', '#8B5CF6')
  g.step('set_inputs', 'set_variable', 'Set test inputs (multi-assignment)', {
    assignments: [
      { name: 'greeting', expression: '  Hello Kitchen Sink  ' },
      { name: 'qty', expression: '7' },
      { name: 'unit_price', expression: '2.5' },
      { name: 'double_qty', expression: '{{=qty * 2}}' },
      { name: 'tier', expression: 'silver' },
      { name: 'report_text', expression: REPORT_TEXT },
    ],
  })
  g.step('calc_total', 'math', 'Calculate total', { expression: '{{qty}} * {{unit_price}} + 0.5', output_var: 'total' })
  g.step('formulas', 'set_variable', 'Formula functions', {
    assignments: [
      { name: 'rounded', expression: '{{=ROUND(10 / 3, 2)}}' },
      { name: 'max_value', expression: '{{=MAX(4, 9, 2)}}' },
      { name: 'size_word', expression: '{{=IF(qty > 5, "big", "small")}}' },
    ],
  })
  g.check('vars_chained', 'chained assignment (qty × 2)', '{{double_qty}}', 'equals', '14')
  g.check('math_total', 'math total', '{{total}}', 'equals', '18')
  g.check('fx_round', 'ROUND(10 / 3, 2)', '{{rounded}}', 'equals', '3.33')
  g.check('fx_max', 'MAX(4, 9, 2)', '{{max_value}}', 'equals', '9')
  g.check('fx_if', 'IF(qty > 5)', '{{size_word}}', 'equals', 'big')
  g.end('tally_vars')

  // ── Text ──
  g.begin('sec_text', 'Text', '#0EA5E9')
  g.step('str_trim', 'modify_string', 'Trim greeting', { input: '{{greeting}}', operation: 'trim', output_var: 'trimmed' })
  g.step('str_upper', 'modify_string', 'Uppercase', { input: '{{trimmed}}', operation: 'uppercase', output_var: 'upper_text' })
  g.step('str_slug', 'modify_string', 'Slug', { input: '{{trimmed}}', operation: 'slug', output_var: 'slug_text' })
  g.step('str_regex', 'regex', 'Regex: digits only', { input: 'INV-2026-0042', pattern: '[^0-9]', flags: 'g', operation: 'replace', replace_with: '', output_var: 'digits' })
  g.step('str_regex_test', 'regex', 'Regex: test', { input: '{{trimmed}}', pattern: '^Hello', flags: '', operation: 'test', output_var: 'starts_hello' })
  g.step('str_template', 'text_template', 'Create text', { template: 'Hi {{trimmed}}, total {{total}}', output_var: 'greeting_line' })
  g.check('text_trim', 'trim', '{{trimmed}}', 'equals', 'Hello Kitchen Sink')
  g.check('text_upper', 'uppercase', '{{upper_text}}', 'equals', 'HELLO KITCHEN SINK')
  g.check('text_slug', 'slug', '{{slug_text}}', 'equals', 'hello-kitchen-sink')
  g.check('text_regex_replace', 'regex replace', '{{digits}}', 'equals', '20260042')
  g.check('text_regex_test', 'regex test', '{{starts_hello}}', 'is_true', '', 'true')
  g.check('text_template', 'text template', '{{greeting_line}}', 'equals', 'Hi Hello Kitchen Sink, total 18')
  g.check('text_length', 'LENGTH()', '{{=LENGTH(trimmed)}}', 'equals', '18')
  g.end('tally_text')

  // ── Dates ──
  g.begin('sec_dates', 'Dates', '#F59E0B')
  g.step('date_base', 'set_variable', 'Base date', { assignments: [{ name: 'base_date', expression: '2026-01-15T10:00:00.000Z' }] })
  g.step('date_add', 'date_math', 'Add 10 days', { date: '{{base_date}}', operation: 'add', amount: 10, unit: 'days', output_var: 'plus_ten' })
  g.step('date_interval', 'date_math', 'Interval between dates', { date: '{{base_date}}', date2: '{{plus_ten}}', operation: 'interval', output_var: 'date_gap' })
  g.step('date_format', 'format_date', 'Format DD/MM/YYYY', { date: '{{plus_ten}}', format: 'custom', custom_format: 'DD/MM/YYYY', output_var: 'plus_ten_text' })
  g.check('date_add', 'date math add', '{{plus_ten}}', 'equals', '2026-01-25T10:00:00.000Z')
  g.check('date_interval', 'interval in days', '{{date_gap.days}}', 'equals', '10')
  g.check('date_format', 'format date', '{{plus_ten_text}}', 'equals', '25/01/2026')
  g.check('date_weekday', 'WEEKDAY()', '{{=WEEKDAY(plus_ten)}}', 'equals', 'Sunday')
  g.end('tally_dates')

  // ── JSON ──
  g.begin('sec_json', 'JSON', '#F97316')
  g.step('json_object', 'json_build_object', 'Build order object', {
    fields: [{ key: 'id', value: 'KS-1' }, { key: 'qty', value: '{{qty}}' }, { key: 'tags', value: '["alpha","beta"]' }],
    output_var: 'order',
  })
  g.step('json_add_1', 'json_add_to_array', 'Add line 1', { array_var: 'order_lines', fields: [{ key: 'sku', value: 'A-1' }, { key: 'qty', value: '2' }] })
  g.step('json_add_2', 'json_add_to_array', 'Add line 2', { array_var: 'order_lines', fields: [{ key: 'sku', value: 'B-2' }, { key: 'qty', value: '5' }] })
  g.step('json_get_tag', 'json_get_value', 'Get tags.1', { source: '{{order}}', path: 'tags.1', output_var: 'second_tag' })
  g.step('json_raw', 'set_variable', 'Parse JSON text', {
    assignments: [{ name: 'raw_json', expression: '{"settings": {"limit": 42} }' }, { name: 'parsed_json', expression: '{{=FROM_JSON(raw_json)}}' }],
  })
  g.step('json_get_parsed', 'json_get_value', 'Get settings.limit', { source: '{{parsed_json}}', path: 'settings.limit', output_var: 'parsed_limit' })
  g.check('json_object', 'object value', '{{order.qty}}', 'equals', '7')
  g.check('json_get', 'get value by path', '{{second_tag}}', 'equals', 'beta')
  g.check('json_add', 'add to array', '{{=COUNT(order_lines)}}', 'equals', '2')
  g.check('json_parse', 'parse JSON text', '{{parsed_limit}}', 'equals', '42')
  g.end('tally_json')

  // ── Collections and loops ──
  g.begin('sec_collections', 'Collections & loops', '#06B6D4')
  g.step('col_numbers', 'json_build_array', 'Build number list', { items: [{ value: '5' }, { value: '3' }, { value: '5' }, { value: '1' }], output_var: 'numbers' })
  g.step('col_people', 'json_build_array', 'Build people list', {
    items: [
      { value: '{"name":"Ann","dept":"ops","score":3}' },
      { value: '{"name":"Bo","dept":"fin","score":9}' },
      { value: '{"name":"Cy","dept":"ops","score":6}' },
    ],
    output_var: 'people',
  })
  g.step('col_count', 'collection_count', 'Count numbers', { collection: '{{numbers}}', output_var: 'number_count' })
  g.step('col_unique', 'collection_unique', 'Remove duplicates', { collection: '{{numbers}}', output_var: 'unique_numbers' })
  g.step('col_sort', 'collection_sort', 'Sort ascending', { collection: '{{numbers}}', direction: 'asc', output_var: 'sorted_numbers' })
  g.step('col_first', 'collection_get', 'Get first', { collection: '{{sorted_numbers}}', by: 'index', index: 0, output_var: 'smallest' })
  g.step('col_last', 'collection_get', 'Get last', { collection: '{{sorted_numbers}}', by: 'last', output_var: 'largest' })
  g.step('col_join', 'collection_join', 'Join to text', { collection: '{{sorted_numbers}}', separator: '-', output_var: 'joined_numbers' })
  g.step('col_filter', 'collection_filter', 'Filter ops people', { collection: '{{people}}', field: 'dept', operator: 'equals', value: 'ops', output_var: 'ops_people' })
  g.step('col_join_names', 'collection_join', 'Join names', { collection: '{{ops_people}}', field: 'name', separator: ', ', output_var: 'ops_names' })
  g.step('loop_init', 'set_variable', 'Reset loop totals', {
    assignments: [{ name: 'loop_sum', expression: '0' }, { name: 'n_sum', expression: '0' }, { name: 'n_iterations', expression: '0' }],
  })
  // Loop For Each: body (Each Item) beside the chain, Done continues.
  const loop = g.step('loop_each', 'loop', 'Loop over numbers', { items: '{{numbers}}', item_var: 'num', index_var: 'num_index' })
  const body = g.place('loop_body', 'set_variable', 'Add item to sum', { assignments: [{ name: 'loop_sum', expression: '{{=loop_sum + num}}' }] }, { x: X_FAIL, y: loop.position.y })
  g.edge(loop.id, body.id, 'Each Item')
  g.pending = [{ source: loop.id, label: 'Done' }]
  const loopN = g.step('loop_n', 'loop_n_times', 'Loop 3 times', { count: 3, index_var: 'k' })
  const bodyN = g.place('loop_n_body', 'set_variable', 'Add index to sum', {
    assignments: [{ name: 'n_sum', expression: '{{=n_sum + k}}' }, { name: 'n_iterations', expression: '{{=n_iterations + 1}}' }],
  }, { x: X_FAIL, y: loopN.position.y })
  g.edge(loopN.id, bodyN.id, 'Each Item')
  g.pending = [{ source: loopN.id, label: 'Done' }]
  // Nested Lists (orders → lines): a loop inside a loop — the inner one reads the order as parent_item, the order comes back after it.
  g.step('nested_init', 'set_variable', 'Orders with their lines', {
    assignments: [
      { name: 'nested_raw', expression: '[{"customer":"Acme","lines":[{"sku":"A-1","qty":2},{"sku":"A-2","qty":3}]},{"customer":"Globex","lines":[{"sku":"B-1","qty":4}]}]' },
      { name: 'nested_orders', expression: '{{=FROM_JSON(nested_raw)}}' },
      { name: 'nested_qty', expression: '0' },
      { name: 'nested_parent', expression: '' },
      { name: 'nested_restored', expression: '' },
    ],
  })
  const outer = g.step('nested_outer', 'loop', 'Loop over the orders', { items: '{{nested_orders}}', item_var: 'item', index_var: 'index' })
  const inner = g.place('nested_inner', 'loop', 'Loop over the order\'s lines', { items: '{{item.lines}}', item_var: 'item', index_var: 'line_index' }, { x: X_FAIL, y: outer.position.y })
  const innerBody = g.place('nested_inner_body', 'set_variable', 'Add the line\'s qty', {
    assignments: [{ name: 'nested_qty', expression: '{{=nested_qty + item.qty}}' }, { name: 'nested_parent', expression: '{{parent_item.customer}}' }],
  }, { x: X_FAIL + 360, y: outer.position.y })
  const innerDone = g.place('nested_inner_done', 'set_variable', 'The order again', { assignments: [{ name: 'nested_restored', expression: '{{item.customer}}' }] }, { x: X_FAIL, y: outer.position.y + ROW })
  g.edge(outer.id, inner.id, 'Each Item')
  g.edge(inner.id, innerBody.id, 'Each Item')
  g.edge(inner.id, innerDone.id, 'Done')
  g.pending = [{ source: outer.id, label: 'Done' }]
  g.check('nested_loop', 'nested loop (sum of the lines\' qty)', '{{nested_qty}}', 'equals', '9')
  g.check('nested_parent', 'nested loop reads the outer item (parent_item)', '{{nested_parent}}', 'equals', 'Globex')
  g.check('nested_restored', 'the outer item comes back after the inner loop', '{{nested_restored}}', 'equals', 'Globex')
  g.check('col_count', 'count', '{{number_count}}', 'equals', '4')
  g.check('col_unique', 'remove duplicates', '{{=COUNT(unique_numbers)}}', 'equals', '3')
  g.check('col_first', 'sorted first', '{{smallest}}', 'equals', '1')
  g.check('col_last', 'sorted last', '{{largest}}', 'equals', '5')
  g.check('col_join', 'join', '{{joined_numbers}}', 'equals', '1-3-5-5')
  g.check('col_filter', 'filter + join field', '{{ops_names}}', 'equals', 'Ann, Cy')
  g.check('loop_each', 'loop for each (sum)', '{{loop_sum}}', 'equals', '14')
  g.check('loop_n_sum', 'loop N times (index sum)', '{{n_sum}}', 'equals', '3')
  g.check('loop_n_count', 'loop N times (iterations)', '{{n_iterations}}', 'equals', '3')
  g.end('tally_collections')

  // ── Branching ──
  g.begin('sec_branching', 'Branching', '#EAB308')
  // If / else if / else: one branch runs, then they meet.
  const ifElse = g.step('br_if', 'condition', 'If / else if / else (tier)', {
    match_mode: 'first',
    has_else: true,
    branches: [
      { label: 'Gold', logic: 'and', rules: [{ field: '{{tier}}', operator: 'equals', value: 'gold' }] },
      { label: 'Silver', logic: 'and', rules: [{ field: '{{tier}}', operator: 'equals', value: 'silver' }] },
    ],
  })
  const gold = g.place('br_gold', 'set_variable', 'Route: gold', { assignments: [{ name: 'tier_route', expression: 'gold' }] }, { x: X - 360, y: g.y })
  const silver = g.place('br_silver', 'set_variable', 'Route: silver', { assignments: [{ name: 'tier_route', expression: 'silver' }] }, { x: X, y: g.y })
  const other = g.place('br_other', 'set_variable', 'Route: other', { assignments: [{ name: 'tier_route', expression: 'other' }] }, { x: X + 360, y: g.y })
  g.edge(ifElse.id, gold.id, 'Gold')
  g.edge(ifElse.id, silver.id, 'Silver')
  g.edge(ifElse.id, other.id, 'Else')
  g.pending = [{ source: gold.id }, { source: silver.id }, { source: other.id }]
  g.y += ROW
  // Branch by value.
  const sw = g.step('br_switch', 'switch_case', 'Branch by value (size)', { field: '{{size_word}}', cases: ['big', 'small'], has_default: true })
  const big = g.place('br_big', 'set_variable', 'Size: big', { assignments: [{ name: 'size_route', expression: 'big-path' }] }, { x: X - 360, y: g.y })
  const small = g.place('br_small', 'set_variable', 'Size: small', { assignments: [{ name: 'size_route', expression: 'small-path' }] }, { x: X, y: g.y })
  const dflt = g.place('br_default', 'set_variable', 'Size: default', { assignments: [{ name: 'size_route', expression: 'default-path' }] }, { x: X + 360, y: g.y })
  g.edge(sw.id, big.id, 'big')
  g.edge(sw.id, small.id, 'small')
  g.edge(sw.id, dflt.id, 'Default')
  g.pending = [{ source: big.id }, { source: small.id }, { source: dflt.id }]
  g.y += ROW
  // Multi-path: every matching branch runs (match all); "Continue" always matches and carries on.
  g.step('br_multi_init', 'set_variable', 'Reset path markers', {
    assignments: [{ name: 'path_over5', expression: 'no' }, { name: 'path_odd', expression: 'no' }, { name: 'path_over100', expression: 'no' }],
  })
  const multi = g.step('br_multi', 'condition', 'Multi-path (every match runs)', {
    match_mode: 'all',
    has_else: false,
    branches: [
      { label: 'Over 5', logic: 'and', rules: [{ field: '{{qty}}', operator: 'gt', value: '5' }] },
      { label: 'Odd', logic: 'and', rules: [{ field: '{{=MOD(qty, 2)}}', operator: 'equals', value: '1' }] },
      { label: 'Over 100', logic: 'and', rules: [{ field: '{{qty}}', operator: 'gt', value: '100' }] },
      { label: 'Continue', logic: 'and', rules: [{ field: '{{qty}}', operator: 'is_not_empty', value: '' }] },
    ],
  })
  g.pending = []
  const p5 = g.place('br_over5', 'set_variable', 'Path: over 5', { assignments: [{ name: 'path_over5', expression: 'yes' }] }, { x: X - 360, y: multi.position.y + ROW / 2 })
  const pOdd = g.place('br_odd', 'set_variable', 'Path: odd', { assignments: [{ name: 'path_odd', expression: 'yes' }] }, { x: X + 360, y: multi.position.y + ROW / 2 })
  const p100 = g.place('br_over100', 'set_variable', 'Path: over 100', { assignments: [{ name: 'path_over100', expression: 'yes' }] }, { x: X + 720, y: multi.position.y + ROW / 2 })
  // Edge order matters: the marker branches run before Continue.
  g.edge(multi.id, p5.id, 'Over 5')
  g.edge(multi.id, pOdd.id, 'Odd')
  g.edge(multi.id, p100.id, 'Over 100')
  g.pending = [{ source: multi.id, label: 'Continue' }]
  g.check('br_if', 'if / else if / else', '{{tier_route}}', 'equals', 'silver')
  g.check('br_switch', 'branch by value', '{{size_route}}', 'equals', 'big-path')
  g.check('br_multi_over5', 'multi-path: over 5 ran', '{{path_over5}}', 'equals', 'yes')
  g.check('br_multi_odd', 'multi-path: odd ran', '{{path_odd}}', 'equals', 'yes')
  g.check('br_multi_over100', 'multi-path: over 100 skipped', '{{path_over100}}', 'equals', 'no')
  g.end('tally_branching')

  // ── Go To ──
  g.begin('sec_goto', 'Go to (jump)', '#14B8A6')
  g.step('goto_init', 'set_variable', 'Reset jump counter', { assignments: [{ name: 'jump_count', expression: '0' }] })
  g.step('goto_count', 'set_variable', 'Count a pass', { assignments: [{ name: 'jump_count', expression: '{{=jump_count + 1}}' }] })
  const again = g.step('goto_again', 'condition', 'Jump again?', {
    match_mode: 'first',
    has_else: true,
    branches: [{ label: 'Again', logic: 'and', rules: [{ field: '{{jump_count}}', operator: 'lt', value: '3' }] }],
  })
  const jump = g.place('goto_jump', 'goto_activity', 'Go to: Count a pass', { target_node_id: 'goto_count', target_node_label: 'Count a pass' }, { x: X_FAIL, y: again.position.y })
  g.edge(again.id, jump.id, 'Again')
  g.pending = [{ source: again.id, label: 'Else' }]
  g.check('goto', 'go to ran the step 3 times', '{{jump_count}}', 'equals', '3')
  g.end('tally_goto')

  // ── Parallel ──
  g.begin('sec_parallel', 'Parallel', '#A855F7')
  const par = g.step('par', 'parallel', 'Parallel branches', { mode: 'parallel', branches: [{ label: 'Branch A', order: 1 }, { label: 'Branch B', order: 2 }] })
  const parY = g.y
  const pa = g.place('par_a', 'set_variable', 'Branch A work', { assignments: [{ name: 'par_a', expression: 'A done' }] }, { x: X - 300, y: parY })
  const paMath = g.place('par_a_math', 'math', 'Branch A math', { expression: '21 * 2', output_var: 'par_a_num' }, { x: X - 300, y: parY + ROW })
  const pb = g.place('par_b', 'set_variable', 'Branch B work', { assignments: [{ name: 'par_b', expression: 'B done' }] }, { x: X + 300, y: parY })
  const join = g.place('par_join', 'set_variable', 'Join branches', { assignments: [{ name: 'par_joined', expression: '{{par_a}} + {{par_b}}' }] }, { x: X, y: parY + 2 * ROW })
  g.edge(par.id, pa.id, 'Branch A')
  g.edge(pa.id, paMath.id)
  g.edge(paMath.id, join.id)
  g.edge(par.id, pb.id, 'Branch B')
  g.edge(pb.id, join.id)
  g.y = parY + 3 * ROW
  g.pending = [{ source: par.id, label: 'Done' }]
  g.check('par_join', 'join saw both branches', '{{par_joined}}', 'equals', 'A done + B done')
  g.check('par_branch_output', 'branch output after Done', '{{par_a_num}}', 'equals', '42')
  g.end('tally_parallel')

  // ── Decision table ──
  g.begin('sec_decision', 'Decision table', '#0284C7')
  g.step('decide', 'decision_table', 'Evaluate pricing rules', {
    decision_table_id: ids.decisionTable,
    decision_table_name: KITCHEN_SINK_DECISION_TABLE_NAME,
    input_mappings: { amount: '250', tier: '{{tier}}' },
  })
  g.check('dt_matched', 'a rule matched', '{{matched}}', 'is_true', '', 'true')
  g.check('dt_rule', 'rule label', '{{rule_label}}', 'equals', 'High value')
  g.check('dt_discount', 'discount output', '{{discount}}', 'equals', '10')
  g.check('dt_band', 'band output', '{{band}}', 'equals', 'high')
  g.end('tally_decision')

  // ── Data table ──
  g.begin('sec_data', 'Data table', '#2563EB')
  const table = { table_id: ids.dataTable, table_name: KITCHEN_SINK_DATA_TABLE_NAME }
  g.step('data_insert_a', 'update_data_table', 'Insert row alpha', {
    ...table, operation: 'insert', column_values: { run_key: '{{ks_run_key}}', label: 'alpha', amount: '10', status: 'new' }, output_row_id_var: 'row_a_id',
  })
  g.step('data_insert_b', 'update_data_table', 'Insert row beta', {
    ...table, operation: 'insert', column_values: { run_key: '{{ks_run_key}}', label: 'beta', amount: '20', status: 'new' }, output_row_id_var: 'row_b_id',
  })
  g.step('data_get', 'update_data_table', 'Get row alpha', { ...table, operation: 'get', row_id: '{{row_a_id}}', output_row_var: 'row_a' })
  g.step('data_list', 'update_data_table', 'List rows of this run', {
    ...table, operation: 'list', filters: [{ column: 'run_key', operator: 'eq', value: '{{ks_run_key}}' }], output_rows_var: 'run_rows', output_count_var: 'run_row_count',
  })
  g.step('data_update', 'update_data_table', 'Update row alpha', { ...table, operation: 'update', row_id: '{{row_a_id}}', column_values: { status: 'done', amount: '15' } })
  g.step('data_get_again', 'update_data_table', 'Get row alpha again', { ...table, operation: 'get', row_id: '{{row_a_id}}', output_row_var: 'row_a_after' })
  g.step('data_delete_a', 'update_data_table', 'Delete row alpha', { ...table, operation: 'delete', row_id: '{{row_a_id}}' })
  g.step('data_delete_b', 'update_data_table', 'Delete row beta (match by column)', {
    ...table, operation: 'delete', row_match_field: 'label', row_match_value: 'beta', row_id: '{{row_b_id}}',
  })
  g.step('data_list_after', 'update_data_table', 'List rows after clean-up', {
    ...table, operation: 'list', filters: [{ column: 'run_key', operator: 'eq', value: '{{ks_run_key}}' }], output_rows_var: 'left_rows', output_count_var: 'left_row_count',
  })
  g.check('data_insert_get', 'insert + get', '{{row_a.label}}', 'equals', 'alpha')
  g.check('data_list', 'list with a filter', '{{run_row_count}}', 'equals', '2')
  g.check('data_update_status', 'update (status)', '{{row_a_after.status}}', 'equals', 'done')
  g.check('data_update_amount', 'update (amount)', '{{row_a_after.amount}}', 'equals', '15')
  g.check('data_cleanup', 'delete cleaned up', '{{left_row_count}}', 'equals', '0')
  g.end('tally_data')

  // ── Sub-workflow ──
  g.begin('sec_sub', 'Sub-workflow', '#6366F1')
  g.step('sub_call', 'call_sub_workflow', 'Call sub-workflow', {
    sub_workflow_id: ids.subWorkflow,
    sub_workflow_name: KITCHEN_SINK_SUB_NAME,
    input_mappings: { sub_input: '{{qty}}' },
    _output_prefix: 'sub',
  })
  g.check('sub_status', 'sub-workflow completed', '{{sub_status}}', 'equals', 'completed')
  g.check('sub_result', 'sub-workflow doubled the input', '{{sub_results.sub_double.output.result}}', 'equals', '14')
  g.end('tally_sub')

  // ── Error handling ──
  g.begin('sec_errors', 'Error handling', '#EF4444')
  g.step('err_fail', 'regex', 'Fails on purpose (unsafe pattern)', { input: 'aaaa', pattern: '(a+)+$', flags: '', operation: 'test', output_var: 'never_set' }, { onError: 'continue' })
  g.check('err_flag', 'error captured (has_error)', '{{has_error}}', 'is_true', '', 'true')
  g.check('err_node', 'error names the failing step', '{{last_error_node_id}}', 'equals', 'err_fail')
  g.check('err_message', 'error message recorded', '{{last_error}}', 'is_not_empty', '', 'a message')
  g.end('tally_errors')

  // ── Timing ──
  g.begin('sec_timing', 'Timing', '#D97706')
  g.step('time_start', 'set_variable', 'Note the time', { assignments: [{ name: 'timing_start', expression: '{{=NOW()}}' }] })
  g.step('time_delay', 'delay', 'Pause for 1 second', { duration: 1, unit: 'seconds' })
  g.step('time_until', 'pause_until', 'Pause until a few seconds ahead', {
    date: '{{=CONCAT(FORMAT_DATE(NOW(), "YYYY-MM-DDTHH:mm:"), PAD_LEFT(MIN(59, ADD(TO_NUMBER(FORMAT_DATE(NOW(), "ss")), 2)), 2, "0"), "Z")}}',
  })
  g.step('time_gap', 'date_math', 'Measure the wait', { date: '{{timing_start}}', date2: '{{=NOW()}}', operation: 'interval', output_var: 'timing_gap' })
  g.check('timing', 'waited at least 1 second', '{{timing_gap.ms}}', 'gte', '1000')
  g.step('time_sla', 'set_sla', 'Set SLA (2 days)', { sla_label: 'Kitchen sink', mode: 'relative', amount: 2, unit: 'days', warning_amount: 1, warning_unit: 'days' })
  g.check('sla', 'SLA on track', '{{workflow_sla_status}}', 'equals', 'on_track')
  g.end('tally_timing')

  // ── Files and documents ──
  g.begin('sec_files', 'Files & documents', '#0F766E')
  g.step('csv_write', 'read_csv', 'CSV: write', { mode: 'write', data_var: '{{people}}', file_name: 'kitchen-sink.csv', output_var: 'csv_file' })
  g.step('csv_read', 'read_csv', 'CSV: read back', { mode: 'read', file_url: '{{csv_file}}', has_headers: true, output_var: 'csv_rows' })
  g.step('xlsx_write', 'read_excel', 'Excel: write', { mode: 'write', data_var: '{{people}}', file_name: 'kitchen-sink.xlsx', sheet_name: 'People', output_var: 'xlsx_file' })
  g.step('xlsx_read', 'read_excel', 'Excel: read back', { mode: 'read', file_url: '{{xlsx_file}}', sheet_name: 'People', has_headers: true, output_var: 'xlsx_rows' })
  g.step('b64_to_file', 'base64_to_file', 'Base64 to file', { base64_data: `{{=BASE64_ENCODE("${FILE_TEXT}")}}`, file_name: 'kitchen-sink.txt', content_type: 'text/plain', output_var: 'text_file' })
  g.step('file_read', 'read_file', 'Read file content', { file_url: '{{text_file}}', encoding: 'utf-8', output_var: 'file_text' })
  g.step('file_b64', 'file_to_base64', 'File to base64', { file_url: '{{text_file}}', output_var: 'file_b64' })
  g.step('file_download', 'download_file', 'Download file (own storage)', { url: '{{text_file}}', file_name: 'kitchen-sink-copy.txt', output_var: 'downloaded' })
  g.check('csv', 'CSV round trip', '{{csv_rows[0].name}}', 'equals', 'Ann')
  g.check('csv_count', 'CSV row count', '{{csv_rows_count}}', 'equals', '3')
  g.check('xlsx', 'Excel round trip', '{{xlsx_rows[2].name}}', 'equals', 'Cy')
  g.check('file_read', 'read file', '{{file_text}}', 'equals', FILE_TEXT)
  g.check('file_b64', 'file to base64', '{{file_b64}}', 'equals', FILE_TEXT_BASE64)
  g.check('file_download', 'download size', '{{downloaded_size}}', 'equals', String(FILE_TEXT.length))
  g.step('doc_to_docx', 'doc_convert', 'Convert text to Word', { source: '{{report_text}}', target: 'docx', output_name: 'kitchen-sink-report', output_var: 'report_docx' })
  g.step('doc_word', 'doc_word', 'Word: find & replace', {
    template_url: '{{report_docx}}', mode: 'find_replace', replacements: [{ find: 'KS_DOC_TOKEN', replace: 'Word OK' }], output_filename: 'kitchen-sink-word.docx', output_var: 'word_file',
  })
  g.step('doc_read_word', 'doc_read', 'Read the Word file', { source: '{{word_file}}', output_var: 'word_doc' })
  g.step('doc_excel', 'doc_excel', 'Excel: find & replace', {
    template_url: '{{xlsx_file}}', mode: 'find_replace', replacements: [{ find: 'Ann', replace: 'Annie' }], output_filename: 'kitchen-sink-edited.xlsx', output_var: 'excel_file',
  })
  g.step('doc_read_excel', 'doc_read', 'Read the Excel file', { source: '{{excel_file}}', output_var: 'excel_doc' })
  g.step('pptx_template', 'base64_to_file', 'Save slide template', {
    base64_data: PPTX_TEMPLATE_BASE64, file_name: 'kitchen-sink-template.pptx', content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', output_var: 'pptx_template',
  })
  g.step('doc_powerpoint', 'doc_powerpoint', 'PowerPoint: find & replace', {
    template_url: '{{pptx_template}}', mode: 'find_replace', replacements: [{ find: 'KS_SLIDE_TITLE', replace: 'Slides OK' }], output_filename: 'kitchen-sink-slides.pptx', output_var: 'slides_file',
  })
  g.step('doc_read_slides', 'doc_read', 'Read the slides', { source: '{{slides_file}}', output_var: 'slides_doc' })
  g.step('doc_to_pdf', 'doc_convert', 'Convert text to PDF', { source: '{{report_text}}', target: 'pdf', engine: 'builtin', output_name: 'kitchen-sink-report', output_var: 'report_pdf' })
  g.step('doc_pdf', 'doc_pdf', 'PDF: page count', { operation: 'page_count', source: '{{report_pdf}}', output_var: 'pdf_pages' })
  g.step('doc_inspect', 'doc_inspect', 'Inspect: search text', { source: '{{report_text}}', operation: 'search', query: 'kitchen sink', output_var: 'inspection' })
  g.step('doc_compare', 'doc_compare', 'Compare two texts', { original: 'alpha beta gamma', revised: 'alpha beta delta', mode: 'words', output_var: 'comparison' })
  g.step('doc_extract', 'doc_extract', 'Extract emails and amounts', { source: '{{report_text}}', finders: ['emails', 'amounts'], output_var: 'extracted' })
  g.step('doc_redact', 'doc_redact', 'Detect personal data', { source: '{{report_text}}', mode: 'detect_only', presets: ['email'], output_var: 'detected' })
  g.check('doc_word', 'Word find & replace', '{{word_doc_text}}', 'contains', 'Kitchen sink report Word OK')
  g.check('doc_excel', 'Excel find & replace', '{{excel_doc_text}}', 'contains', 'Annie')
  g.check('doc_powerpoint', 'PowerPoint find & replace', '{{slides_doc_text}}', 'contains', 'Slides OK')
  g.check('doc_pdf', 'PDF page count', '{{pdf_pages}}', 'gte', '1')
  g.check('doc_inspect', 'inspect found the text', '{{inspection_match_count}}', 'gte', '2')
  g.check('doc_compare', 'compare found a change', '{{comparison_identical}}', 'is_false', '', 'false')
  g.check('doc_extract', 'extract found the email', '{{extracted.found.emails}}', 'contains', 'ops@example.com')
  g.check('doc_redact', 'redact detected the email', '{{detected_count}}', 'gte', '1')
  g.end('tally_files')

  // ── Governance and extensibility ──
  g.begin('sec_governance', 'Governance & custom actions', '#7C3AED')
  g.step('gov_policies', 'retention_policies', 'List retention policies', { operation: 'list_policies' })
  g.check('gov_policies', 'retention policies listed', '{{policy_count}}', 'is_not_empty', '', 'a count')
  g.step('custom_action', 'custom_activity', 'Custom action: double', {
    custom_activity_id: ids.customAction, custom_activity_key: KITCHEN_SINK_ACTION_KEY, operation: 'double', input_mappings: { n: '{{qty}}' },
  })
  g.check('custom_action', 'custom action output', '{{doubled}}', 'equals', '14')
  const hasStarter = g.step('gov_starter', 'condition', 'Started by a person?', {
    match_mode: 'first',
    has_else: true,
    branches: [{ label: 'Yes', logic: 'and', rules: [{ field: '{{workflow_started_by}}', operator: 'is_not_empty', value: '' }] }],
  })
  const roleCfg = { user_id: '{{workflow_started_by}}', role_id: ids.role, role_name: KITCHEN_SINK_ROLE_NAME }
  g.pending = [{ source: hasStarter.id, label: 'Yes' }]
  g.step('gov_add', 'add_user_to_role', 'Add me to the test role', { ...roleCfg, _output_prefix: 'gov_add' })
  g.check('gov_add', 'add user to role', '{{gov_add_success}}', 'is_true', '', 'true')
  g.step('gov_check', 'check_permission', 'Check the role permission', { user_id: '{{workflow_started_by}}', permission: KITCHEN_SINK_ROLE_PERMISSION })
  g.check('gov_check', 'check permission', '{{has_permission}}', 'is_true', '', 'true')
  g.step('gov_remove', 'remove_user_from_role', 'Remove me from the test role', { ...roleCfg, _output_prefix: 'gov_remove' })
  g.check('gov_remove', 'remove user from role', '{{gov_remove_action}}', 'equals', 'removed')
  const govSkip = g.place('gov_skip', 'set_variable', 'Skip: no starter', {
    assignments: [{ name: 'checks_skipped', expression: '{{=checks_skipped + 3}}' }],
  }, { x: X - 360, y: hasStarter.position.y + ROW })
  g.edge(hasStarter.id, govSkip.id, 'Else')
  const govSkipNote = g.place('gov_skip_note', 'json_add_to_array', 'Note skipped role checks', {
    array_var: 'skipped', fields: [{ key: 'group', value: 'Governance' }, { key: 'reason', value: 'no person started this run (role checks need one)' }, { key: 'checks', value: '3' }],
  }, { x: X - 360, y: hasStarter.position.y + 2 * ROW })
  g.edge(govSkip.id, govSkipNote.id)
  g.pending.push({ source: govSkipNote.id })
  // Tally: the role checks count only when they ran (the skip branch counts them as skipped).
  g.step('tally_governance', 'set_variable', 'Tally: Governance & custom actions', {
    assignments: [{ name: 'checks_run', expression: '{{=checks_run + IF(workflow_started_by, 5, 2)}}' }],
  })
  g.end()

  // ── Human step ──
  g.begin('sec_human', 'Human step check', '#14B8A6')
  const human = g.step('human_gate', 'condition', 'Include the human step?', {
    match_mode: 'first',
    has_else: true,
    branches: [{ label: 'Yes', logic: 'and', rules: [{ field: '{{include_human_step}}', operator: 'is_true', value: '' }] }],
  })
  g.pending = [{ source: human.id, label: 'Yes' }]
  const checksBeforeHuman = g.checks.length
  const task = g.step('human_task', 'user_task', 'Kitchen sink: confirm the human step', {
    task_title: 'Kitchen sink self-test: please confirm',
    task_description: 'This task checks that User Tasks work end to end. The run token is filled in for you — click Confirm.',
    task_priority: 'low',
    outcomes: ['Confirm', 'Report a problem'],
    assignment_type: 'individual',
    assignee_variable: '{{workflow_started_by}}',
    form_id: ids.form,
    form_name: KITCHEN_SINK_FORM_NAME,
    field_values: { ks_token: '{{ks_run_key}}', ks_note: 'Prefilled by the kitchen sink', ks_lines: '{{order_lines}}', ks_orders: '{{nested_orders}}' },
    due_date_mode: 'relative',
    due_offset_amount: 1,
    due_offset_unit: 'days',
  })
  // Both outcomes continue; the outcome check reports "Report a problem" as a failure.
  g.pending = [{ source: task.id, label: 'Confirm' }, { source: task.id, label: 'Report a problem' }]
  g.check('human_outcome', 'task outcome', '{{outcome}}', 'equals', 'Confirm')
  g.check('human_prefill', 'prefilled value came back', '{{task_data.ks_token}}', 'equals', '{{ks_run_key}}', 'the run key')
  g.check('human_note', 'task form value', '{{task_data.ks_note}}', 'is_not_empty', '', 'a value')
  // Task writes need the real task (a designer test run simulates the User Task).
  const real = g.step('human_real', 'condition', 'Real task (not a designer test)?', {
    match_mode: 'first',
    has_else: true,
    branches: [{ label: 'Real', logic: 'and', rules: [{ field: '{{workflow_started_via}}', operator: 'not_equals', value: 'test' }] }],
  })
  g.pending = [{ source: real.id, label: 'Real' }]
  const checksBeforeReal = g.checks.length
  g.step('task_attach', 'add_task_attachment', 'Attach a file to the task', {
    task_id: '{{user_task_id}}', file: '{{text_file}}', file_name: 'kitchen-sink.txt', name: 'Kitchen sink attachment', type: 'Evidence', description: 'Added by the kitchen sink self-test',
  }, { onError: 'continue' })
  g.check('task_attach', 'attachment added', '{{attachment.name}}', 'equals', 'Kitchen sink attachment')
  g.step('task_subtask', 'create_subtask', 'Create a subtask', { parent_task_id: '{{user_task_id}}', title: 'Kitchen sink subtask (closed automatically)' }, { onError: 'continue' })
  g.check('task_subtask', 'subtask created', '{{subtask_id}}', 'is_not_empty', '', 'an id')
  g.step('task_auto', 'auto_action', 'Auto action: close the subtask', { target_task_id: '{{subtask_id}}', status: 'completed', outcome: 'Closed by the kitchen sink' }, { onError: 'continue' })
  g.check('task_auto', 'auto action ran without an error', '{{last_error_node_id}}', 'not_equals', 'task_auto')
  // A List field (repeating rows) prefilled from an array, back in task_data and looped over.
  g.step('list_init', 'set_variable', 'Reset the list total', { assignments: [{ name: 'list_qty', expression: '0' }] })
  const listLoop = g.step('list_loop', 'loop', 'Loop over the task\'s list rows', { items: '{{task_data.ks_lines}}', item_var: 'line', index_var: 'line_index' })
  const listBody = g.place('list_body', 'set_variable', 'Add the row\'s quantity', { assignments: [{ name: 'list_qty', expression: '{{=list_qty + line.qty}}' }] }, { x: X_FAIL, y: listLoop.position.y })
  g.edge(listLoop.id, listBody.id, 'Each Item')
  g.pending = [{ source: listLoop.id, label: 'Done' }]
  g.check('list_rows', 'list field rows (prefilled from an array)', '{{=COUNT(task_data.ks_lines)}}', 'equals', '2')
  g.check('list_first', 'list row value (typed)', '{{task_data.ks_lines[0].sku}}', 'equals', 'A-1')
  g.check('list_loop', 'loop over the list (sum of qty)', '{{list_qty}}', 'equals', '7')
  g.check('nested_list', 'nested List rows (prefilled orders → lines)', '{{task_data.ks_orders[0].lines[1].sku}}', 'equals', 'A-2')
  const realTaskChecks = g.checks.length - checksBeforeReal
  g.step('tally_real', 'set_variable', `Tally: task writes (${realTaskChecks} checks)`, {
    assignments: [{ name: 'checks_run', expression: `{{=checks_run + ${realTaskChecks}}}` }],
  })
  const realSkip = g.place('human_real_skip', 'set_variable', 'Skip: simulated task', {
    assignments: [{ name: 'checks_skipped', expression: `{{=checks_skipped + ${realTaskChecks}}}` }],
  }, { x: X - 360, y: real.position.y + ROW })
  g.edge(real.id, realSkip.id, 'Else')
  const realSkipNote = g.place('human_real_skip_note', 'json_add_to_array', 'Note skipped task writes', {
    array_var: 'skipped', fields: [{ key: 'group', value: 'Human step check' }, { key: 'reason', value: 'designer test run: the User Task is simulated, so there is no task to write to' }, { key: 'checks', value: String(realTaskChecks) }],
  }, { x: X - 360, y: real.position.y + 2 * ROW })
  g.edge(realSkip.id, realSkipNote.id)
  g.pending.push({ source: realSkipNote.id })
  const humanChecks = g.checks.length - checksBeforeHuman
  const humanRun = humanChecks - realTaskChecks
  g.step('tally_human', 'set_variable', `Tally: Human step check (${humanRun} checks)`, {
    assignments: [{ name: 'checks_run', expression: `{{=checks_run + ${humanRun}}}` }],
  })
  const humanSkip = g.place('human_skip', 'set_variable', 'Skip: human step off', {
    assignments: [{ name: 'checks_skipped', expression: `{{=checks_skipped + ${humanChecks}}}` }],
  }, { x: X - 360, y: human.position.y + ROW })
  g.edge(human.id, humanSkip.id, 'Else')
  const humanSkipNote = g.place('human_skip_note', 'json_add_to_array', 'Note skipped human step', {
    array_var: 'skipped', fields: [{ key: 'group', value: 'Human step check' }, { key: 'reason', value: 'include_human_step is off' }, { key: 'checks', value: String(humanChecks) }],
  }, { x: X - 360, y: human.position.y + 2 * ROW })
  g.edge(humanSkip.id, humanSkipNote.id)
  g.pending.push({ source: humanSkipNote.id })
  g.step('log_human', 'log', 'Log: human step done', { message: 'Human step section finished' })
  g.end()

  // ── Summary ──
  const total = g.checks.length
  g.begin('sec_summary', 'Summary', '#16A34A')
  g.step('sum_counts', 'set_variable', 'Count the results', {
    assignments: [
      { name: 'checks_total', expression: String(total) },
      { name: 'failed_count', expression: '{{=COUNT(failures)}}' },
      { name: 'passed_count', expression: '{{=checks_run - failed_count}}' },
      { name: 'failed_list', expression: '{{=JOIN(", ", PLUCK(failures, "check"))}}' },
      { name: 'skipped_note', expression: '{{=IF(checks_skipped > 0, CONCAT(" (", checks_skipped, " skipped)"), "")}}' },
    ],
  })
  g.step('sum_results', 'json_build_object', 'Build results', {
    fields: [
      { key: 'total', value: '{{checks_total}}' },
      { key: 'run', value: '{{checks_run}}' },
      { key: 'passed', value: '{{passed_count}}' },
      { key: 'failed', value: '{{failed_count}}' },
      { key: 'skipped', value: '{{checks_skipped}}' },
      { key: 'failures', value: '{{failures}}' },
      { key: 'skipped_groups', value: '{{skipped}}' },
      { key: 'run_key', value: '{{ks_run_key}}' },
    ],
    output_var: 'results',
  })
  g.step('sum_text', 'text_template', 'Summary text', {
    template: 'Kitchen sink: {{passed_count}}/{{checks_run}} passed{{skipped_note}}. Failed: {{=IF(failed_count > 0, failed_list, "none")}}.',
    output_var: 'summary_text',
  })
  g.step('sum_title', 'set_title', 'Title: result', { title: 'Kitchen sink: {{passed_count}}/{{checks_run}} passed{{skipped_note}}' })
  g.step('sum_log', 'log', 'Log: summary', { message: '{{summary_text}}' })
  const mail = g.step('sum_mail_gate', 'condition', 'Email the summary?', {
    match_mode: 'first',
    has_else: true,
    branches: [{ label: 'Send', logic: 'and', rules: [
      { field: '{{send_test_email}}', operator: 'is_true', value: '' },
      { field: '{{test_email_to}}', operator: 'is_not_empty', value: '' },
    ] }],
  })
  const send = g.place('sum_mail', 'send_email', 'Send summary email', {
    to: '{{test_email_to}}',
    subject: '[Kitchen sink test] {{summary_text}}',
    body: '<p>{{summary_text}}</p><p>Run key: {{ks_run_key}}</p>',
  }, { x: X_FAIL, y: mail.position.y })
  g.edge(mail.id, send.id, 'Send')
  g.pending = [{ source: mail.id, label: 'Else' }, { source: send.id }]
  const verdict = g.step('sum_verdict', 'condition', 'All checks passed?', {
    match_mode: 'first',
    has_else: true,
    branches: [{ label: 'All passed', logic: 'and', rules: [
      { field: '{{failed_count}}', operator: 'equals', value: '0' },
      { field: '{{=checks_run + checks_skipped}}', operator: 'equals', value: '{{checks_total}}' },
    ] }],
  })
  const pass = g.place('end_pass', 'end_workflow', 'End: all passed', { reason: '{{summary_text}}' }, { x: X - 240, y: verdict.position.y + ROW })
  const fail = g.place('end_fail', 'end_workflow', 'End: failed', {
    status: 'failed',
    reason: 'Kitchen sink failed: {{failed_count}} of {{checks_run}} checks failed ({{failed_list}}); {{checks_run}} + {{checks_skipped}} skipped of {{checks_total}} ran',
  }, { x: X + 240, y: verdict.position.y + ROW })
  g.edge(verdict.id, pass.id, 'All passed')
  g.edge(verdict.id, fail.id, 'Else')
  g.pending = []
  g.y += ROW
  g.end()

  return { g, humanChecks, realTaskChecks }
}

function buildSub(): KitchenSinkWorkflow {
  const g = new Graph()
  g.step('sub_trigger', 'webhook_received', 'Called by the kitchen sink', {})
  g.step('sub_double', 'math', 'Double the input', { expression: '{{sub_input}} * 2', output_var: 'sub_doubled' })
  g.step('sub_log', 'log', 'Log: sub-workflow ran', { message: 'Sub-workflow doubled {{sub_input}} to {{sub_doubled}}' })
  g.step('sub_end', 'end_workflow', 'End', { reason: 'Sub-workflow done' })
  return {
    version: 1,
    nodes: g.nodes,
    edges: g.edges,
    user_variables: [{ id: 'ks_sv1', name: 'sub_input', type: 'number', defaultValue: '1', description: 'Number to double (passed by the kitchen sink)' }],
    swimlanes: [],
  }
}

const col = (n: number) => `7c5e0002-0000-4000-8000-0000000000c${n}`
const dt = (n: string) => `7c5e0003-0000-4000-8000-0000000000${n}`

function buildBundle(workflow: KitchenSinkWorkflow, subWorkflow: KitchenSinkWorkflow): Record<string, any> {
  const ids = KITCHEN_SINK_IDS
  const source = `export default {
  operations: {
    double: (input) => ({ doubled: Number(input.n) * 2 }),
  },
}`
  return {
    format_version: 3,
    data_tables: [{
      id: ids.dataTable,
      name: KITCHEN_SINK_DATA_TABLE_NAME,
      description: 'Scratch rows the kitchen sink self-test writes and deletes again on every run. Safe to leave empty.',
      columns: [
        { id: col(1), key: 'run_key', name: 'Run key', type: 'text', required: false },
        { id: col(2), key: 'label', name: 'Label', type: 'text', required: false },
        { id: col(3), key: 'amount', name: 'Amount', type: 'number', required: false },
        { id: col(4), key: 'status', name: 'Status', type: 'text', required: false },
      ],
    }],
    decision_tables: [{
      id: ids.decisionTable,
      name: KITCHEN_SINK_DECISION_TABLE_NAME,
      description: 'Used by the kitchen sink self-test. First matching rule wins.',
      inputs: [
        { id: dt('a1'), key: 'amount', label: 'Amount', type: 'number' },
        { id: dt('a2'), key: 'tier', label: 'Tier', type: 'text' },
      ],
      outputs: [
        { id: dt('b1'), key: 'discount', label: 'Discount %', type: 'number' },
        { id: dt('b2'), key: 'band', label: 'Band', type: 'text' },
      ],
      rules: [
        {
          id: dt('c1'), label: 'Gold high value', enabled: true,
          conditions: [
            { id: dt('d1'), inputKey: 'tier', operator: 'equals', value: 'gold' },
            { id: dt('d2'), inputKey: 'amount', operator: 'greater_than', value: '100' },
          ],
          outputs: { discount: 15, band: 'gold-high' },
        },
        {
          id: dt('c2'), label: 'High value', enabled: true,
          conditions: [{ id: dt('d3'), inputKey: 'amount', operator: 'greater_than', value: '100' }],
          outputs: { discount: 10, band: 'high' },
        },
        { id: dt('c3'), label: 'Standard', enabled: true, conditions: [], outputs: { discount: 0, band: 'standard' } },
      ],
    }],
    roles: [{
      id: ids.role,
      name: KITCHEN_SINK_ROLE_NAME,
      slug: 'kitchen_sink_test_role',
      description: 'Granted to and removed from the person running the kitchen sink self-test. Holds one read-only permission.',
      permissions: [KITCHEN_SINK_ROLE_PERMISSION],
    }],
    workflow_activities: [{
      id: ids.customAction,
      name: 'Kitchen sink: double',
      description: 'Doubles a number. Used by the kitchen sink self-test to check custom actions run.',
      key: KITCHEN_SINK_ACTION_KEY,
      status: 'active',
      version: '1.0.0',
      runtime: 'module',
      icon_name: 'Puzzle',
      color: '#0EA5E9',
      enabled: true,
      tags: ['kitchen-sink'],
      source_kind: 'inline',
      demo_inputs: {},
      source_code: source,
      // What the import records (so re-importing finds nothing to change).
      sha256: createHash('sha256').update(source.trim()).digest('hex'),
      manifest: {
        manifest_version: 1,
        key: KITCHEN_SINK_ACTION_KEY,
        name: 'Kitchen sink: double',
        version: '1.0.0',
        description: 'Doubles a number.',
        operations: [{
          id: 'double',
          label: 'Double',
          description: 'Returns n × 2.',
          inputs: [{ name: 'n', label: 'Number', type: 'number', required: true }],
          outputs: [{ name: 'doubled', label: 'Doubled', type: 'number' }],
        }],
      },
    }],
    forms: [{
      id: ids.form,
      name: KITCHEN_SINK_FORM_NAME,
      description: 'The kitchen sink self-test\'s User Task form. The run token is prefilled by the workflow.',
      tags: ['kitchen-sink'],
      fields: [
        { key: 'ks_token', label: 'Run token', type: 'text', read_only: true, help_text: 'Filled in by the workflow; it checks the value comes back.' },
        { key: 'ks_note', label: 'Note', type: 'text', required: true, text_style: { label: { bold: true, color: 'accent', font: 'google:Lato' }, value: { font: 'georgia', size: 'lg' } } },
        { key: 'ks_ok', label: 'The run looks right', type: 'boolean' },
        { key: 'ks_lines', label: 'Order lines', type: 'list', read_only: true, help_text: 'Filled in by the workflow from an array; it loops over the rows.', list: { columns: [{ key: 'sku', label: 'SKU', type: 'text', required: true }, { key: 'qty', label: 'Qty', type: 'number' }], totals: [{ column: 'qty', fn: 'sum' }] } },
        { key: 'ks_photo', label: 'Photo (optional)', type: 'image', help_text: 'One picture: checked by content, GPS / EXIF metadata removed.', image: { max_mb: 5, camera: true } },
        { key: 'ks_signature', label: 'Signature (optional)', type: 'signature', signature: { statement: 'I checked this kitchen sink run.' } },
        { key: 'ks_findings', label: 'Findings (optional)', type: 'rich_text', help_text: 'Formatted text, sanitised on the server; the plain text is ks_findings_text.', rich_text: { max_length: 2000 } },
        { key: 'ks_checks', label: 'Checks done (optional)', type: 'text_list', text_list: { style: 'numbered', max_items: 10 } },
        { key: 'ks_link', label: 'Run link (optional)', type: 'url', url_config: { link_text: 'Open the run', new_tab: true } },
        { key: 'ks_watchers', label: 'Also tell (optional)', type: 'user', user_config: { multiple: true, allow_teams: true, max: 5 } },
        // A nested List (orders → lines), prefilled from the nested array the loops checked.
        { key: 'ks_orders', label: 'Orders', type: 'list', read_only: true, help_text: 'Filled in by the workflow: each order with its lines (a nested List).', list: { columns: [{ key: 'customer', label: 'Customer', type: 'text', required: true }, { key: 'lines', label: 'Lines', type: 'list', list: { columns: [{ key: 'sku', label: 'SKU', type: 'text', required: true }, { key: 'qty', label: 'Qty', type: 'number' }], totals: [{ column: 'qty', fn: 'sum' }] } }] } },
        // A repeating section (card-style items of any controls, per-item rules), optional.
        { key: 'ks_expenses', label: 'Expenses (optional)', type: 'repeating_section', help_text: 'A card per expense: any controls repeat per item; the run gets ks_expenses_count and ks_expenses_total_ks_amount.', repeating_section: { fields: [{ key: 'ks_description', label: 'Description', type: 'text', required: true }, { key: 'ks_amount', label: 'Amount', type: 'currency', currency: 'USD', min: 0 }, { key: 'ks_spent_on', label: 'Date', type: 'date', default: '{{today}}' }, { key: 'ks_claimant_sig', label: 'Claimant signature', type: 'signature', signature: { statement: 'I spent this on company business.' } }], layout: { rows: [{ columns: 3, cells: [{ field_key: 'ks_description', span: 1 }, { field_key: 'ks_amount', span: 1 }, { field_key: 'ks_spent_on', span: 1 }] }, { columns: 1, cells: [{ field_key: 'ks_claimant_sig', span: 1 }] }], rules: [{ id: 'ks_fixed', name: 'Fixed fee: amount read only, highlighted', event: 'always', if: { match: 'all', conditions: [{ column: 'item.ks_description', operator: 'equals', value: 'Fixed fee' }] }, then: [{ type: 'read_only', mode: 'read_only', targets: ['field:ks_amount'] }, { type: 'set_style', targets: ['field:ks_amount'], style: { tone: 'info', text: true, font: 'mono' } }] }] }, add_label: 'Add expense', item_title: 'Expense {{index}}: {{item.ks_description}}', max_items: 10, totals: [{ field: 'ks_amount', fn: 'sum' }] } },
        // An editable List with per-row cell rules (hide / lock one cell — InfoPath's conditional formatting in a repeating table) and column text styles; optional.
        { key: 'ks_adjustments', label: 'Adjustments (optional)', type: 'list', help_text: 'Approved rows lock their amount and hide the reason; the server keeps a locked amount as it was.', list: {
          entry_mode: 'inline', key_column: 'ref',
          columns: [
            { key: 'ref', label: 'Ref', type: 'text' },
            { key: 'status', label: 'Status', type: 'choice', options: ['Open', 'Approved'] },
            { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD', text_style: { label: { color: 'info' }, value: { font: 'courier_new', bold: true } } },
            { key: 'reason', label: 'Reason', type: 'text', text_style: { value: { italic: true, size: 'sm' } } },
            // A signature per row: a Sign button in the cell (the pad in a dialog), the full pad in the row pop-out; locked once signed.
            { key: 'signed_off', label: 'Signed off', type: 'signature', signature: { mode: 'both', statement: 'I approve this adjustment.' } },
          ],
          cell_rules: [
            { if: { match: 'all', conditions: [{ column: 'row.status', operator: 'equals', value: 'Approved' }] }, column: 'amount', read_only: true },
            { if: { match: 'all', conditions: [{ column: 'row.status', operator: 'equals', value: 'Approved' }] }, column: 'reason', hide: true },
            { if: { match: 'all', conditions: [{ column: 'row.status', operator: 'equals', value: 'Approved' }] }, column: 'signed_off', read_only: true },
          ],
          row_styles: [{ if: { match: 'all', conditions: [{ column: 'row.amount', operator: 'gt', value: '1000' }] }, column: 'amount', style: { tone: 'danger', text: true, size: 'lg', icon: true } }],
        } },
      ],
      theme: { source: 'workspace' },
      available_in_menu: false,
    }],
    workflows: [
      {
        id: ids.subWorkflow,
        name: KITCHEN_SINK_SUB_NAME,
        description: 'Called by the kitchen sink self-test: doubles sub_input.',
        trigger_type: 'webhook_received',
        trigger_config: {},
        is_active: true,
        nodes: subWorkflow.nodes,
        edges: subWorkflow.edges,
        user_variables: subWorkflow.user_variables,
        swimlanes: [],
      },
      {
        id: ids.workflow,
        name: KITCHEN_SINK_NAME,
        description: 'Runs every non-API step type and checks each result. Run it after an upgrade: the run title shows "Kitchen sink: N/N passed" and the run fails, listing the failed checks, if anything is broken.',
        trigger_type: 'webhook_received',
        trigger_config: {},
        is_active: true,
        nodes: workflow.nodes,
        edges: workflow.edges,
        user_variables: workflow.user_variables,
        swimlanes: [],
      },
    ],
  }
}

export function buildKitchenSink(): BuiltKitchenSink {
  const { g, humanChecks, realTaskChecks } = buildMain()
  const workflow: KitchenSinkWorkflow = { version: 1, nodes: g.nodes, edges: g.edges, user_variables: USER_VARIABLES, swimlanes: [] }
  const subWorkflow = buildSub()
  return { workflow, subWorkflow, checks: g.checks, humanChecks, realTaskChecks, bundle: buildBundle(workflow, subWorkflow) }
}
