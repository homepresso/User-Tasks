/**
 * Canonical condition operator evaluation, shared across the form rules engine,
 * component visibility, and (by vocabulary) decision tables.
 *
 * Before this module, four subsystems each had their own operator switch with
 * subtly different names and coercion: the rules engine used `gt`/String()-equality,
 * component visibility used loose `==`, decision tables used `greater_than`, and
 * validation used its own cross-field operators. That meant "the same" condition
 * behaved differently depending on where it ran.
 *
 * This module centralizes the operator semantics and normalizes the alternate
 * spellings (`greater_than` → `gt`, etc.) so authors see one vocabulary. It is
 * pure and client-safe (its only import, ./safe-regex, is too).
 */

import { assertRegexInput, compileUserRegex } from './safe-regex'

export type CanonicalOperator =
  | 'equals' | 'not_equals'
  | 'contains' | 'not_contains'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'is_empty' | 'is_not_empty'
  | 'is_true' | 'is_false'
  | 'starts_with' | 'ends_with'
  | 'matches' | 'in'
  | 'changed'
  | 'equals_field' | 'not_equals_field'
  | 'gt_field' | 'lt_field' | 'gte_field' | 'lte_field'
  | 'has_role' | 'has_permission' | 'in_team'

/** Alternate operator spellings (e.g. decision tables) → canonical form. */
const OPERATOR_ALIASES: Record<string, CanonicalOperator> = {
  greater_than: 'gt',
  greater_than_or_equal: 'gte',
  less_than: 'lt',
  less_than_or_equal: 'lte',
  '>': 'gt',
  '<': 'lt',
  '>=': 'gte',
  '<=': 'lte',
  '==': 'equals',
  '!=': 'not_equals',
  eq: 'equals',
  ne: 'not_equals',
  not_equal: 'not_equals',
}

export function normalizeOperator(operator: string): string {
  return OPERATOR_ALIASES[operator] ?? operator
}

const KNOWN_OPERATORS = new Set<string>([
  'equals', 'not_equals', 'contains', 'not_contains', 'gt', 'lt', 'gte', 'lte',
  'is_empty', 'is_not_empty', 'is_true', 'is_false', 'starts_with', 'ends_with',
  'matches', 'in', 'changed', 'equals_field', 'not_equals_field',
  'gt_field', 'lt_field', 'gte_field', 'lte_field', 'has_role', 'has_permission', 'in_team',
])

/** True if the operator (or a known alias) is one this module can evaluate. */
export function isKnownOperator(operator: string): boolean {
  return KNOWN_OPERATORS.has(normalizeOperator(operator))
}

export function isTruthyValue(value: any): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return false
    if (['false', '0', 'no', 'off', 'null', 'undefined'].includes(normalized)) return false
    return true
  }
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value)
}

export function valuesEqual(left: any, right: any): boolean {
  if (left === right) return true
  if ((left == null || left === '') && (right == null || right === '')) return true
  if (typeof left === 'object' || typeof right === 'object') {
    try {
      return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
    } catch {
      return false
    }
  }
  return String(left ?? '') === String(right ?? '')
}

function toArray(value: any): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (value == null || value === '') return []
  return [String(value)]
}

export interface EvaluateOperatorOptions {
  /** Resolved value of `compareField` for field-to-field operators. */
  compareValue?: any
  /** Previous value of the field, for the `changed` operator. */
  previousValue?: any
}

/**
 * Evaluate a single operator against a field value (`fv`) and a target value (`cv`).
 * Semantics are ported verbatim from the form rules engine so existing rules keep
 * behaving identically; visibility gains the same (predictable, String-based)
 * equality instead of its old loose `==`.
 */
export function evaluateOperator(
  operator: string,
  fv: any,
  cv?: any,
  options: EvaluateOperatorOptions = {},
): boolean {
  const op = normalizeOperator(operator)
  const { compareValue, previousValue } = options
  switch (op) {
    case 'equals': return String(fv ?? '') === String(cv ?? '')
    case 'not_equals': return String(fv ?? '') !== String(cv ?? '')
    case 'contains': return String(fv ?? '').includes(String(cv ?? ''))
    case 'not_contains': return !String(fv ?? '').includes(String(cv ?? ''))
    case 'gt': return Number(fv) > Number(cv)
    case 'lt': return Number(fv) < Number(cv)
    case 'gte': return Number(fv) >= Number(cv)
    case 'lte': return Number(fv) <= Number(cv)
    // Plain falsiness (!fv) would misclassify legitimate 0 / false values as
    // "empty" — only null/undefined/'' and empty arrays count as empty.
    case 'is_empty': return fv === null || fv === undefined || fv === '' || (Array.isArray(fv) && !fv.length)
    case 'is_not_empty': return !(fv === null || fv === undefined || fv === '' || (Array.isArray(fv) && !fv.length))
    case 'is_true': return isTruthyValue(fv)
    case 'is_false': return !isTruthyValue(fv)
    case 'starts_with': return String(fv ?? '').startsWith(String(cv ?? ''))
    case 'ends_with': return String(fv ?? '').endsWith(String(cv ?? ''))
    // ReDoS guard: an unsafe or over-long pattern/input reads as "no match",
    // the same as an invalid pattern.
    case 'matches': { try { return compileUserRegex(String(cv ?? '')).test(assertRegexInput(String(fv ?? ''))) } catch { return false } }
    case 'in': return String(cv ?? '').split(',').map((s) => s.trim()).includes(String(fv ?? ''))
    case 'changed': return !valuesEqual(fv, previousValue)
    case 'equals_field': return String(fv ?? '') === String(compareValue ?? '')
    case 'not_equals_field': return String(fv ?? '') !== String(compareValue ?? '')
    case 'gt_field': return Number(fv) > Number(compareValue)
    case 'lt_field': return Number(fv) < Number(compareValue)
    case 'gte_field': return Number(fv) >= Number(compareValue)
    case 'lte_field': return Number(fv) <= Number(compareValue)
    case 'has_role': return toArray(fv).includes(String(cv ?? ''))
    case 'has_permission': return toArray(fv).includes(String(cv ?? ''))
    case 'in_team': return toArray(fv).includes(String(cv ?? ''))
    default: return false
  }
}
