export type DecisionFieldType = 'text' | 'number' | 'boolean' | 'date'

export interface DecisionTableField {
  id: string
  key: string
  label: string
  type: DecisionFieldType
}

export interface DecisionTableCondition {
  id: string
  inputKey: string
  operator: string
  value: string
}

export interface DecisionTableRule {
  id: string
  label: string
  enabled?: boolean
  conditions: DecisionTableCondition[]
  outputs: Record<string, any>
}

export interface DecisionMatchResult {
  matched: boolean
  rule: DecisionTableRule | null
  outputs: Record<string, any>
}

function parseByType(value: any, type: DecisionFieldType): any {
  if (value == null) return value
  if (type === 'number') {
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  }
  if (type === 'boolean') {
    if (value === true || value === false) return value
    const normalized = String(value).trim().toLowerCase()
    if (['true', '1', 'yes'].includes(normalized)) return true
    if (['false', '0', 'no'].includes(normalized)) return false
    return null
  }
  if (type === 'date') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
  }
  return String(value)
}

function tryParseNumber(value: any): number | null {
  if (value == null || String(value).trim() === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function tryParseDate(value: any): number | null {
  if (value == null || String(value).trim() === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

function normalizeForComparison(left: any, right: any, type: DecisionFieldType) {
  if (type === 'number') {
    return { left: tryParseNumber(left), right: tryParseNumber(right) }
  }
  if (type === 'date') {
    return { left: tryParseDate(left), right: tryParseDate(right) }
  }

  // Be forgiving for comparison operators when the designer left the field as text
  // but entered numeric or date-like values.
  const numericLeft = tryParseNumber(left)
  const numericRight = tryParseNumber(right)
  if (numericLeft != null && numericRight != null) {
    return { left: numericLeft, right: numericRight }
  }

  const dateLeft = tryParseDate(left)
  const dateRight = tryParseDate(right)
  if (dateLeft != null && dateRight != null) {
    return { left: dateLeft, right: dateRight }
  }

  return {
    left: parseByType(left, type),
    right: parseByType(right, type),
  }
}

export function evaluateDecisionCondition(
  condition: DecisionTableCondition,
  field: DecisionTableField | undefined,
  inputs: Record<string, any>,
): boolean {
  const rawLeft = inputs[condition.inputKey]
  const type = field?.type ?? 'text'
  const parsed = normalizeForComparison(rawLeft, condition.value, type)
  const left = parsed.left
  const right = parsed.right
  const leftText = String(rawLeft ?? '').toLowerCase()
  const rightText = String(condition.value ?? '').toLowerCase()

  // Wildcard match — LLMs and hand-authored rules often use "*"
  // to mean "match any value for this input". Without this, a rule
  // like `category equals "*"` is compared as literal equality
  // against the real value and never matches, so the whole rule
  // fails. We only apply this to equals/not_equals so empty-string
  // equality (a valid check) keeps its meaning.
  const normalizedRight = String(condition.value ?? '').trim()
  if (normalizedRight === '*') {
    if (condition.operator === 'equals') return true
    if (condition.operator === 'not_equals') return false
  }

  switch (condition.operator) {
    case 'equals':
      return left === right
    case 'not_equals':
      return left !== right
    case 'contains':
      return leftText.includes(rightText)
    case 'not_contains':
      return !leftText.includes(rightText)
    case 'starts_with':
      return leftText.startsWith(rightText)
    case 'ends_with':
      return leftText.endsWith(rightText)
    case 'greater_than':
      return left != null && right != null && left > right
    case 'greater_than_or_equal':
      return left != null && right != null && left >= right
    case 'less_than':
      return left != null && right != null && left < right
    case 'less_than_or_equal':
      return left != null && right != null && left <= right
    case 'is_empty':
      return rawLeft == null || String(rawLeft).trim() === ''
    case 'is_not_empty':
      return !(rawLeft == null || String(rawLeft).trim() === '')
    default:
      return false
  }
}

export function evaluateDecisionTable(
  inputs: DecisionTableField[],
  rules: DecisionTableRule[],
  values: Record<string, any>,
): DecisionMatchResult {
  const inputMap = new Map(inputs.map((field) => [field.key, field]))

  // Rules are evaluated top to bottom; the first enabled rule whose
  // conditions all match wins. A rule with no conditions (or only blank rows
  // with no input chosen, as the editor adds them) is a catch-all: it always
  // matches, so place it last as the default.
  for (const rule of rules) {
    if (rule.enabled === false) continue
    const conditions = (Array.isArray(rule.conditions) ? rule.conditions : [])
      .filter((condition) => String(condition?.inputKey ?? '').trim() !== '')
    const matched = conditions.every((condition) =>
      evaluateDecisionCondition(condition, inputMap.get(condition.inputKey), values),
    )
    if (matched) {
      return {
        matched: true,
        rule,
        outputs: { ...(rule.outputs ?? {}) },
      }
    }
  }

  return {
    matched: false,
    rule: null,
    outputs: {},
  }
}
