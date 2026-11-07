/**
 * Shared vitest helpers for the official action tests
 * (__tests__/gallery-action-<slug>.test.ts): load an action's sources, run an
 * operation the way the engine does (declared defaults and type coercion via
 * prepareActionInputs, then the QuickJS sandbox via runAction) and the
 * contract checks every action must pass (manifest, module, gallery.json,
 * sample workflow).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkActionOutputs, parseActionManifest, prepareActionInputs } from '@/lib/custom-actions/manifest'
import type { ActionManifest, ActionRunResult } from '@/lib/custom-actions/contract'
import type { ActionGalleryMeta } from '@/lib/gallery/types'
import { NODE_CATALOG } from '@/lib/workflow-schema'
import { runAction, type ActionMocks } from '../../../packages/action/src/testing'

export const ACTIONS_DIR = resolve(__dirname, '..')

export interface LoadedAction {
  slug: string
  dir: string
  manifest: ActionManifest
  rawManifest: Record<string, unknown>
  module: string
  gallery: ActionGalleryMeta
  workflows: Array<{ file: string; json: Record<string, any> }>
  readme: string
}

export function loadAction(slug: string): LoadedAction {
  const dir = join(ACTIONS_DIR, slug)
  const rawManifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  const wfDir = join(dir, 'assets', 'workflows')
  return {
    slug,
    dir,
    rawManifest,
    manifest: parseActionManifest(rawManifest),
    module: readFileSync(join(dir, 'dist', 'action.js'), 'utf8'),
    gallery: JSON.parse(readFileSync(join(dir, 'gallery.json'), 'utf8')),
    workflows: readdirSync(wfDir).filter((f) => f.endsWith('.json')).map((file) => ({ file, json: JSON.parse(readFileSync(join(wfDir, file), 'utf8')) })),
    readme: readFileSync(join(dir, 'README.md'), 'utf8'),
  }
}

export interface RunOutcome extends ActionRunResult {
  warnings: string[]
}

/** Run one operation as the engine does: defaults + coercion, sandbox, output check. */
export async function runOp(action: LoadedAction, operation: string, inputs: Record<string, unknown> = {}, mocks?: ActionMocks): Promise<RunOutcome> {
  const op = action.manifest.operations.find((o) => o.id === operation)
  if (!op) throw new Error(`No operation ${operation}`)
  const prepared = prepareActionInputs(op, inputs)
  if (prepared.errors.length) {
    return { ok: false, outputs: {}, logs: [], error: { message: prepared.errors.join('; '), code: 'invalid', retryable: false }, stats: { duration_ms: 0, host_calls: 0, memory_bytes: null }, warnings: [] }
  }
  const result = await runAction({ module: action.module, manifest: action.manifest, operation, inputs: prepared.inputs, mocks })
  return { ...result, warnings: result.ok ? checkActionOutputs(op, result.outputs) : [] }
}

/** Run and expect success with typed outputs; returns the outputs. */
export async function ok(action: LoadedAction, operation: string, inputs: Record<string, unknown> = {}, mocks?: ActionMocks): Promise<Record<string, any>> {
  const r = await runOp(action, operation, inputs, mocks)
  if (!r.ok) throw new Error(`${operation} failed: ${r.error?.message}`)
  expect(r.warnings).toEqual([])
  return r.outputs
}

