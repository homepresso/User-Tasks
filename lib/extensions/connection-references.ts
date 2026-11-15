/**
 * Reference methods an extension generates for one of its connections
 * (ServerExtension.connectionReferences): Integrations → the connection →
 * References lists them next to the stored references (read-only: the
 * extension owns them) and the Test dialog runs them.
 *
 *  - ids are `ext:<extension id>:<method id>`; the connection is the
 *    integration being viewed (its type must be one of the extension's
 *    connectors, `ext.<id>.<key>`).
 *  - listing and running need the extension enabled and licensed (the
 *    provider's `feature`), and run as the caller: the extension context
 *    carries the caller's permissions (ctx.can), so the extension applies its
 *    own read / write / manage permissions.
 *  - a method that writes runs only with `confirm_write` (the dialog asks), a
 *    destructive one also needs `confirm: true` among its inputs (the dialog
 *    says so; it is never pre-filled).
 *
 * Server-only.
 */

import type { ConnectionReferenceMethod } from '@/lib/extensions/sdk'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser reads them */

export const EXT_REFERENCE_PREFIX = 'ext:'

export interface Caller { tenantId: string; actorId: string | null; db: unknown; permissions: ReadonlySet<string> | null }

export function extensionReferenceId(extensionId: string, methodId: string): string {
  return `${EXT_REFERENCE_PREFIX}${extensionId}:${methodId}`
}

export function parseExtensionReferenceId(id: string): { extensionId: string; methodId: string } | null {
  if (!id.startsWith(EXT_REFERENCE_PREFIX)) return null
  const rest = id.slice(EXT_REFERENCE_PREFIX.length)
  const at = rest.indexOf(':')
  if (at <= 0 || at === rest.length - 1) return null
  return { extensionId: rest.slice(0, at), methodId: rest.slice(at + 1) }
}

/** The extension whose connector made this integration (`ext.<id>.<key>`). */
export function extensionOfIntegrationType(type: unknown): string | null {
  const m = /^ext\.([a-z0-9][a-z0-9-]*)\./.exec(String(type ?? ''))
  return m ? m[1] : null
}

async function provider(tenantId: string, extensionId: string) {
  const { getServerExtension } = await import('./server-registry')
  const server = getServerExtension(extensionId)
  const p = server?.connectionReferences
  if (!p) return null
  const { extensionAccess } = await import('./state')
  const access = await extensionAccess(tenantId, extensionId, p.feature)
  return { p, access }
}

async function contextFor(caller: Caller, extensionId: string) {
  const { createExtensionContext } = await import('./host')
  return createExtensionContext({ extensionId, tenantId: caller.tenantId, actorId: caller.actorId, db: caller.db, permissions: caller.permissions })
}

/** A method as a reference row the References list renders (request_config.source = 'extension'). */
export function methodAsReference(extensionId: string, integrationId: string, m: ConnectionReferenceMethod): Record<string, any> {
  return {
    id: extensionReferenceId(extensionId, m.id),
    integration_id: integrationId,
    name: m.name,
    description: m.description ?? null,
    inputs: m.inputs.map((i) => ({ name: i.name, type: i.type, required: Boolean(i.required), description: i.description ?? null, default_value: i.default_value ?? '', ...(i.enum ? { enum: i.enum } : {}) })),
    outputs: [],
    tags: m.group ? [m.group] : [],
    request_config: {
      source: 'extension', extension: extensionId, method_id: m.id,
      method: m.method, path_template: m.path, group: m.group ?? null,
      writes: Boolean(m.writes), destructive: Boolean(m.destructive), access: m.access ?? (m.writes ? 'write' : 'read'), notes: m.notes ?? [],
    },
    readonly: true,
  }
}

/** The extension-provided references of an integration ([] when none, unlicensed or failing — never breaks the page). */
export async function extensionReferencesFor(caller: Caller, integration: { id: string; type?: string | null }): Promise<Record<string, any>[]> {
  const extensionId = extensionOfIntegrationType(integration.type)
  if (!extensionId) return []
  try {
    const found = await provider(caller.tenantId, extensionId)
    if (!found || !found.access.usable) return []
    const ctx = await contextFor(caller, extensionId)
    const methods = await found.p.list({ ctx, connectionId: integration.id })
    return methods.slice(0, 5000).map((m) => methodAsReference(extensionId, integration.id, m))
  } catch {
    // The stored references still show; the extension logs its own failures.
    return []
  }
}

export class ExtensionReferenceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message) }
}

/** Run an extension-provided reference method from the Test dialog. */
export async function runExtensionReference(caller: Caller, input: { referenceId: string; integration: { id: string; type?: string | null }; inputs: Record<string, unknown>; confirmWrite?: boolean }): Promise<{ status: number; data: unknown }> {
  const parsed = parseExtensionReferenceId(input.referenceId)
  if (!parsed) throw new ExtensionReferenceError('Reference not found', 404, 'not_found')
  if (extensionOfIntegrationType(input.integration.type) !== parsed.extensionId) throw new ExtensionReferenceError('Reference not found', 404, 'not_found')
  const found = await provider(caller.tenantId, parsed.extensionId)
  if (!found) throw new ExtensionReferenceError('Reference not found', 404, 'not_found')
  if (!found.access.usable) throw new ExtensionReferenceError(found.access.reason ?? 'Extension not available', found.access.status === 200 ? 403 : found.access.status, found.access.code ?? 'extension_disabled')
  const ctx = await contextFor(caller, parsed.extensionId)
  const methods = await found.p.list({ ctx, connectionId: input.integration.id })
  const method = methods.find((m) => m.id === parsed.methodId)
  if (!method) throw new ExtensionReferenceError('Reference not found', 404, 'not_found')
  if (method.writes && input.confirmWrite !== true) throw new ExtensionReferenceError('This reference writes data — confirm to run it for real', 409, 'confirm_write')
  if (method.destructive && !(input.inputs.confirm === true || String(input.inputs.confirm ?? '').toLowerCase() === 'true')) {
    throw new ExtensionReferenceError('This operation is destructive: set the confirm input to true to run it', 409, 'confirmation_required')
  }
  try {
    const data = await found.p.run({ ctx, connectionId: input.integration.id, methodId: method.id, inputs: input.inputs })
    return { status: 200, data }
  } catch (error) {
    const { isExtensionError } = await import('./sdk')
    if (isExtensionError(error)) throw new ExtensionReferenceError(error.message, error.status >= 400 && error.status <= 599 ? error.status : 500, error.code)
    throw error
  }
}
