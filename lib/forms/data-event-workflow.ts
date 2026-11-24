/**
 * "Map to data event" → Send to a workflow (lib/forms/data-event.ts): the
 * plan as a draft workflow, started by the form's "Form submitted" trigger
 * (lib/forms/submitted-trigger.ts — the established way a form starts a
 * workflow with its whole submission; the InfoPath import's "save
 * submissions" workflow is built the same way):
 *
 *   Form submitted (this form)
 *     → Insert into <parent table>            output_row_id_var step_1_id
 *     → Loop for each {{form.lines}}          (one per repeating section / List)
 *         Each item → Insert into <child>     parent_row_id = {{step_1_id}}
 *                   → Loop for each {{item.serials}} (nested items: parent_item)
 *     → Done → End
 *
 * An API reference step is a Call API / Reference node; when a later step
 * reads its id, a Set variable node keeps {{response.<id path>}} as
 * {{step_N_id}} (the response is overwritten by the next call).
 *
 * The outline (start, inserts, loops) is what the wizard's review shows.
 *
 * Pure and isomorphic.
 */

import type { TaskFieldDef } from '@/lib/task-field-schema'
import { defaultIdPath, idVariable, sourceChain, type DataEventPlan, type DataEventSource, type DataEventStep, type DataEventTarget, type DataEventValue } from './data-event'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow nodes are free-form JSON */

export interface DataEventWorkflowNode { id: string; type: string; label: string; position: { x: number; y: number }; config: Record<string, any> }
export interface DataEventWorkflowEdge { id: string; source: string; target: string; label?: string }

export interface OutlineLine {
  /** Nesting: 0 = top level, 1 = inside a loop… */
  depth: number
  kind: 'trigger' | 'insert' | 'call' | 'loop' | 'set' | 'end'
  text: string
  /** The plan step it comes from. */
  step?: string
  node: string
}

export interface DataEventWorkflow {
  name: string
  description: string
  trigger_type: 'form_submitted'
  trigger_config: Record<string, never>
  nodes: DataEventWorkflowNode[]
  edges: DataEventWorkflowEdge[]
  tags: string[]
  outline: OutlineLine[]
}

export interface DataEventFormInfo { id: string; name: string; version?: number | null; fields: TaskFieldDef[] }

const X0 = 400
const DX = 320
const DY = 140

/** The loop variable of a source at a depth (always `item`: the engine keeps the outer one as parent_item). */
function itemsExpression(source: DataEventSource, chain: DataEventSource[]): string {
  const parent = chain[chain.length - 2]
  return !parent || parent.kind === 'form' ? `{{form.${source.key}}}` : `{{item.${source.key}}}`
}

/**
 * The plan as a workflow definition (create it with is_active: false — a
 * draft). Steps must already be in a runnable order (lib/forms/data-event.ts
 * planProblems / autoOrder).
 */