/** Run and expect a failure whose message matches. */
export async function fails(action: LoadedAction, operation: string, inputs: Record<string, unknown>, message: RegExp, mocks?: ActionMocks): Promise<void> {
  const r = await runOp(action, operation, inputs, mocks)
  expect(r.ok, `${operation} should fail with ${message}`).toBe(false)
  expect(r.error?.message).toMatch(message)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const NODE_TYPES = new Set(NODE_CATALOG.map((n) => n.type))

/** The checks every official action passes. */
export function contractSuite(slug: string, expected: { key: string; operations: string[]; capabilities: string[]; mocks?: ActionMocks; dynamicLists?: boolean }) {
  const action = loadAction(slug)
  describe(`${slug}: contract`, () => {
    it('has a strict-valid v1 manifest with the expected key, operations and capabilities', () => {
      const m = action.manifest
      expect(m.key).toBe(expected.key)
      expect(m.version).toBe('1.0.0')
      expect(m.entry).toBe('dist/action.js')
      expect(m.operations.map((o) => o.id)).toEqual(expected.operations)
      expect(Object.keys(m.capabilities).sort()).toEqual([...expected.capabilities].sort())
      expect(m.author).toBe('UserTasks')
      expect(m.license).toBe('Apache-2.0')
      expect(m.icon).toBeTruthy()
      expect(m.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      for (const op of m.operations) {
        expect(op.description?.length, `${op.id} description`).toBeGreaterThan(20)
        expect(op.sample, `${op.id} sample`).toBeTruthy()
        for (const field of [...op.inputs, ...op.outputs]) {
          expect(field.name, `${op.id}.${field.name}`).toMatch(/^[a-z][a-z0-9_]*$/)
          expect(field.label, `${op.id}.${field.name} label`).toBeTruthy()
        }
        // Lists of objects declare their fields so the data picker shows them (unless the shape is the caller's data).
        for (const field of op.outputs) {
          if (field.type === 'array') expect(field.items, `${op.id}.${field.name} items`).toBeTruthy()
          if (field.type === 'array' && field.items?.type === 'object' && !expected.dynamicLists) expect(field.items.fields?.length, `${op.id}.${field.name} item fields`).toBeGreaterThan(0)
        }
        for (const input of op.inputs) expect(input.description, `${op.id}.${input.name} description`).toBeTruthy()
      }
      expect(m).toEqual(action.rawManifest)
    })

    it('ships one self-contained module: banner first, no imports, under 200 KB', () => {
      expect(action.module.startsWith(`/*! UserTasks action ${expected.key} 1.0.0 */\n`)).toBe(true)
      expect(action.module).not.toMatch(/^\s*import[\s{*"']|\bimport\s*\(|^\s*export\s[^;]*\sfrom\s/m)
      expect(action.module).not.toMatch(/\brequire\s*\(/)
      expect(action.module).not.toMatch(/\beval\s*\(|new Function\s*\(/)
      expect(Buffer.byteLength(action.module)).toBeLessThan(200 * 1024)
    })

    it.each(action.manifest.operations.map((o) => [o.id] as const))('the sample of %s runs with typed outputs', async (id) => {
      const op = action.manifest.operations.find((o) => o.id === id)!
      const out = await ok(action, id, op.sample ?? {}, expected.mocks)
      for (const field of op.outputs) expect(field.name in out, `${id} returns ${field.name}`).toBe(true)
      expect(Object.keys(out).sort()).toEqual(op.outputs.map((f) => f.name).sort())
    })

    it('has a complete gallery.json', () => {
      const g = action.gallery
      expect(g.id).toMatch(UUID)
      expect(g.asset_id).toMatch(UUID)
      expect(g.id).not.toBe(g.asset_id)
      expect(g.slug).toBe(slug)
      expect(g.version).toBe(action.manifest.version)
      expect(g.summary.length).toBeGreaterThanOrEqual(40)
      expect(g.summary.length).toBeLessThanOrEqual(200)
      expect(g.description.length).toBeGreaterThanOrEqual(200)
      expect(g.description).toContain('\n\n')
      expect(g.icon).toBe(action.manifest.icon)
      expect(g.changelog).toEqual([{ version: '1.0.0', date: '2026-11-01', notes: 'First release.' }])
      expect(g.uses).toHaveLength(3)
      expect(g.setup[0]).toBe('Install the package: the action appears in Extensibility → Workflow actions and in the workflow designer\'s palette under Custom actions.')
      expect(g.setup.length).toBeGreaterThanOrEqual(2)
      expect(g.examples.length).toBeGreaterThanOrEqual(3)
      expect(g.examples.length).toBeLessThanOrEqual(5)
      expect(g.tags.length).toBeGreaterThan(2)
    })

    it.each(action.gallery.examples.map((e) => [e.title, e] as const))('gallery example "%s" runs', async (_title, example) => {
      expect(action.manifest.operations.some((o) => o.id === example.operation)).toBe(true)
      await ok(action, example.operation, example.inputs, expected.mocks)
    })

    it('has a README covering every operation', () => {
      for (const op of action.manifest.operations) expect(action.readme).toContain(`\`${op.id}\``)
      expect(action.readme).toMatch(/Apache-2\.0/)
    })

    it('ships one valid headless sample workflow that uses this action', () => {
      expect(action.workflows).toHaveLength(1)
      const { file, json } = action.workflows[0]
      expect(json.format_version).toBe(3)
      expect(json.asset_type).toBe('workflows')
      expect(json.id).toMatch(UUID)
      expect(json.asset.id).toBe(json.id)
      expect(file.endsWith(`-${json.id.slice(0, 8)}.json`)).toBe(true)
      const wf = json.asset
      expect(['webhook_received']).toContain(wf.trigger_type)
      const ids = new Set<string>()
      for (const node of wf.nodes) {
        expect(NODE_TYPES.has(node.type), `node type ${node.type}`).toBe(true)
        expect(ids.has(node.id)).toBe(false)
        ids.add(node.id)
        expect(typeof node.position?.x).toBe('number')
      }
      const trigger = wf.nodes.find((n: any) => n.type === wf.trigger_type)
      expect(trigger).toBeTruthy()
      // Every start-form cell names a variable, and every variable has a default so the workflow runs with no input.
      const varNames = new Set(wf.user_variables.map((v: any) => v.name))
      for (const row of trigger.config.start_form?.layout?.rows ?? []) {
        for (const cell of row.cells) expect(varNames.has(cell.field_key), `start form field ${cell.field_key}`).toBe(true)
      }
      for (const v of wf.user_variables) expect(v.defaultValue !== undefined && v.defaultValue !== '', `default for ${v.name}`).toBe(true)
      for (const edge of wf.edges) {
        expect(ids.has(edge.source), `edge source ${edge.source}`).toBe(true)
        expect(ids.has(edge.target), `edge target ${edge.target}`).toBe(true)
      }
      const custom = wf.nodes.filter((n: any) => n.type === 'custom_activity')
      expect(custom.length).toBeGreaterThanOrEqual(1)
      expect(custom.length).toBeLessThanOrEqual(3)
      for (const node of custom) {
        const c = node.config
        expect(c.custom_activity_id).toBe(action.gallery.asset_id)
        expect(c.custom_activity_key).toBe(expected.key)
        expect(c._output_prefix).toMatch(/^[a-z][a-z0-9_]*$/)
        const op = action.manifest.operations.find((o) => o.id === c.operation)
        expect(op, `operation ${c.operation}`).toBeTruthy()
        for (const name of Object.keys(c.input_mappings)) expect(op!.inputs.some((i) => i.name === name), `${c.operation} input ${name}`).toBe(true)
        for (const input of op!.inputs.filter((i) => i.required)) expect(String(c.input_mappings[input.name] ?? '').trim(), `${c.operation} required ${input.name}`).not.toBe('')
      }
      // Connected: every node but the trigger has an incoming edge.
      for (const node of wf.nodes) {
        if (node.id === trigger.id) continue
        expect(wf.edges.some((e: any) => e.target === node.id), `${node.id} is connected`).toBe(true)
      }
    })
  })
  return action
}
