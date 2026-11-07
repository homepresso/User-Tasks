import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import * as app from '@/lib/custom-actions/contract'
import * as pkg from '@/packages/action/src/contract'

const ROOT = process.cwd()
const src = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

/**
 * packages/action (@usertasks/action) ships its own copy of the contract and
 * the sandbox so authors test locally against exactly what the app runs.
 */
describe('@usertasks/action stays in step with the app', () => {
  it('exports the same contract constants', () => {
    expect(Object.keys(pkg).sort()).toEqual(Object.keys(app).sort())
    expect(pkg.ACTION_MANIFEST_VERSION).toBe(app.ACTION_MANIFEST_VERSION)
    expect(pkg.ACTION_FIELD_TYPES).toEqual(app.ACTION_FIELD_TYPES)
    expect(pkg.ACTION_CAPABILITIES).toEqual(app.ACTION_CAPABILITIES)
    expect(pkg.ACTION_LIMITS).toEqual(app.ACTION_LIMITS)
    expect(pkg.ACTION_ERROR_CODES).toEqual(app.ACTION_ERROR_CODES)
    expect(pkg.OFFICIAL_KEY_PREFIX).toBe(app.OFFICIAL_KEY_PREFIX)
  })

  it('declares the same types (contract.ts declarations match)', () => {
    // Comments may differ; the code may not.
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ').trim()
    expect(code(src('packages/action/src/contract.ts'))).toBe(code(src('lib/custom-actions/contract.ts')))
  })

  it.each(['sandbox.ts', 'helpers.ts'])('packages/action/src/%s is a byte-identical copy of lib/custom-actions/%s', (file) => {
    expect(src(`packages/action/src/${file}`)).toBe(src(`lib/custom-actions/${file}`))
  })

  it('the app re-exports the same host helpers the package tests with', async () => {
    const host = await import('@/lib/custom-actions/host')
    const testing = await import('@/packages/action/src/testing')
    expect(typeof host.syncHelpers).toBe('function')
    expect(typeof testing.syncHelpers).toBe('function')
    expect(testing.syncHelpers('crypto.digest', ['SHA-256', 'abc', 'hex'])).toBe(host.syncHelpers('crypto.digest', ['SHA-256', 'abc', 'hex']))
  })
})
