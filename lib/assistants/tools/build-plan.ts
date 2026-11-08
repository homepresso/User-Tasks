/**
 * The Agent's solution builder (server side): build several connected items
 * from one process — data tables, forms, decision tables, the workflow(s) and
 * optionally a report — with ONE confirmation for the whole plan.
 *
 *  1. The model calls build_plan with every item: its kind, name, a summary
 *     and the arguments of the item's create tool. Later items refer to
 *     earlier ones as "{{ref:<key>.id}}" / "{{ref:<key>.name}}" (e.g. a
 *     workflow's form_submitted.form_id, a user_task's form_id, an
 *     update_data_table's table_id).
 *  2. The confirmation card IS the plan: every item, what links to what, and
 *     the items the person's permissions don't allow (skipped, with their
 *     dependants). Confirming ("Build all") is the person's decision for
 *     those new items only — nothing existing is changed by a plan.
 *  3. On confirmation the items are created in dependency order (tables →
 *     forms → decision tables → workflows → reports, and declared
 *     depends_on), each through its MCP create tool as the person (drafts
 *     only, as always), with the real ids substituted into later items.
 *     Workflows go through the self-check first (warnings reported).
 *  4. Progress shows per item (✓ with a link). A failure stops the build and
 *     reports what was created and what is left; a long build pauses before
 *     the request's time budget. Either way the result carries the plan
 *     state (created ids), so build_plan_continue picks up where it stopped
 *     — with its own confirmation, on a later request.
 */
import type { AssistantToolDef, ToolEnv } from '../engine'
import { draftFromArgs, workflowWarnings } from '../workflow-check'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments are JSON */

export const MAX_PLAN_ITEMS = 15
/** Stop starting new items after this long in one request (the turn's budget is longer). */
export const PLAN_TIME_BUDGET_MS = 150_000

export const PLAN_KINDS = ['data_table', 'form', 'decision_table', 'workflow', 'report'] as const
export type PlanKind = (typeof PLAN_KINDS)[number]

export const CREATE_TOOL: Record<PlanKind, string> = {
  data_table: 'data_tables_create', form: 'forms_create', decision_table: 'decision_tables_create', workflow: 'workflows_create', report: 'reports_create',
}
const KIND_ORDER: Record<PlanKind, number> = { data_table: 0, form: 1, decision_table: 2, workflow: 3, report: 4 }
const NOUN: Record<PlanKind, string> = { data_table: 'Data table', form: 'Form', decision_table: 'Decision table', workflow: 'Workflow', report: 'Report' }
const HREF: Record<PlanKind, (id: string) => string> = {
  data_table: (id) => `/data/${id}`,
  form: (id) => `/automations/forms?open=${encodeURIComponent(id)}`,
  decision_table: (id) => `/automations/rules/${id}`,
  workflow: (id) => `/automations/${id}`,
  report: (id) => `/reports/${id}`,
}

export interface PlanItem {
  key: string
  kind: PlanKind
  name: string
  summary: string
  depends_on: string[]
  /** The create tool's arguments ("{{ref:<key>.id}}" for earlier items). */
  args: Record<string, any>
}

export interface CreatedItem { key: string; kind: PlanKind; id: string; name: string; href: string }

const REF = /\{\{\s*ref:([A-Za-z0-9_-]+)\.(id|name)\s*\}\}/g

/** The references an item makes to other items. */
export function planRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') for (const m of value.matchAll(REF)) out.add(m[1])
  else if (Array.isArray(value)) value.forEach((v) => planRefs(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => planRefs(v, out))
  return out
}

/** `value` with "{{ref:key.id|name}}" replaced from created items (unknown refs left, to be reported). */
export function substituteRefs<T>(value: T, created: Record<string, { id: string; name: string }>): T {
  if (typeof value === 'string') return value.replace(REF, (whole, key: string, field: 'id' | 'name') => (created[key] ? created[key][field] : whole)) as T
  if (Array.isArray(value)) return value.map((v) => substituteRefs(v, created)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteRefs(v, created)])) as T
  return value
}

