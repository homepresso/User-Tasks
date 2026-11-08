/**
 * The wiring validator (lib/workflow-wiring.ts) over every example the repo
 * ships — test-workflows/*.json and the gallery packages — must report
 * nothing: a warning there is either a real miswiring (fix the example) or
 * a false positive (fix the validator).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatWiringWarning, validateWorkflowWiring } from '@/lib/workflow-wiring'
import { readAllGallerySources } from '@/lib/gallery/source'

/* eslint-disable @typescript-eslint/no-explicit-any -- example files are JSON */

const TEST_WORKFLOWS = join(process.cwd(), 'test-workflows')

describe('wiring validator over the shipped examples', () => {
  it('test-workflows/*.json have no wiring warnings', () => {
    const found: string[] = []
    for (const file of readdirSync(TEST_WORKFLOWS).filter((f) => f.endsWith('.json')).sort()) {
      const wf = JSON.parse(readFileSync(join(TEST_WORKFLOWS, file), 'utf8'))
      for (const w of validateWorkflowWiring({ nodes: wf.nodes, edges: wf.edges, workflowVariables: wf.user_variables })) found.push(`${file} — ${formatWiringWarning(w)}`)
    }
    expect(found).toEqual([])
  })

  it('gallery workflow packages have no wiring warnings', () => {
    const found: string[] = []
    for (const source of readAllGallerySources()) {
      const forms = (source.manifest.forms ?? []) as any[]
      const linkedForms = Object.fromEntries(forms.filter((f) => f?.id).map((f) => [String(f.id), { fields: f.fields, layout: f.layout, version: f.version, name: f.name }]))
      for (const wf of (source.manifest.workflows ?? []) as any[]) {
        for (const w of validateWorkflowWiring({ nodes: wf.nodes, edges: wf.edges, workflowVariables: wf.user_variables, linkedForms })) {
          found.push(`${source.slug}/${wf.name} — ${formatWiringWarning(w)}`)
        }
      }
    }
    expect(found).toEqual([])
  })
})
