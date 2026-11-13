/**
 * Runs an extension workflow node (`ext.<id>.<key>`): the engine's single
 * dispatch hook (lib/workflow-engine.ts, the `default:` branch of the node
 * switch) calls runExtensionNode. Built-in nodes are untouched.
 *
 *   1. the node must be installed in this build and usable in the workspace
 *      (enabled, licensed — feature included — and compatible); an expired
 *      licence throws LicenceExpiredError (retryable), a missing one
 *      LicenceDeniedError;
 *   2. inputs come from `input_mappings` ({{data}} resolved by the engine),
 *      falling back to declared defaults, then are coerced to the declared
 *      types and required ones checked (the custom-action field rules);
 *   3. the extension's handler runs with the host API; its outputs become
 *      `{{<prefix>_<name>}}` (and the bare name), plus `<prefix>_outputs`.
 *
 * Server-only.
 */

import { prepareActionInputs } from '@/lib/custom-actions/manifest'
import { createExtensionContext } from './host'
import { extensionCatalogEntry } from './nodes'
import { getServerExtension } from './server-registry'
import { extensionAccess, extensionAccessError } from './state'

export interface ExtensionNodeRunInput {
  node: { id: string; type: string; label: string; config: Record<string, unknown> }
  tenantId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the engine's client
  supabase: any
  runId: string | null
  workflowId: string | null
  isTest: boolean
  variables: Record<string, unknown>
  actorId: string | null
  /** The engine's {{expression}} resolver for this run. */
  resolve: (expression: string) => unknown
  /** Sets `<prefix>_<name>` and `<name>`. */
  setVar: (name: string, value: unknown) => void
  prefix: string
  log: (level: 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>) => void
}

export class ExtensionNodeError extends Error {
  constructor(message: string, readonly code: 'not_installed' | 'not_usable' | 'invalid_inputs' | 'failed') {
    super(message)
    this.name = 'ExtensionNodeError'
  }
}

export async function runExtensionNode(input: ExtensionNodeRunInput) {
  const { node } = input
  const entry = extensionCatalogEntry(node.type)
  if (!entry) throw new ExtensionNodeError(`Step "${node.label}" uses ${node.type}, which is not installed in this build`, 'not_installed')
  if (entry.category === 'trigger') return { triggered: true }

  const access = await extensionAccess(input.tenantId, entry.extensionId, entry.feature)
  if (!access.usable) {
    // Licence denials keep their code: past the 24-hour cutoff the step fails
    // with LicenceExpiredError (extension_licence_expired, retryable) — the
    // engine parks the run at this step so it can resume after renewal.
    if (access.code === 'extension_licence_expired' || access.code === 'extension_not_licensed') {
      throw extensionAccessError({ ...access, reason: `${entry.label}: ${access.reason}` }, entry.extensionId, entry.feature)
    }
    throw new ExtensionNodeError(`${entry.label}: ${access.reason}`, 'not_usable')
  }
  const handler = getServerExtension(entry.extensionId)?.nodes?.[entry.key]
  if (!handler) throw new ExtensionNodeError(`${entry.label}: the extension has no handler for this step`, 'not_installed')

  const mappings = (node.config.input_mappings ?? {}) as Record<string, unknown>
  const raw: Record<string, unknown> = {}
  for (const field of entry.inputs) {
    const mapped = mappings[field.name]
    if (typeof mapped === 'string' ? mapped.trim() : mapped !== undefined && mapped !== null) {
      raw[field.name] = typeof mapped === 'string' ? input.resolve(mapped) : mapped
    }
  }
  const prepared = prepareActionInputs({ id: entry.key, label: entry.label, inputs: entry.inputs, outputs: entry.outputs }, raw)
  if (prepared.errors.length) throw new ExtensionNodeError(`${entry.label}: ${prepared.errors.join('; ')}`, 'invalid_inputs')

  const ctx = createExtensionContext({ extensionId: entry.extensionId, tenantId: input.tenantId, actorId: input.actorId, db: input.supabase })
  const started = Date.now()
  let outputs: Record<string, unknown>
  try {
    outputs = (await handler({
      ctx,
      inputs: prepared.inputs,
      node: { id: node.id, label: node.label, type: node.type },
      run: { id: input.runId, workflowId: input.workflowId, test: input.isTest, variables: Object.freeze({ ...input.variables }) },
    })) ?? {}
  } catch (error) {
    throw new ExtensionNodeError(`${entry.label}: ${error instanceof Error ? error.message : String(error)}`, 'failed')
  }
  if (typeof outputs !== 'object' || Array.isArray(outputs)) outputs = { result: outputs }
  for (const [name, value] of Object.entries(outputs)) input.setVar(name, value)
  input.variables[`${input.prefix}_outputs`] = outputs
  const declared = entry.outputs.map((o) => o.name)
  const missing = declared.filter((name) => !Object.prototype.hasOwnProperty.call(outputs, name))
  if (missing.length) input.log('warn', `[${entry.label}] did not return declared outputs: ${missing.join(', ')}`)
  input.log('info', `[${entry.label}] ran ${entry.extensionId}.${entry.key} in ${Date.now() - started} ms`, { extension: entry.extensionId, node: entry.key })
  return {
    extension: entry.extensionId,
    node_key: entry.key,
    outputs,
    output_count: Object.keys(outputs).length,
  }
}
