import packageJson from '@/package.json'

/**
 * The running build, for GET /api/version and /api/config/public (no
 * authentication: nothing here is secret).
 *
 *  - version: package.json `version`.
 *  - commit: VERCEL_GIT_COMMIT_SHA (Vercel), else GIT_COMMIT / SOURCE_COMMIT
 *    (Docker build args baked into the image's environment, or set at
 *    runtime), else null.
 *  - buildTime: BUILD_TIME (Docker build arg, ISO 8601), else null.
 */

export interface VersionInfo {
  version: string
  commit: string | null
  buildTime: string | null
}

const COMMIT_RE = /^[0-9a-f]{7,64}$/i

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
}

/** The git commit of this build: a hex SHA, never anything else from the environment. */
export function buildCommit(): string | null {
  for (const name of ['VERCEL_GIT_COMMIT_SHA', 'GIT_COMMIT', 'SOURCE_COMMIT']) {
    const value = env(name)
    if (value && COMMIT_RE.test(value)) return value.toLowerCase()
  }
  return null
}

function buildTime(): string | null {
  const value = env('BUILD_TIME')
  if (!value) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

export function versionInfo(): VersionInfo {
  return { version: String(packageJson.version), commit: buildCommit(), buildTime: buildTime() }
}
