/**
 * Entitlement port: the one question the extension framework asks the
 * licensing layer — "may this workspace use this extension (feature)?".
 *
 * The licensing workstream (lib/licensing, Settings → Licence) registers the
 * real implementation with setEntitlementPort() at boot. Until it does, the
 * default answers from the manifest alone: free extensions are allowed
 * (`not_required`), paid ones are denied (`unlicensed`). Every framework
 * gate (UI payload, API and MCP dispatch, node execution, jobs, triggers)
 * goes through getEntitlementPort(), so swapping the implementation changes
 * enforcement everywhere at once.
 *
 * Client-safe (no server imports): the default only reads manifests.
 */

import { getExtensionManifest } from './registry'

export type EntitlementDecision = {
  allowed: boolean
  state: 'licensed' | 'unlicensed' | 'expired' | 'not_required'
  reason?: string
  limits?: Record<string, number>
}

export interface EntitlementPort {
  check(input: { tenantId: string | null; extensionId: string; feature?: string }): Promise<EntitlementDecision>
}

/** Manifest-only default: free → allowed, paid → denied until a licence implementation is registered. */
export const defaultEntitlementPort: EntitlementPort = {
  async check({ extensionId }) {
    const manifest = getExtensionManifest(extensionId)
    if (!manifest) return { allowed: false, state: 'unlicensed', reason: `Extension "${extensionId}" is not installed in this build` }
    if (manifest.licence.tier === 'free') return { allowed: true, state: 'not_required' }
    return { allowed: false, state: 'unlicensed', reason: 'This extension needs a licence. Ask an instance administrator to install one (Settings → Licence).' }
  },
}

// Module state survives across the server's module graph only per process;
// a globalThis slot keeps one port when Next bundles this module twice
// (route handlers and server components are separate graphs).
const SLOT = Symbol.for('usertasks.extensions.entitlementPort')
type Slot = { port?: EntitlementPort }
const slot = ((globalThis as unknown as Record<symbol, Slot>)[SLOT] ??= {})

export function setEntitlementPort(p: EntitlementPort): void {
  slot.port = p
}

export function getEntitlementPort(): EntitlementPort {
  return slot.port ?? defaultEntitlementPort
}

/** Test hook: back to the manifest-only default. */
export function resetEntitlementPort(): void {
  delete slot.port
}