/** Plan items from the model, normalised (throws a clear error for a bad plan). */
export function normalizePlan(raw: unknown): PlanItem[] {
  const list = Array.isArray(raw) ? raw : []
  if (!list.length) throw new Error('The plan has no items')
  if (list.length > MAX_PLAN_ITEMS) throw new Error(`A plan can have at most ${MAX_PLAN_ITEMS} items — split it into two builds`)
  const items: PlanItem[] = list.map((r: any, i: number) => {
    const kind = (PLAN_KINDS as readonly string[]).includes(r?.kind) ? r.kind as PlanKind : null
    if (!kind) throw new Error(`Item ${i + 1}: kind must be one of ${PLAN_KINDS.join(', ')}`)
    const key = String(r?.key ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '') || `item${i + 1}`
    const args = r?.args && typeof r.args === 'object' && !Array.isArray(r.args) ? r.args : {}
    const name = String(r?.name ?? args.name ?? '').trim().slice(0, 200)
    if (!name) throw new Error(`Item ${i + 1}: give it a name`)
    return { key, kind, name, summary: String(r?.summary ?? '').slice(0, 300), depends_on: Array.isArray(r?.depends_on) ? r.depends_on.map(String) : [], args: { ...args, name: args.name ?? name } }
  })
  const keys = new Set<string>()
  for (const it of items) { if (keys.has(it.key)) throw new Error(`Two items share the key "${it.key}"`); keys.add(it.key) }
  for (const it of items) for (const ref of [...planRefs(it.args), ...it.depends_on]) if (!keys.has(ref)) throw new Error(`${it.name}: refers to "${ref}", which is not in the plan`)
  return items
}

/** Dependency order: declared depends_on and {{ref:…}} first, then tables → forms → decision tables → workflows → reports. */
export function orderPlan(items: PlanItem[]): PlanItem[] {
  const byKey = new Map(items.map((i) => [i.key, i]))
  const deps = new Map(items.map((i) => [i.key, new Set([...i.depends_on, ...planRefs(i.args)].filter((k) => k !== i.key))]))
  const out: PlanItem[] = []
  const done = new Set<string>()
  while (out.length < items.length) {
    const ready = items.filter((i) => !done.has(i.key) && [...deps.get(i.key)!].every((d) => done.has(d)))
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || items.indexOf(a) - items.indexOf(b))
    if (!ready.length) throw new Error(`The plan has a circular dependency between: ${items.filter((i) => !done.has(i.key)).map((i) => i.name).join(', ')}`)
    out.push(ready[0]); done.add(ready[0].key)
  }
  void byKey
  return out
}

/** Items the person can't create (no permission for the kind) and everything depending on them. */
export function skippedItems(items: PlanItem[], allowedTools: ReadonlySet<string>): Map<string, string> {
  const skipped = new Map<string, string>()
  for (const it of items) if (!allowedTools.has(CREATE_TOOL[it.kind])) skipped.set(it.key, `you can't create ${NOUN[it.kind].toLowerCase()}s — ask an admin`)
  let changed = true
  while (changed) {
    changed = false
    for (const it of items) {
      if (skipped.has(it.key)) continue
      const dep = [...it.depends_on, ...planRefs(it.args)].find((d) => skipped.has(d))
      if (dep) { skipped.set(it.key, `needs “${items.find((x) => x.key === dep)?.name}”, which is skipped`); changed = true }
    }
  }
  return skipped
}

function linksOf(it: PlanItem, items: PlanItem[]): string {
  const refs = [...planRefs(it.args)].map((k) => items.find((x) => x.key === k)).filter(Boolean) as PlanItem[]
  return refs.length ? `uses ${refs.map((r) => `“${r.name}”`).join(', ')}` : ''
}

