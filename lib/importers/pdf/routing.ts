/**
 * Printed routing instructions → show / hide rules (pure, client-safe; no AI).
 *
 * A deterministic English phrase grammar for what paper forms print beside
 * answers and questions:
 *
 *   conditional   "If No, go to question 10" · "If you answered 'Yes' to
 *                 question 3, skip to Section C"
 *   option_arrow  "No ➔ SKIP to question 6a" · "Less than 1 acre → Go to Q7"
 *   show_if       "Answer questions 4–5 only if you ticked Yes at question 3"
 *                 · "Complete this section only if …"
 *   otherwise     "Otherwise, go to question 19"
 *   goto          "Go to question 7" (no condition)
 *
 * Linking (linkRouting) needs printed question numbers: a jump from
 * question A to question B hides the questions in between while the answer
 * holds — a HIGH confidence rule (enabled) when the answer and both
 * questions are found, otherwise a LOW one (created turned off, the
 * sentence kept in its description). Section / page / part targets, and
 * conditions without a question, are always low.
 */

import type { PdfFormModel, PdfItem, PdfRule } from './model'

export type RoutingKind = 'conditional' | 'option_arrow' | 'show_if' | 'otherwise' | 'goto'

export interface RoutingHit {
  kind: RoutingKind
  /** The answer text the instruction depends on ("No", "Less than 1 acre"). */
  when?: string
  /** The question the answer belongs to, when the sentence names one. */
  whenQuestion?: string
  /** question | section | part | page | step | box (undefined: a bare number = a question). */
  targetType?: string
  target?: string
  /** show_if: the questions it applies to. */
  from?: string
  to?: string
  section?: string
  match: string
}

const VERB = String.raw`(?:skip|go|continue|proceed|move|turn|jump)\s+(?:on\s+|straight\s+|directly\s+|now\s+|ahead\s+)?to`
const TARGET = String.raw`(question|questions|q\.?|section|part|page|step|box)?\s*(\d{1,3}[a-z]?|[A-Z]\b)`
const QUOTE = `["'‘’“”]?`
const ANSWERED = String.raw`(?:you\s+(?:answered|ticked|checked|marked|selected|said|chose)\s+)?`

const CONDITIONAL = new RegExp(String.raw`\bif\s+${ANSWERED}${QUOTE}(yes|no|none|not sure|don['’]t know|[^,.;:"”’]{1,40}?)${QUOTE}(?:\s+(?:to|at|in|for)\s+(?:question|q\.?)\s*(\d{1,3}[a-z]?))?\s*[,:–—-]?\s*(?:please\s+|then\s+)?${VERB}\s+${TARGET}`, 'i')
const OTHERWISE = new RegExp(String.raw`\b(?:otherwise|if not|else)\s*[,:]?\s*${VERB}\s+${TARGET}`, 'i')
const SHOW_IF = new RegExp(String.raw`\b(?:only\s+)?(?:answer|complete|fill\s+in)\s+(?:this(?:\s+question|\s+section|\s+part)?|questions?\s+(\d{1,3}[a-z]?)(?:\s*(?:–|—|-|to|and|through)\s*(\d{1,3}[a-z]?))?|section\s+([A-Z]|\d+))\s+(?:only\s+)?if\s+${ANSWERED}${QUOTE}([^"”’;]{1,80}?)${QUOTE}(?:\s+(?:to|at|in|for)\s+(?:question|q\.?)\s*(\d{1,3}[a-z]?))?(?=[;.,]|$)`, 'i')
const GOTO = new RegExp(String.raw`^\s*(?:now\s+|please\s+)?${VERB}\s+${TARGET}`, 'i')
const ARROW = new RegExp(String.raw`^(.{1,80}?)\s*(?:➔|➜|→|->|►|▶|–|—|-|\()?\s*${VERB}\s+${TARGET}`, 'i')

