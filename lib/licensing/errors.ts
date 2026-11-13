/**
 * Errors for licence denials, for the extension framework to throw at its
 * enforcement points (API routes, MCP tools, workflow steps, triggers,
 * importers). They are ServiceErrors, so apiRoute / instanceAdminRoute turn
 * them into a clear response:
 *
 *   402 { error: { code: 'extension_not_licensed' | 'extension_licence_expired', message, details } }
 *
 * LicenceExpiredError is `retryable`: a workflow step that runs into it
 * fails without touching the run's data; the engine parks the run, paused at
 * that step, and resuming it after the licence is renewed re-runs the step
 * (lib/workflow-engine parkLicenceBlockedRun).
 */

import { ServiceError } from '@/lib/services/context'
import type { EntitlementDecision } from './types'
import type { LimitVerdict } from './limits'

export class LicenceDeniedError extends ServiceError {
  readonly extensionId: string
  readonly feature?: string
  readonly state: EntitlementDecision['state']
  /** A workflow step failing with this may be retried once the licence is in order. */
  readonly retryable: boolean

  constructor(extensionId: string, decision: EntitlementDecision, feature?: string) {
    const expired = decision.state === 'expired'
    super(expired ? 'extension_licence_expired' : 'extension_not_licensed', decision.reason ?? (expired ? `The ${extensionId} licence has expired` : `${extensionId} is not licensed`), {
      details: { extension_id: extensionId, feature: feature ?? null, state: decision.state, retryable: expired },
    })
    this.name = expired ? 'LicenceExpiredError' : 'LicenceDeniedError'
    this.extensionId = extensionId
    this.feature = feature
    this.state = decision.state
    this.retryable = expired
  }
}

/** The expired flavour (retryable). */
export class LicenceExpiredError extends LicenceDeniedError {}

/** Throw the matching error unless the decision allows use. */
export function assertEntitled(extensionId: string, decision: EntitlementDecision, feature?: string): void {
  if (decision.allowed) return
  if (decision.state === 'expired') throw new LicenceExpiredError(extensionId, decision, feature)
  throw new LicenceDeniedError(extensionId, decision, feature)
}

export class LicenceLimitError extends ServiceError {
  constructor(verdict: LimitVerdict) {
    super('extension_limit_reached', verdict.reason ?? `Licence limit reached for ${verdict.key}`, {
      details: { key: verdict.key, limit: verdict.limit, usage: verdict.usage },
    })
    this.name = 'LicenceLimitError'
  }
}

export function isLicenceDeniedError(error: unknown): error is LicenceDeniedError {
  return error instanceof LicenceDeniedError
}
