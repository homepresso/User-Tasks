/**
 * SCIM 2.0 error responses (RFC 7644 §3.12): status as a string, optional
 * scimType keyword, human-readable detail.
 */

export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'

export type ScimErrorType =
  | 'invalidFilter'
  | 'tooMany'
  | 'uniqueness'
  | 'mutability'
  | 'invalidSyntax'
  | 'invalidPath'
  | 'noTarget'
  | 'invalidValue'
  | 'invalidVers'
  | 'sensitive'

export class ScimError extends Error {
  constructor(readonly status: number, message: string, readonly scimType?: ScimErrorType, readonly headers: Record<string, string> = {}) {
    super(message)
    this.name = 'ScimError'
  }

  toJSON() {
    return {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(this.status),
      ...(this.scimType ? { scimType: this.scimType } : {}),
      detail: this.message,
    }
  }

  static badRequest(message: string, scimType: ScimErrorType = 'invalidValue') { return new ScimError(400, message, scimType) }
  static notFound(message = 'Resource not found') { return new ScimError(404, message) }
  static conflict(message: string) { return new ScimError(409, message, 'uniqueness') }
}

export function isScimError(error: unknown): error is ScimError {
  return error instanceof ScimError
}
