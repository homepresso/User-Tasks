import { UsertasksApiError, UsertasksNetworkError, UsertasksOAuthError } from '@usertasks/sdk'

/** Process exit codes (documented contract; scripts depend on them). */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  unauthenticated: 3,
  forbidden: 4,
  notFound: 5,
  validation: 6,
  changes: 7,
  rateLimited: 8,
  unavailable: 10,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

/** Bad invocation: unknown flag, missing argument, malformed --set, … */
export class CliUsageError extends Error {
  override readonly name = 'CliUsageError'
}

/** No usable credential for the selected profile / server. */
export class CliAuthError extends Error {
  override readonly name = 'CliAuthError'
}

/**
 * Finish with a specific exit code after the command has already printed
 * its output (e.g. 7 for `config diff --exit-code` with changes).
 */
export class CliExit extends Error {
  override readonly name = 'CliExit'
  constructor(readonly code: ExitCode, message = `exit ${code}`) {
    super(message)
  }
}

export function exitCodeForStatus(status: number): ExitCode {
  if (status === 401) return EXIT.unauthenticated
  if (status === 403) return EXIT.forbidden
  if (status === 404) return EXIT.notFound
  if (status === 400 || status === 409 || status === 422) return EXIT.validation
  if (status === 429) return EXIT.rateLimited
  if (status >= 500) return EXIT.unavailable
  return EXIT.error
}

export function exitCodeFor(error: unknown): ExitCode {
  if (error instanceof CliExit) return error.code
  if (error instanceof CliUsageError) return EXIT.usage
  if (error instanceof CliAuthError) return EXIT.unauthenticated
  if (error instanceof UsertasksApiError) return exitCodeForStatus(error.status)
  if (error instanceof UsertasksNetworkError) return EXIT.unavailable
  // Login refused / session ended / discovery failed: all mean "not authenticated".
  if (error instanceof UsertasksOAuthError) return error.status && error.status >= 500 ? EXIT.unavailable : EXIT.unauthenticated
  return EXIT.error
}
