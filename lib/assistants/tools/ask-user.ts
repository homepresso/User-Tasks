/**
 * ask_user: the Agent's generic question with answer buttons (server side).
 *
 * Whenever the Agent needs the person to decide between a few concrete
 * options ("Assign to me for testing" / "The submitter's manager" / …), it
 * calls ask_user instead of asking in plain text. The panel shows the
 * question as buttons (plus an "Other…" free-text box when allow_other, and
 * toggles + Send when multi); the turn ends as soon as the question is
 * shown. The person's click comes back as their next message — shown as
 * their reply bubble ("Assign to me for testing") — and the conversation
 * continues from there. ask_where_to_build (./choice.ts) is the same card
 * with fixed labels.
 *
 * Arguments come from the model: they are bounded and cleaned here (2–6
 * options, short labels, no duplicates); a bad call gets an error back so
 * the model can retry.
 */
import type { AssistantToolDef } from '../engine'
import type { ChoiceOption } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments are JSON */

export const ASK_USER_TOOL = 'ask_user'
export const ASK_USER_LIMITS = { minOptions: 2, maxOptions: 6, question: 300, label: 80, value: 500, description: 160 } as const

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

export interface AskUserQuestion { question: string; options: ChoiceOption[]; allow_other: boolean; multi: boolean }

/** The model's arguments as a question card (throws a clear error for a bad call). */
export function normalizeAskUser(args: Record<string, any>): AskUserQuestion {
  const question = text(args.question, ASK_USER_LIMITS.question)
  if (!question) throw new Error('ask_user needs a question')
  const raw = Array.isArray(args.options) ? args.options : []
  const options: ChoiceOption[] = []
  for (const o of raw) {
    const label = text(typeof o === 'string' ? o : o?.label, ASK_USER_LIMITS.label)
    if (!label || options.some((x) => x.label.toLowerCase() === label.toLowerCase())) continue
    const value = text(o?.value, ASK_USER_LIMITS.value)
    const description = text(o?.description, ASK_USER_LIMITS.description)
    // The reply the model reads: the label, plus the value when it carries more (an id, a variable).
    options.push({ label, reply: value && value !== label ? `${label} (${value})` : label, ...(description ? { description } : {}) })
  }
  if (options.length < ASK_USER_LIMITS.minOptions) throw new Error(`ask_user needs ${ASK_USER_LIMITS.minOptions}–${ASK_USER_LIMITS.maxOptions} distinct options; for an open question with no options, ask in text`)
  if (options.length > ASK_USER_LIMITS.maxOptions) throw new Error(`ask_user takes at most ${ASK_USER_LIMITS.maxOptions} options — offer the likeliest and set allow_other for the rest`)
  return { question, options, allow_other: args.allow_other === true, multi: args.multi === true }
}

export function askUserTool(): AssistantToolDef {
  return {
    name: ASK_USER_TOOL,
    description: 'Ask the person to choose between a few concrete options, shown as buttons in the chat (2–6 options; allow_other adds an "Other…" text box; multi lets them pick several). Use it whenever you need the person to decide something with a few likely answers — never ask such questions in plain text. Their answer arrives as their next message: end your turn after calling it.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question, short and specific (e.g. "Who should the Manager approval task go to?")' },
        options: {
          type: 'array',
          minItems: ASK_USER_LIMITS.minOptions,
          maxItems: ASK_USER_LIMITS.maxOptions,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'The button text, a few words (e.g. "Assign to me for testing")' },
              value: { type: 'string', description: 'Optional: what the answer means for you when the label is not enough (an id, a variable such as {{submitted_by_manager_id}})' },
              description: { type: 'string', description: 'Optional: one short line under the button' },
            },
            required: ['label'],
          },
        },
        allow_other: { type: 'boolean', description: 'Add an "Other…" free-text answer (for open questions with suggested answers)' },
        multi: { type: 'boolean', description: 'Let the person choose several options' },
      },
      required: ['question', 'options'],
    },
    mode: 'read',
    stopsTurn: true,
    label: () => 'Asking you',
    run: async (args, env) => {
      // A bad call throws (the engine answers it as an error and the turn goes on, so the model can retry).
      const q = normalizeAskUser(args)
      env.emit({ type: 'choice', id: env.toolCallId, question: q.question, options: q.options, ...(q.allow_other ? { allow_other: true } : {}), ...(q.multi ? { multi: true } : {}) })
      return { result: { shown_to_person: true, note: 'The person sees the question as buttons; their answer arrives as their next message. Stop here and wait for it — do not create or change anything that depends on the answer.' } }
    },
  }
}
