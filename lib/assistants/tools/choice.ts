/**
 * The Agent's "where to build" question (server side). When the person asks
 * to build something of the same kind as the item open on screen (a workflow
 * while the workflow builder is open, a form in the form designer…), the
 * Agent asks first — as a choice card with two buttons, never by silently
 * creating a new item. The labels and replies are fixed here (not written by
 * the model); the person's click comes back as their next message, and the
 * turn ends as soon as the question is shown.
 */
import type { AssistantToolDef } from '../engine'
import type { DesignerContext } from '../types'

export type OpenItemKind = 'workflow' | 'form' | 'data_table' | 'decision_table' | 'report' | 'agent'

export interface OpenItem { kind: OpenItemKind; noun: string; id: string; name: string | null }

const AREA_KIND: Partial<Record<DesignerContext['area'], { kind: OpenItemKind; noun: string }>> = {
  workflow: { kind: 'workflow', noun: 'workflow' },
  form: { kind: 'form', noun: 'form' },
  data: { kind: 'data_table', noun: 'data table' },
  decision_table: { kind: 'decision_table', noun: 'decision table' },
  report: { kind: 'report', noun: 'report' },
  agent: { kind: 'agent', noun: 'agent' },
}

/** The item open in a builder (kind, id, name), or null on a list / other screen. */
export function openItemOf(designer: DesignerContext | null | undefined): OpenItem | null {
  if (!designer?.item_id) return null
  const k = AREA_KIND[designer.area]
  if (!k) return null
  return { ...k, id: designer.item_id, name: designer.item_name ?? null }
}

export interface ChoiceOption { label: string; reply: string }

/** The question and the two fixed options for an open item. */
export function whereToBuildChoice(item: OpenItem): { question: string; options: ChoiceOption[] } {
  const named = item.name ? `“${item.name}”` : `this ${item.noun}`
  return {
    question: `Build it in ${named} (the ${item.noun} you have open), or create a new ${item.noun}?`,
    options: [
      { label: `Use the open ${item.noun}`, reply: `Use the open ${item.noun}${item.name ? ` “${item.name}”` : ''}.` },
      { label: `Create a new ${item.noun}`, reply: `Create a new ${item.noun}.` },
    ],
  }
}

export const WHERE_TO_BUILD_TOOL = 'ask_where_to_build'

export function whereToBuildTool(item: OpenItem): AssistantToolDef {
  return {
    name: WHERE_TO_BUILD_TOOL,
    description: `Ask the person whether to build in the ${item.noun} they have open or create a new ${item.noun}. Call this BEFORE creating a new ${item.noun} when they asked to build or create one without saying where. The question is shown as two buttons; their answer arrives as their next message — end your turn after calling it.`,
    parameters: {
      type: 'object',
      properties: { request: { type: 'string', description: `What the person asked to build, in a few words (e.g. "an approval workflow for leave")` } },
      required: [],
    },
    mode: 'read',
    stopsTurn: true,
    label: () => 'Asking where to build',
    run: async (_args, env) => {
      const { question, options } = whereToBuildChoice(item)
      env.emit({ type: 'choice', id: env.toolCallId, question, options })
      return { result: { shown_to_person: true, note: 'The person sees the question as buttons; their answer arrives as their next message. Stop here: do not create or change anything until they answer.' } }
    },
  }
}
