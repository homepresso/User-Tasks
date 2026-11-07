/**
 * The local test harness (npm test). Runs the BUILT module (dist/action.js,
 * exactly what you upload) in the same QuickJS WebAssembly sandbox UserTasks
 * uses, with the limits from manifest.json:
 *
 *   1. every operation's `sample` inputs from manifest.json (they must
 *      succeed and return every declared output), then
 *   2. every case in test/cases.json (`expect` outputs or `expect_error`).
 *
 * Capabilities are enforced as in the app: HTTP only to manifest hosts,
 * secrets only by declared name, data and files only when declared, all
 * answered by the case's `mocks`.
 *
 *   npm test                    everything
 *   npm test -- invoice         only operations / cases whose name contains "invoice"
 *   npm test -- --verbose       print outputs and logs too
 */
import { existsSync, readFileSync } from 'node:fs'
import type { ActionField, ActionManifest, ActionRunResult } from '../vendor/usertasks-action/contract'
import { runAction, type ActionMocks } from '../vendor/usertasks-action/testing'

interface TestCase {
  name?: string
  operation: string
  inputs?: Record<string, unknown>
  expect?: Record<string, unknown>
  expect_error?: string | boolean
  /** As runAction's mocks, except `http` is a fixed response here (JSON has no functions). */
  mocks?: Omit<ActionMocks, 'http'> & { http?: { status?: number; headers?: Record<string, string>; text?: string; json?: unknown } }
}

function mocksOf(testCase: TestCase): ActionMocks | undefined {
  if (!testCase.mocks) return undefined
  const { http, ...rest } = testCase.mocks
  return http ? { ...rest, http: () => http } : rest
}

const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const filter = args.find((a) => !a.startsWith('--'))?.toLowerCase()

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as ActionManifest
const entry = manifest.entry ?? 'dist/action.js'
if (!existsSync(entry)) {
  console.error(`${entry} is missing: run npm run build first`)
  process.exit(1)
}
const module = readFileSync(entry, 'utf8')
const cases: TestCase[] = existsSync('test/cases.json') ? (JSON.parse(readFileSync('test/cases.json', 'utf8')).cases ?? []) : []

let passed = 0
let failed = 0

function typeProblem(field: ActionField, value: unknown): string | null {
  if (value === null || value === undefined) return null
  const t = field.type
  if ((t === 'number' || t === 'integer') && typeof value !== 'number') return `${field.name} should be a number`
  if (t === 'integer' && !Number.isInteger(value)) return `${field.name} should be an integer`
  if (t === 'boolean' && typeof value !== 'boolean') return `${field.name} should be a boolean`
  if (['string', 'text', 'date', 'datetime', 'select'].includes(t) && typeof value !== 'string') return `${field.name} should be a string`
  if (t === 'array' && !Array.isArray(value)) return `${field.name} should be an array`
  if (t === 'object' && (typeof value !== 'object' || Array.isArray(value))) return `${field.name} should be an object`
  return null
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function report(label: string, result: ActionRunResult, problems: string[]): void {
  const timing = `${result.stats.duration_ms} ms, ${result.stats.host_calls} host calls`
  if (problems.length) {
    failed++
    console.log(`  FAIL  ${label}  (${timing})`)
    for (const p of problems) console.log(`          ${p}`)
  } else {
    passed++
    console.log(`  ok    ${label}  (${timing})`)
  }
  if (verbose || problems.length) {
    if (result.ok) console.log(`          outputs: ${JSON.stringify(result.outputs)}`)
    for (const log of result.logs) console.log(`          [${log.level}] ${log.message}${log.metadata ? ` ${JSON.stringify(log.metadata)}` : ''}`)
  }
}

for (const operation of manifest.operations) {
  const ownCases = cases.filter((c) => c.operation === operation.id)
  const match = (name: string) => !filter || name.toLowerCase().includes(filter) || operation.id.includes(filter)
  console.log(`${operation.id} — ${operation.label}`)

  if (match('sample')) {
    const sample = operation.sample ?? Object.fromEntries(operation.inputs.filter((f) => f.example !== undefined).map((f) => [f.name, f.example]))
    const result = await runAction({ module, manifest, operation: operation.id, inputs: sample })
    const problems: string[] = []
    if (!result.ok) problems.push(`${result.error?.code}: ${result.error?.message}`)
    else {
      for (const field of operation.outputs) {
        if (!(field.name in result.outputs)) problems.push(`missing output "${field.name}"`)
        const typeError = typeProblem(field, result.outputs[field.name])
        if (typeError) problems.push(typeError)
      }
    }
    report('sample inputs', result, problems)
  }

  for (const testCase of ownCases) {
    const name = testCase.name ?? JSON.stringify(testCase.inputs)
    if (!match(name)) continue
    const result = await runAction({ module, manifest, operation: operation.id, inputs: testCase.inputs ?? {}, mocks: mocksOf(testCase) })
    const problems: string[] = []
    if (testCase.expect_error !== undefined && testCase.expect_error !== false) {
      if (result.ok) problems.push('expected an error, the run succeeded')
      else if (typeof testCase.expect_error === 'string' && result.error?.code !== testCase.expect_error) problems.push(`expected error code ${testCase.expect_error}, got ${result.error?.code}: ${result.error?.message}`)
    } else if (!result.ok) {
      problems.push(`${result.error?.code}: ${result.error?.message}`)
    } else {
      for (const [key, want] of Object.entries(testCase.expect ?? {})) {
        if (!same(result.outputs[key], want)) problems.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(result.outputs[key])}`)
      }
    }
    report(name, result, problems)
  }
}

for (const testCase of cases) {
  if (!manifest.operations.some((op) => op.id === testCase.operation)) {
    failed++
    console.log(`  FAIL  ${testCase.name ?? ''}: operation "${testCase.operation}" is not in manifest.json`)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
