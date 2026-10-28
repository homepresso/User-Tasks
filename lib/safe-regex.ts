/**
 * ReDoS guard for user-supplied regular expressions (expression functions,
 * condition `matches`, the Regex node). Workflow and rule authors can type any
 * pattern, and JavaScript's backtracking engine can take exponential time on
 * patterns like `(a+)+$` — one bad pattern would stall the worker running it.
 *
 * The check is deliberately simple and conservative:
 *  - pattern length cap,
 *  - reject nested quantifiers (a quantified group whose body already
 *    contains an unbounded quantifier: `(a+)+`, `(\d*)*`, `(a|b+){2,}`),
 *  - subject (input) length cap.
 * It does not try to prove a pattern safe; it rejects the classic
 * catastrophic shape. Pure and client-safe (no imports).
 */

export const MAX_REGEX_PATTERN_LENGTH = 500
export const MAX_REGEX_INPUT_LENGTH = 100_000

export class UnsafeRegexError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeRegexError'
  }
}

interface Quantifier {
  /** A quantifier starts here. */
  quantifier: boolean
  /** No upper bound: `*`, `+`, `{n,}`. */
  unbounded: boolean
  /** Can repeat more than once: unbounded, or `{n,m}` / `{n}` with a bound above 1. */
  repeats: boolean
  length: number
}

function quantifierAt(pattern: string, i: number): Quantifier {
  const ch = pattern[i]
  if (ch === '*' || ch === '+') return { quantifier: true, unbounded: true, repeats: true, length: 1 }
  if (ch === '?') return { quantifier: true, unbounded: false, repeats: false, length: 1 }
  if (ch === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i))
    if (m) {
      const max = m[2] === undefined ? Number(m[1]) : m[3] === '' ? Infinity : Number(m[3])
      return { quantifier: true, unbounded: max === Infinity, repeats: max > 1, length: m[0].length }
    }
  }
  return { quantifier: false, unbounded: false, repeats: false, length: 0 }
}

/**
 * Returns a reason string when the pattern has a nested quantifier, else null.
 * Tracks groups on a stack; a group is "unbounded" when anything inside it
 * carries `*`, `+` or `{n,}`. Repeating such a group again (`)+`, `)*`,
 * `){2,5}`) is the nested-quantifier shape. Bounded inner repetition stays
 * allowed, so `(\d{3})+` and `(ab?)+` pass.
 */
export function findNestedQuantifier(pattern: string): string | null {
  const stack: boolean[] = [] // per open group: contains an unbounded quantifier
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') { i++; continue }
    if (inClass) { if (ch === ']') inClass = false; continue }
    if (ch === '[') { inClass = true; continue }
    if (ch === '(') {
      stack.push(false)
      if (pattern[i + 1] === '?') i++ // (?:  (?=  (?<name> — not a quantifier
      continue
    }
    if (ch === ')') {
      const innerUnbounded = stack.pop() ?? false
      const q = quantifierAt(pattern, i + 1)
      if (innerUnbounded && q.repeats) {
        return `nested quantifier near position ${i + 1} (a repeated group that itself repeats, e.g. (a+)+)`
      }
      // The group, quantified or not, counts as unbounded repetition for its parent.
      if (stack.length && (innerUnbounded || q.unbounded)) stack[stack.length - 1] = true
      if (q.quantifier) i += q.length
      continue
    }
    const q = quantifierAt(pattern, i)
    if (q.quantifier) {
      if (q.unbounded && stack.length) stack[stack.length - 1] = true
      i += q.length - 1
    }
  }
  return null
}

/**
 * Compile a user-supplied pattern after the safety checks. Throws
 * UnsafeRegexError (too long / nested quantifiers) or the native SyntaxError
 * for an invalid pattern.
 */
export function compileUserRegex(pattern: string, flags?: string): RegExp {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new UnsafeRegexError(`Regex rejected: pattern is ${pattern.length} characters (max ${MAX_REGEX_PATTERN_LENGTH})`)
  }
  const nested = findNestedQuantifier(pattern)
  if (nested) throw new UnsafeRegexError(`Regex rejected: ${nested} can take exponential time`)
  return new RegExp(pattern, flags)
}

/** Throw UnsafeRegexError when the subject string is over the input cap. */
export function assertRegexInput(input: string): string {
  if (input.length > MAX_REGEX_INPUT_LENGTH) {
    throw new UnsafeRegexError(`Regex rejected: input is ${input.length} characters (max ${MAX_REGEX_INPUT_LENGTH})`)
  }
  return input
}