export function buildDataEventWorkflow(plan: DataEventPlan, form: DataEventFormInfo, sources: DataEventSource[], targets: DataEventTarget[] = []): DataEventWorkflow {
  const nodes: DataEventWorkflowNode[] = []
  const edges: DataEventWorkflowEdge[] = []
  const outline: OutlineLine[] = []
  const bySource = new Map(sources.map((s) => [s.key, s]))
  let y = 60
  const add = (node: Omit<DataEventWorkflowNode, 'position'>, depth: number) => {
    nodes.push({ ...node, position: { x: X0 + depth * DX, y } })
    y += DY
    return node.id
  }
  const link = (source: string, target: string, label?: string) => {
    edges.push({ id: `e-${source}-${target}`, source, target, ...(label ? { label } : {}) })
  }

  add({ id: 'trigger', type: 'form_submitted', label: `"${form.name}" submitted`, config: { form_id: form.id, form_name: form.name, fields: form.fields, ...(Number.isInteger(form.version) ? { form_cached_version: form.version } : {}) } }, 0)
  outline.push({ depth: 0, kind: 'trigger', text: `When "${form.name}" is submitted`, node: 'trigger' })

  /*
   * The open loops (form level first). Each frame keeps where the next node
   * hangs from: the node itself and the label of that edge ('Each item'
   * from a loop's body start, 'Done' after a nested loop closed).
   */
  interface Frame { source: string; loop: string | null; cursor: string; label?: string }
  const stack: Frame[] = [{ source: '', loop: null, cursor: 'trigger' }]
  const attach = (id: string) => {
    const top = stack[stack.length - 1]
    link(top.cursor, id, top.label)
    top.cursor = id
    top.label = undefined
  }
  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      const done = stack.pop()!
      const outer = stack[stack.length - 1]
      // After the loop: hang the next node off the loop's Done.
      outer.cursor = done.loop!
      outer.label = 'Done'
    }
  }

  // Which parent ids later steps read (only those get output / Set variable nodes).
  const reads = new Map<string, Set<string>>()
  for (const s of plan.steps) {
    for (const v of Object.values(s.map)) {
      if (v.kind !== 'parent') continue
      const parent = plan.steps.find((p) => p.id === v.step)
      if (parent) reads.set(v.step, (reads.get(v.step) ?? new Set()).add(v.path ?? defaultIdPath(parent)))
    }
  }

  const template = (step: DataEventStep, v: DataEventValue): string => {
    if (v.kind === 'text') return v.value
    if (v.kind === 'parent') {
      const parent = plan.steps.find((p) => p.id === v.step)
      const path = v.path ?? (parent ? defaultIdPath(parent) : 'row_id')
      if (parent?.target.kind === 'table' && path.startsWith('row.')) return `{{${v.step}_row.${path.slice(4)}}}`
      return `{{${parent ? idVariable(parent, path) : `${v.step}_id`}}}`
    }
    const own = step.source ? bySource.get(step.source)?.fields.some((f) => f.key === v.key) : false
    return own ? `{{item.${v.key}}}` : `{{form.${v.key}}}`
  }

  let loopCount = 0
  for (const step of plan.steps) {
    const chain = sourceChain(sources, step.source).filter((s) => s.kind !== 'form')
    // Close loops that are not on this step's chain, then open the missing ones.
    let keep = 1
    while (keep < stack.length && chain[keep - 1] && stack[keep].source === chain[keep - 1].key) keep++
    closeTo(keep)
    for (let i = stack.length - 1; i < chain.length; i++) {
      const source = chain[i]
      const loopId = `loop_${++loopCount}`
      add({ id: loopId, type: 'loop', label: `Each ${source.label}`, config: { items: itemsExpression(source, [bySource.get('')!, ...chain.slice(0, i + 1)].filter(Boolean)), item_var: 'item', index_var: 'index' } }, stack.length - 1)
      attach(loopId)
      outline.push({ depth: stack.length - 1, kind: 'loop', text: `For each item of ${source.label}`, node: loopId })
      stack.push({ source: source.key, loop: loopId, cursor: loopId, label: 'Each item' })
    }
    const depth = stack.length - 1
    const values = Object.fromEntries(Object.entries(step.map).map(([k, v]) => [k, template(step, v)]))
    const needed = reads.get(step.id)
    if (step.target.kind === 'table') {
      const id = add({
        id: step.id, type: 'update_data_table', label: `Add to ${step.target.name}`.slice(0, 80),
        config: {
          table_id: step.target.id, table_name: step.target.name, operation: 'insert', column_values: values,
          output_row_id_var: `${step.id}_id`,
          ...(needed && [...needed].some((p) => p.startsWith('row.')) ? { output_row_var: `${step.id}_row` } : {}),
        },
      }, depth)
      attach(id)
      outline.push({ depth, kind: 'insert', text: `Add a row to ${step.target.name}${Object.keys(values).length ? ` (${Object.keys(values).length} column${Object.keys(values).length === 1 ? '' : 's'})` : ''}`, step: step.id, node: id })
    } else {
      const target = targets.find((t) => t.kind === 'reference' && t.id === step.target.id)
      const id = add({
        id: step.id, type: 'call_reference', label: `Call ${step.target.name}`.slice(0, 80),
        config: {
          reference_id: step.target.id, input_mappings: values,
          ...(target ? { _ref_inputs: target.columns.map((c) => ({ name: c.key, required: c.required === true })) } : {}),
        },
      }, depth)
      attach(id)
      outline.push({ depth, kind: 'call', text: `Call ${step.target.name}`, step: step.id, node: id })
      if (needed?.size) {
        const setId = `${step.id}_keep`
        add({ id: setId, type: 'set_variable', label: `Keep the ${step.target.name} id`.slice(0, 80), config: { assignments: [...needed].map((path) => ({ name: idVariable(step, path), expression: `{{response.${path}}}` })) } }, depth)
        attach(setId)
        outline.push({ depth, kind: 'set', text: `Keep its id as {{${idVariable(step, [...needed][0])}}}`, step: step.id, node: setId })
      }
    }
  }
  closeTo(1)
  add({ id: 'done', type: 'end_workflow', label: 'Saved', config: { reason: 'Submission {{submission.reference}} saved' } }, 0)
  attach('done')
  outline.push({ depth: 0, kind: 'end', text: 'End', node: 'done' })

  const names = [...new Set(plan.steps.map((s) => s.target.name))]
  return {
    name: (plan.workflow_name?.trim() || `${form.name}: save submissions`).slice(0, 120),
    description: `Made by "Map to data event": saves each submission of "${form.name}" to ${names.join(', ') || 'its targets'}${plan.steps.some((s) => s.source) ? ' (repeating items in their own rows)' : ''}.`,
    trigger_type: 'form_submitted',
    trigger_config: {},
    nodes,
    edges,
    tags: ['data-event'],
    outline,
  }
}
