import { createHash } from 'node:crypto'
import type { ConnectorDefinition, ReferenceTemplate } from './registry'

/**
 * Generated connector references carry request_config.connector_template =
 * { key, hash }: the template they were generated from and a hash of what was
 * generated. A reference nobody edited since (its request matches the hash)
 * follows the CURRENT template on every call, so fixes to a connector's
 * templates reach existing workspaces without "Regenerate references".
 * Edited references (hash mismatch) and references generated before the
 * marker existed are left exactly as stored.
 */

interface ShapeInput { name: string; type?: string; required?: boolean; location?: string; default_value?: unknown }

function canonical(parts: {
  method: string
  path: string
  body: string
  headers: Record<string, unknown>
  baseUrl?: string
  inputs: ShapeInput[]
}): string {
  const headers = Object.fromEntries(Object.entries(parts.headers ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)))
  const inputs = parts.inputs.map((i) => [i.name, i.type ?? 'string', Boolean(i.required), i.location ?? 'query', String(i.default_value ?? '')])
  return JSON.stringify([parts.method.toUpperCase(), parts.path, parts.body, headers, parts.baseUrl ?? '', inputs])
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32)

export function templateHash(template: ReferenceTemplate): string {
  return digest(canonical({
    method: template.method,
    path: template.pathTemplate,
    body: template.bodyTemplate ?? '',
    headers: template.headers ?? {},
    baseUrl: template.baseUrl,
    inputs: template.inputs.map((i) => ({ name: i.name, type: i.type, required: i.required, location: i.location, default_value: i.defaultValue ?? '' })),
  }))
}

export function storedReferenceHash(ref: { request_config?: any; inputs?: any[] }): string {
  const rc = ref.request_config ?? {}
  return digest(canonical({
    method: String(rc.method ?? 'GET'),
    path: String(rc.path_template ?? ''),
    body: String(rc.body_template ?? ''),
    headers: rc.headers ?? {},
    baseUrl: rc.base_url,
    inputs: (ref.inputs ?? []).map((i: any) => ({ name: i.name, type: i.type, required: i.required, location: i.location, default_value: i.default_value })),
  }))
}

/**
 * The reference to execute: the stored one, or — when it is an untouched
 * generated reference whose template has changed — one built from the
 * current template (input ids and stored defaults kept by name).
 */
export function currentConnectorReference<T extends { request_config?: any; inputs?: any[] }>(ref: T, definition: ConnectorDefinition | undefined): T {
  const marker = ref.request_config?.connector_template
  if (!definition || !marker?.key || !marker?.hash) return ref
  const template = definition.referenceTemplates.find((t) => t.key === marker.key)
  if (!template) return ref
  const currentHash = templateHash(template)
  if (currentHash === marker.hash) return ref
  if (storedReferenceHash(ref) !== marker.hash) return ref // edited by someone: leave it alone
  const stored = new Map<string, any>((ref.inputs ?? []).map((i: any) => [String(i.name), i]))
  return {
    ...ref,
    inputs: template.inputs.map((input) => {
      const old = stored.get(input.name)
      return {
        id: old?.id ?? input.name,
        name: input.name,
        type: input.type ?? 'string',
        required: input.required ?? false,
        description: input.description ?? '',
        default_value: input.defaultValue ?? '',
        location: input.location ?? 'query',
        source: old?.source ?? 'variable',
      }
    }),
    request_config: {
      ...ref.request_config,
      method: template.method,
      path_template: template.pathTemplate,
      body_template: template.bodyTemplate ?? '',
      headers: template.headers ?? {},
      base_url: template.baseUrl,
      typed_placeholders: true,
      connector_template: { key: template.key, hash: currentHash },
    },
  }
}