export interface PlanToolDeps {
  /** Calls an MCP tool as the person (read or write); returns its JSON payload or { error }. */
  call: (name: string, args: Record<string, any>) => Promise<any>
  /** The person's allowed tool names (create tools per kind). */
  allowedTools: ReadonlySet<string>
  /** draftOnlyArgs of the designer tools (drafts only). */
  draftOnly: (tool: string, args: Record<string, any>) => Record<string, any>
  now?: () => number
}

function planCard(items: PlanItem[], allowed: ReadonlySet<string>, title: string, created: Record<string, CreatedItem> = {}) {
  const ordered = orderPlan(items)
  const skipped = skippedItems(items, allowed)
  const todo = ordered.filter((i) => !skipped.has(i.key) && !created[i.key])
  if (!todo.length) throw new Error(skipped.size ? `Nothing in this plan can be built with your permissions (${[...skipped.values()][0]})` : 'Everything in this plan is already built')
  const rows = ordered.map((it, i) => [
    String(i + 1), NOUN[it.kind], it.name,
    created[it.key] ? '✓ already built' : skipped.has(it.key) ? `Skipped: ${skipped.get(it.key)}` : [it.summary, linksOf(it, items)].filter(Boolean).join(' · '),
  ])
  return {
    title,
    lines: [
      `${todo.length} item${todo.length === 1 ? '' : 's'} will be created, in this order${skipped.size ? ` (${skipped.size} skipped)` : ''}`,
      'Workflows are saved as inactive drafts; forms, tables and rules as new items — nothing existing is changed',
    ],
    warnings: [...skipped.entries()].map(([k, why]) => `“${items.find((i) => i.key === k)?.name}” is skipped: ${why}`),
    preview: { columns: ['#', 'Kind', 'Name', 'Details'], rows, total: rows.length, caption: 'Build plan' },
    confirm_label: todo.length === 1 ? 'Build it' : 'Build all',
  }
}

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    key: { type: 'string', description: 'A short unique key for this item (e.g. "requests_table", "start_form", "approval_form", "workflow")' },
    kind: { type: 'string', enum: [...PLAN_KINDS] },
    name: { type: 'string' },
    summary: { type: 'string', description: 'One line shown on the plan card: columns, fields or steps' },
    depends_on: { type: 'array', items: { type: 'string' }, description: 'Keys of items that must be created first' },
    args: { type: 'object', description: 'The full arguments of the kind\'s create tool (data_tables_create, forms_create, decision_tables_create, workflows_create, reports_create). Refer to an earlier item as "{{ref:<key>.id}}" or "{{ref:<key>.name}}".' },
  },
  required: ['key', 'kind', 'name', 'args'],
}

