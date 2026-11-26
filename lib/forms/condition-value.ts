/**
 * A rule condition's right-hand side as the designer edits it: a fixed
 * value, or another field / variable of the form ("end date is after start
 * date", "amount is at most the budget"). Stored the same way either way —
 * the condition's `value` string, a field being the single placeholder
 * `{{<path>}}` — so the engine (lib/forms/form-rules.ts ruleConditionMet,
 * which resolves `{{…}}` against the live values on the client and the
 * submitted values on the server), the rule graph and the MCP rule shapes
 * are unchanged. Pure and isomorphic.
 */

export type ConditionValueMode = 'value' | 'field'

const SINGLE_REF_RE = /^\{\{\s*([\w.\-[\]$*]+)\s*\}\}$/

/** The path a value refers to when it is exactly one placeholder (`{{amount}}` → `amount`), else null. */
export function conditionValueRef(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const m = SINGLE_REF_RE.exec(value.trim())
  return m ? m[1] : null
}

/** The value that compares against `path` (a field key, `form.<key>`, `user.email`, `param.x`…). */
export function conditionFieldValue(path: string): string {
  return path ? `{{${path}}}` : ''
}

/** How the designer shows a value: "field" when it is one placeholder naming a known subject, else "value". */
export function conditionValueMode(value: string | null | undefined, known: Iterable<string>): ConditionValueMode {
  const ref = conditionValueRef(value)
  if (!ref) return 'value'
  const set = new Set(known)
  const bare = ref.replace(/^(?:form|task_data|task\.data)\./, '')
  return set.has(ref) || set.has(bare) ? 'field' : 'value'
}
