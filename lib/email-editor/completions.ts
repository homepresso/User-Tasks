/**
 * `{{` autocomplete for the email editor (pure; the CodeMirror completion
 * source and the Design tab both call it). Built-in variables first, then
 * the template's declared variables, then extra names (e.g. a sample
 * form's fields).
 */

import { BUILTIN_EMAIL_VARIABLES, type EmailVariableDeclaration } from './variables'

export interface VariableCompletion {
  label: string
  detail: string
  info?: string
  /** Text inserted in place of what was typed after `{{` (closes the braces). */
  apply: string
  section: string
}

export function variableCompletions(textBefore: string, declarations: EmailVariableDeclaration[] = [], extra: Array<{ name: string; label?: string; group?: string }> = []): { from: number; options: VariableCompletion[] } | null {
  const m = /\{\{([\w.\-[\]]*)$/.exec(textBefore)
  if (!m) return null
  const typed = m[1].toLowerCase()
  const from = textBefore.length - m[1].length
  const seen = new Set<string>()
  const options: VariableCompletion[] = []
  const add = (o: VariableCompletion) => {
    const key = o.label.toLowerCase()
    if (seen.has(key)) return
    if (typed && !key.includes(typed) && !o.detail.toLowerCase().includes(typed)) return
    seen.add(key)
    options.push(o)
  }
  for (const v of BUILTIN_EMAIL_VARIABLES) add({ label: v.name, detail: v.label, info: v.description, apply: `${v.name}}}`, section: v.group })
  for (const d of declarations) add({ label: d.name, detail: d.label ?? 'Template variable', info: d.description, apply: `${d.name}}}`, section: 'This template' })
  for (const e of extra) add({ label: e.name, detail: e.label ?? e.name, apply: `${e.name}}}`, section: e.group ?? 'Sample data' })
  // Names that start with what was typed come first.
  options.sort((a, b) => Number(!a.label.toLowerCase().startsWith(typed)) - Number(!b.label.toLowerCase().startsWith(typed)))
  return { from, options }
}