async function execute(items: PlanItem[], created: Record<string, CreatedItem>, deps: PlanToolDeps, env: ToolEnv) {
  const now = deps.now ?? Date.now
  const started = now()
  const ordered = orderPlan(items)
  const skipped = skippedItems(items, deps.allowedTools)
  const done: Record<string, CreatedItem> = { ...created }
  const warnings: string[] = []
  for (const it of ordered) {
    if (done[it.key] || skipped.has(it.key)) continue
    const remaining = () => ordered.filter((x) => !done[x.key] && !skipped.has(x.key)).map((x) => x.key)
    if (now() - started > PLAN_TIME_BUDGET_MS) {
      return { status: 'paused', note: 'Paused to stay within this request\'s time. Call build_plan_continue with the same items and `created` to finish (the person confirms once more).', created: Object.values(done), remaining: remaining(), warnings }
    }
    const tool = CREATE_TOOL[it.kind]
    const args = deps.draftOnly(tool, substituteRefs(it.args, done))
    const label = `Creating ${NOUN[it.kind].toLowerCase()} “${it.name}”`
    const id = `${env.toolCallId}-${it.key}`
    env.emit({ type: 'tool_start', id, name: tool, label })
    const unresolved = [...planRefs(args)]
    let payload: any
    if (unresolved.length) payload = { error: `refers to items that were not created: ${unresolved.join(', ')}` }
    else {
      if (it.kind === 'workflow') {
        const draft = draftFromArgs(args)
        if (draft) for (const w of workflowWarnings(draft)) warnings.push(`${it.name}: ${w}`)
      }
      payload = await deps.call(tool, args)
    }
    const obj = payload?.form ?? payload?.workflow ?? payload?.table ?? payload?.decision_table ?? payload?.report ?? payload
    const newId = obj?.id ?? payload?.id ?? null
    if (payload?.error || !newId) {
      env.emit({ type: 'tool_end', id, name: tool, ok: false, label })
      return {
        status: 'failed',
        failed: { key: it.key, name: it.name, error: payload?.error ?? 'The create tool returned no id' },
        created: Object.values(done),
        remaining: remaining(),
        warnings,
        note: 'The build stopped. Tell the person what was created and what failed, and offer to fix the failed item and continue (build_plan_continue with the same items and `created`) or to stop.',
      }
    }
    const item: CreatedItem = { key: it.key, kind: it.kind, id: String(newId), name: String(obj?.name ?? it.name), href: HREF[it.kind](String(newId)) }
    done[it.key] = item
    env.emit({ type: 'tool_end', id, name: tool, ok: true, label })
    env.emit({ type: 'changed', kind: it.kind, id: item.id, title: item.name, href: item.href, action: 'created' })
  }
  return {
    status: 'completed',
    created: Object.values(done),
    skipped: [...skipped.entries()].map(([key, why]) => ({ key, why })),
    warnings,
    note: 'Summarise what was built with links, list any warnings, and ask ONCE whether to open the workflow. Everything is a draft: the person reviews and publishes the workflow in the editor.',
  }
}

export function buildPlanTools(deps: PlanToolDeps): AssistantToolDef[] {
  const createdArg = (raw: unknown): Record<string, CreatedItem> => {
    const out: Record<string, CreatedItem> = {}
    for (const c of Array.isArray(raw) ? raw : []) if (c?.key && c?.id && (PLAN_KINDS as readonly string[]).includes(c.kind)) out[String(c.key)] = { key: String(c.key), kind: c.kind, id: String(c.id), name: String(c.name ?? ''), href: HREF[c.kind as PlanKind](String(c.id)) }
    return out
  }
  return [
    {
      name: 'build_plan',
      description: `Build several connected items from one process (data tables, forms, decision tables, workflows, a report) with ONE confirmation: the person sees the whole plan and chooses Build all. At most ${MAX_PLAN_ITEMS} items. Items are created in dependency order with real ids substituted for "{{ref:<key>.id}}". Use this for "build it" from a process; use the single create tools for one item.`,
      parameters: { type: 'object', properties: { title: { type: 'string', description: 'e.g. "Leave request process"' }, items: { type: 'array', items: ITEM_SCHEMA } }, required: ['items'] },
      mode: 'write',
      label: (args) => `Building ${String(args.title ?? 'the plan').slice(0, 60)}`,
      confirm: async (args) => planCard(normalizePlan(args.items), deps.allowedTools, `Build plan: ${String(args.title ?? 'new solution').slice(0, 80)}`),
      run: async (args, env) => ({ result: await execute(normalizePlan(args.items), {}, deps, env) }),
    },
    {
      name: 'build_plan_continue',
      description: 'Continue a build that stopped (failed or paused): the same items (fixed if needed) and `created` from the last result. The person confirms the remaining items.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: { type: 'array', items: ITEM_SCHEMA },
          created: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, kind: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' } }, required: ['key', 'kind', 'id'] }, description: 'Items already built (from the previous result)' },
        },
        required: ['items', 'created'],
      },
      mode: 'write',
      label: () => 'Continuing the build',
      confirm: async (args) => planCard(normalizePlan(args.items), deps.allowedTools, `Continue building: ${String(args.title ?? 'the plan').slice(0, 80)}`, createdArg(args.created)),
      run: async (args, env) => ({ result: await execute(normalizePlan(args.items), createdArg(args.created), deps, env) }),
    },
  ]
}
