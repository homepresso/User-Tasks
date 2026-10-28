// Normalise any supported export file into a config manifest for
// config apply (the UI "Import" button, `config_apply`): a config manifest
// (format=manifest export), the files form ({ files: [...] }), one GitHub-sync
// asset envelope, or the per-type export documents (decision tables —
// REST `decision_table` and editor `decisionTable` —, reports, workflow
// activities, agent designer files). Assets without an id get a fresh one
// so they are created. Pure: no I/O.

/* eslint-disable @typescript-eslint/no-explicit-any -- import documents are free-form JSON */

import { randomUUID } from 'node:crypto'
import { filesToManifest, SECTION_TO_DIR, SINGLETON_SECTIONS, type RepoFile } from '@/lib/github-sync/layout'
import { isUuid } from './plan'

export type ImportDocument =
  | { kind: 'manifest'; manifest: Record<string, any> }
  | { kind: 'files'; files: RepoFile[] }

const SECTIONS = new Set(SECTION_TO_DIR.map((s) => s.section))
const DIR_TO_SECTION = new Map(SECTION_TO_DIR.map((s) => [s.dir, s.section]))
const SINGLETONS = new Set(SINGLETON_SECTIONS.map((s) => s.section))
const singletonSection = (type: string) => SINGLETON_SECTIONS.find((s) => s.section === type || s.section.replace(/_/g, '-') === type)?.section

/** Per-type export documents → manifest section + the key holding the asset. */
const TYPED_DOCUMENTS: Array<{ asset_type: string; keys: string[]; section: string }> = [
  { asset_type: 'decision_table', keys: ['decision_table', 'decisionTable'], section: 'decision_tables' },
  { asset_type: 'report', keys: ['report'], section: 'reports' },
  { asset_type: 'workflow_activity', keys: ['workflow_activity'], section: 'workflow_activities' },
  { asset_type: 'agent', keys: ['agent'], section: 'agents' },
  { asset_type: 'workflow', keys: ['workflow'], section: 'workflows' },
]

function withIds(manifest: Record<string, any>): Record<string, any> {
  for (const section of SECTIONS) {
    if (!Array.isArray(manifest[section])) continue
    manifest[section] = manifest[section].map((asset: any) => (asset && typeof asset === 'object' && !isUuid(asset.id) && section !== 'objects' ? { ...asset, id: randomUUID() } : asset))
  }
  return manifest
}

/** Throws an Error with a user-facing message when the document is not importable. */
export function normalizeImportDocument(raw: unknown): ImportDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The file must contain a JSON object')
  const doc = raw as Record<string, any>

  if (Array.isArray(doc.files)) {
    const files = doc.files.filter((f: any) => typeof f?.path === 'string' && typeof f?.content === 'string')
    if (!files.length) throw new Error('The files list is empty')
    return { kind: 'files', files }
  }
  if (doc.kind === 'usertasks.package') throw new Error('This is a package manifest: install .utpkg files from Settings → Packages')

  // A config manifest: any known section present.
  if ([...SECTIONS, ...SINGLETONS].some((section) => doc[section] !== undefined)) {
    return { kind: 'manifest', manifest: withIds(structuredClone(doc)) }
  }

  // A GitHub-sync / config asset envelope: { asset_type, id, asset }.
  if (typeof doc.asset_type === 'string' && doc.asset && typeof doc.asset === 'object') {
    const section = SECTIONS.has(doc.asset_type) ? doc.asset_type : DIR_TO_SECTION.get(doc.asset_type)
    if (section) {
      const { manifest, errors } = filesToManifest([{ path: `${section}/asset.json`, content: JSON.stringify(doc) }])
      if (errors.length) throw new Error(`The file is not a valid ${doc.asset_type} asset: ${errors[0].error}`)
      return { kind: 'manifest', manifest: withIds(manifest) }
    }
    const singleton = singletonSection(doc.asset_type)
    if (singleton) return { kind: 'manifest', manifest: { [singleton]: doc.asset } }
  }

  // Per-type export documents.
  for (const typed of TYPED_DOCUMENTS) {
    const key = typed.keys.find((k) => doc[k] && typeof doc[k] === 'object' && !Array.isArray(doc[k]))
    if (!key) continue
    if (doc.asset_type && doc.asset_type !== typed.asset_type && doc.type !== typed.asset_type) continue
    return { kind: 'manifest', manifest: withIds({ format_version: 3, [typed.section]: [{ ...doc[key] }] }) }
  }
  // A bare decision table (older rule-editor files): { name?, inputs, outputs, rules }.
  if (Array.isArray(doc.inputs) && Array.isArray(doc.outputs) && Array.isArray(doc.rules)) {
    return { kind: 'manifest', manifest: withIds({ format_version: 3, decision_tables: [{ ...doc }] }) }
  }
  if (Array.isArray(doc.nodes) && !doc.name) {
    throw new Error('This is a workflow canvas file: open the workflow designer and use its Import button')
  }
  throw new Error('Unrecognised file: expected a configuration export (manifest, files or asset file) or a decision table, report, activity or agent export')
}