/** Routing instructions in one line / sentence (first match per kind; an "otherwise" may follow another). */
export function findRouting(text: string): RoutingHit[] {
  const s = String(text ?? '').replace(/\s+/g, ' ').slice(0, 600)
  if (!/\b(?:skip|go|continue|proceed|move|turn|jump|answer|complete|fill)\b/i.test(s)) return []
  const hits: RoutingHit[] = []
  let m: RegExpExecArray | null
  if ((m = CONDITIONAL.exec(s))) hits.push({ kind: 'conditional', when: m[1].trim(), whenQuestion: m[2], targetType: m[3]?.toLowerCase(), target: m[4], match: m[0] })
  else if ((m = SHOW_IF.exec(s))) hits.push({ kind: 'show_if', from: m[1], to: m[2], section: m[3], when: m[4].trim(), whenQuestion: m[5], match: m[0] })
  else if ((m = GOTO.exec(s))) hits.push({ kind: 'goto', targetType: m[1]?.toLowerCase(), target: m[2], match: m[0] })
  else if ((m = ARROW.exec(s)) && !/^\s*(?:if|otherwise|else)\b/i.test(m[1])) hits.push({ kind: 'option_arrow', when: m[1].replace(/[\s(➔➜→►▶–—-]+$/, '').trim(), targetType: m[2]?.toLowerCase(), target: m[3], match: m[0] })
  if ((m = OTHERWISE.exec(s))) hits.push({ kind: 'otherwise', targetType: m[1]?.toLowerCase(), target: m[2], match: m[0] })
  return hits
}

const isQuestionTarget = (t?: string) => !t || /^(question|questions|q\.?)$/i.test(t)
const norm = (s: string) => s.toLowerCase().replace(/[‘’“”"']/g, '').replace(/\s+/g, ' ').trim()

/** Printed question number at the start of a line ("4.", "Q4", "Question 6a", "12 What …"). */
export function questionNumberOf(line: string): { num: string; rest: string } | null {
  const m = /^(?:Q(?:uestion)?\.?\s*)?(\d{1,3})([a-z])?(?:[.)]|\s)\s*(.*)$/.exec(line.trim())
  if (!m) return null
  const rest = m[3] ?? ''
  // "2024 Form" / "10 000" are not question numbers: what follows must be text (or nothing).
  if (rest && !/^[A-Za-z“"(‘'¿]/.test(rest)) return null
  return { num: `${m[1]}${m[2] ?? ''}`, rest }
}

/** Question order: "6" < "6a" < "6b" < "7". */
export function questionOrder(q: string): number {
  const m = /^(\d{1,3})([a-z])?$/i.exec(q)
  if (!m) return Number.NaN
  return Number(m[1]) * 100 + (m[2] ? m[2].toLowerCase().charCodeAt(0) - 96 : 0)
}

export interface RoutingText {
  /** The item it was printed beside (an option's trailing text, the question's own text). */
  itemId: string
  /** The option the text sits next to (option_arrow / conditional attached to one answer). */
  optionValue?: string
  text: string
  page: number
}

interface LinkContext {
  model: PdfFormModel
  texts: RoutingText[]
  nextId: () => string
}

function optionFor(item: PdfItem, when: string): { value: string; label: string } | null {
  const w = norm(when)
  if (!w) return null
  if (item.type === 'boolean') {
    if (/^(yes|true|checked|ticked)$/.test(w)) return { value: 'true', label: 'checked' }
    if (/^(no|false|unchecked)$/.test(w)) return { value: 'false', label: 'not checked' }
    return null
  }
  for (const o of item.options ?? []) {
    const l = norm(o.label || o.value)
    const v = norm(o.value)
    if (l === w || v === w) return { value: o.value, label: o.label || o.value }
  }
  for (const o of item.options ?? []) {
    const l = norm(o.label || o.value)
    if (l.startsWith(w) || (w.length > 3 && w.startsWith(l))) return { value: o.value, label: o.label || o.value }
  }
  return null
}

/**
 * What "go to question B" from an answer skips: the items after the question's item in reading
 * order (its own follow-ups included) up to the first item of question B or later.
 */
export function itemsSkipped(model: PdfFormModel, subject: PdfItem, toQ: string): PdfItem[] {
  const a = questionOrder(subject.question ?? '')
  const b = questionOrder(toQ)
  if (!(b > a)) return []
  const start = model.items.indexOf(subject)
  const out: PdfItem[] = []
  for (let i = start + 1; i < model.items.length; i++) {
    const it = model.items[i]
    const q = it.question ? questionOrder(it.question) : Number.NaN
    if (q >= b) break
    if (q < a) continue
    out.push(it)
  }
  return out
}

function itemsInRange(model: PdfFormModel, fromQ: string, toQ: string): PdfItem[] {
  const a = questionOrder(fromQ)
  const b = questionOrder(toQ)
  if (!(b >= a)) return []
  return model.items.filter((i) => i.question && questionOrder(i.question) >= a && questionOrder(i.question) <= b)
}

function questionItem(model: PdfFormModel, q: string): PdfItem | null {
  const list = model.items.filter((i) => i.question && questionOrder(i.question) === questionOrder(q))
  return list.find((i) => i.type === 'choice' || i.type === 'boolean') ?? list[0] ?? null
}

/** Turn printed routing text into rules on the model (adds to model.rules). */
export function linkRouting(ctx: LinkContext): void {
  const { model } = ctx
  const byId = new Map(model.items.map((i) => [i.id, i]))
  const seen = new Set<string>()
  const add = (rule: Omit<PdfRule, 'id' | 'origin' | 'source'>) => {
    const key = `${rule.mode}|${rule.when?.item}|${rule.when?.value}|${rule.targets.join(',')}|${rule.original}`
    if (seen.has(key)) return
    seen.add(key)
    model.rules.push({ id: ctx.nextId(), origin: 'deterministic', source: 'printed_text', ...rule })
  }
  for (const t of ctx.texts) {
    const item = byId.get(t.itemId)
    if (!item) continue
    for (const hit of findRouting(t.text)) {
      const original = t.text.replace(/\s+/g, ' ').trim().slice(0, 400)
      if (hit.kind === 'option_arrow' || hit.kind === 'conditional') {
        const subject = hit.whenQuestion ? questionItem(model, hit.whenQuestion) ?? item : item
        const option = t.optionValue && hit.kind === 'option_arrow'
          ? (subject.options ?? []).find((o) => o.value === t.optionValue) ?? optionFor(subject, hit.when ?? '')
          : optionFor(subject, hit.when ?? '') ?? (t.optionValue ? (subject.options ?? []).find((o) => o.value === t.optionValue) ?? null : null)
        const when = option ? { item: subject.id, op: 'equals' as const, value: option.value } : null
        if (!isQuestionTarget(hit.targetType)) {
          add({ mode: 'hide', when, targets: [], confidence: 'low', original, reason: `it jumps to ${hit.targetType} ${hit.target}: set the targets by hand` })
          continue
        }
        const between = subject.question && hit.target ? itemsSkipped(model, subject, hit.target) : []
        const targetExists = hit.target ? model.items.some((i) => i.question && questionOrder(i.question) === questionOrder(hit.target!)) : false
        if (when && between.length && targetExists) add({ mode: 'hide', when, targets: between.map((i) => i.id), confidence: 'high', original })
        else add({
          mode: 'hide', when, targets: between.map((i) => i.id), confidence: 'low', original,
          reason: !when ? `the answer "${hit.when ?? ''}" was not matched to an option` : !subject.question ? 'the question number was not found' : !targetExists ? `question ${hit.target} was not found` : 'no questions were found in between',
        })
      } else if (hit.kind === 'show_if') {
        const refQ = hit.whenQuestion ? questionItem(model, hit.whenQuestion) : null
        const option = refQ ? optionFor(refQ, hit.when ?? '') : null
        const targets = hit.from ? itemsInRange(model, hit.from, hit.to ?? hit.from) : item.question ? model.items.filter((i) => i.question && questionOrder(i.question) === questionOrder(item.question!)) : [item]
        const when = refQ && option ? { item: refQ.id, op: 'equals' as const, value: option.value } : null
        add({
          mode: 'show', when, targets: targets.filter((x) => x.id !== refQ?.id).map((x) => x.id), confidence: when && targets.length && !hit.section ? 'high' : 'low', original,
          ...(when && targets.length && !hit.section ? {} : { reason: hit.section ? `it applies to section ${hit.section}: set the targets by hand` : !refQ ? `"${hit.when}" does not name a question` : !option ? `the answer "${hit.when}" was not matched to an option of question ${hit.whenQuestion}` : 'the questions it applies to were not found' }),
        })
      } else {
        add({ mode: 'hide', when: null, targets: [], confidence: 'low', original, reason: hit.kind === 'otherwise' ? 'an "otherwise" jump: it depends on the instruction before it' : 'a jump without a condition' })
      }
    }
  }
}
