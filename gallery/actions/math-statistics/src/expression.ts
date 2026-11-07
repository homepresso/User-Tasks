/**
 * A small, safe arithmetic expression evaluator (no eval / Function).
 *
 *   expr     := additive
 *   additive := term (('+' | '-') term)*
 *   term     := unary (('*' | '/' | '%') unary)*
 *   unary    := ('-' | '+') unary | power
 *   power    := primary ('^' unary)?          right-associative; -2^2 = -4
 *   primary  := number | name | name '(' args ')' | '(' expr ')'
 *
 * Names are variables (dotted paths into the variables object, e.g.
 * order.total) or the constants pi and e. Functions: abs round floor ceil
 * sqrt min max pow log ln exp sin cos tan.
 */

import { getPath, toNumber } from '../../shared/inputs'

type Token =
  | { t: 'num'; v: number; at: number }
  | { t: 'name'; v: string; at: number }
  | { t: 'op'; v: string; at: number }

const MAX_LENGTH = 4000
const MAX_DEPTH = 64

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    const numMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))
    if (numMatch) {
      tokens.push({ t: 'num', v: Number(numMatch[0]), at: i })
      i += numMatch[0].length
      continue
    }
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i))
    if (nameMatch) {
      tokens.push({ t: 'name', v: nameMatch[0], at: i })
      i += nameMatch[0].length
      continue
    }
    if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ t: 'op', v: ch, at: i })
      i++
      continue
    }
    if (ch === '×' || ch === '÷' || ch === '\u2212') {
      tokens.push({ t: 'op', v: ch === '×' ? '*' : ch === '÷' ? '/' : '-', at: i })
      i++
      continue
    }
    throw new Error(`Unexpected character "${ch}" at position ${i + 1}`)
  }
  return tokens
}

const FUNCTIONS: Record<string, { min: number; max: number; fn: (...a: number[]) => number }> = {
  abs: { min: 1, max: 1, fn: Math.abs },
  floor: { min: 1, max: 1, fn: Math.floor },
  ceil: { min: 1, max: 1, fn: Math.ceil },
  sqrt: {
    min: 1, max: 1, fn: (x) => {
      if (x < 0) throw new Error('sqrt of a negative number')
      return Math.sqrt(x)
    },
  },
  round: {
    min: 1, max: 2, fn: (x, d = 0) => {
      if (!Number.isInteger(d)) throw new Error('round(x, decimals): decimals must be a whole number')
      const f = Math.pow(10, d)
      const v = Math.abs(x) * f
      return Math.sign(x) * Math.round(Number(v.toPrecision(15))) / f
    },
  },
  min: { min: 1, max: 100, fn: (...a) => Math.min(...a) },
  max: { min: 1, max: 100, fn: (...a) => Math.max(...a) },
  pow: { min: 2, max: 2, fn: (a, b) => Math.pow(a, b) },
  log: {
    min: 1, max: 2, fn: (x, base = 10) => {
      if (x <= 0) throw new Error('log of zero or a negative number')
      if (base <= 0 || base === 1) throw new Error('log base must be positive and not 1')
      return base === 10 ? Math.log10(x) : Math.log(x) / Math.log(base)
    },
  },
  ln: {
    min: 1, max: 1, fn: (x) => {
      if (x <= 0) throw new Error('ln of zero or a negative number')
      return Math.log(x)
    },
  },
  exp: { min: 1, max: 1, fn: Math.exp },
  sin: { min: 1, max: 1, fn: Math.sin },
  cos: { min: 1, max: 1, fn: Math.cos },
  tan: { min: 1, max: 1, fn: Math.tan },
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E }

export function evaluateExpression(expression: string, variables: Record<string, unknown>): number {
  if (expression.length > MAX_LENGTH) throw new Error(`expression is longer than ${MAX_LENGTH} characters`)
  const tokens = tokenize(expression)
  if (tokens.length === 0) throw new Error('expression is empty')
  let pos = 0
  let depth = 0

  const peek = () => tokens[pos]
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v
  const where = () => (peek() ? `at position ${peek()!.at + 1}` : 'at the end')
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}" ${where()}`)
    pos++
  }
  const enter = () => {
    if (++depth > MAX_DEPTH) throw new Error('expression is nested too deeply')
  }

  const variable = (name: string): number => {
    let raw: unknown = getPath(variables, name)
    if (raw === undefined) {
      const lower = name.toLowerCase()
      if (lower in CONSTANTS) return CONSTANTS[lower]
      throw new Error(`Unknown variable "${name}"`)
    }
    if (raw === null || raw === '') throw new Error(`Variable "${name}" is empty`)
    if (typeof raw === 'boolean') raw = raw ? 1 : 0
    const n = toNumber(raw)
    if (n === null || !Number.isFinite(n)) throw new Error(`Variable "${name}" is not a number`)
    return n
  }

  function additive(): number {
    let left = term()
    while (isOp('+') || isOp('-')) {
      const op = tokens[pos++].v
      const right = term()
      left = op === '+' ? left + right : left - right
    }
    return left
  }
  function term(): number {
    let left = unary()
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tokens[pos++].v
      const right = unary()
      if ((op === '/' || op === '%') && right === 0) throw new Error('Division by zero')
      left = op === '*' ? left * right : op === '/' ? left / right : left % right
    }
    return left
  }
  function unary(): number {
    if (isOp('-') || isOp('+')) {
      const op = tokens[pos++].v
      enter()
      const v = unary()
      depth--
      return op === '-' ? -v : v
    }
    return power()
  }
  function power(): number {
    const base = primary()
    if (isOp('^')) {
      pos++
      enter()
      const exponent = unary()
      depth--
      return Math.pow(base, exponent)
    }
    return base
  }
  function primary(): number {
    const tok = peek()
    if (!tok) throw new Error('expression ended unexpectedly')
    if (tok.t === 'num') {
      pos++
      return tok.v
    }
    if (tok.t === 'name') {
      pos++
      if (isOp('(')) {
        const fname = tok.v.toLowerCase()
        const spec = FUNCTIONS[fname]
        if (!spec) throw new Error(`Unknown function "${tok.v}" (use ${Object.keys(FUNCTIONS).join(', ')})`)
        pos++
        enter()
        const args: number[] = []
        if (!isOp(')')) {
          args.push(additive())
          while (isOp(',')) {
            pos++
            args.push(additive())
          }
        }
        expect(')')
        depth--
        if (args.length < spec.min || args.length > spec.max) {
          throw new Error(`${fname}() takes ${spec.min === spec.max ? spec.min : `${spec.min} to ${spec.max}`} argument${spec.max === 1 ? '' : 's'}`)
        }
        return spec.fn(...args)
      }
      return variable(tok.v)
    }
    if (tok.v === '(') {
      pos++
      enter()
      const v = additive()
      expect(')')
      depth--
      return v
    }
    throw new Error(`Unexpected "${tok.v}" ${where()}`)
  }

  const result = additive()
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].t === 'num' ? String((tokens[pos] as { v: number }).v) : tokens[pos].v}" ${where()}`)
  if (!Number.isFinite(result)) throw new Error('The result is not a finite number')
  return result
}
