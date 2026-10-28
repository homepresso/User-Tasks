/**
 * Lazy loader for the optional storage SDKs (package.json
 * optionalDependencies, like the Snowflake / Oracle / MongoDB drivers; see
 * lib/db-connector.ts). A missing package becomes an actionable error.
 */

import { optionalPackageInstallHint } from '../../optional-drivers'

export const OPTIONAL_STORAGE_SDKS = [
  '@aws-sdk/client-s3',
  '@aws-sdk/s3-request-presigner',
  '@azure/storage-blob',
  '@google-cloud/storage',
] as const

/** The package itself is missing (not a module somewhere inside it). Same rule as lib/db-connector. */
export function isMissingSdkError(error: unknown, pkg: string): boolean {
  const escaped = pkg.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  const subject = new RegExp(`(cannot find (module|package)|failed to load external module|can't resolve) ['"]?${escaped}(['"]|:|\\s|$)`, 'i')
  for (let e = error as { message?: unknown; cause?: unknown } | null, depth = 0; e && depth < 5; e = e.cause as typeof e, depth++) {
    if (subject.test(typeof e.message === 'string' ? e.message : String(e))) return true
  }
  return false
}

export async function loadOptionalSdk<T>(pkg: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (e) {
    if (isMissingSdkError(e, pkg)) {
      throw new Error(`This storage provider needs the optional package ${pkg}: ${optionalPackageInstallHint(pkg)}.`)
    }
    throw e
  }
}
