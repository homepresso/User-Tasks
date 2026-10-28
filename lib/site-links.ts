/**
 * Public project links used by the marketing site and docs.
 *
 * The source repository stays private until launch, so its URL is not
 * hardcoded: set NEXT_PUBLIC_REPOSITORY_URL (baked in at build time) once the
 * public repository exists. While it is unset, every repository link, button
 * and structured-data reference is omitted (see docs/launch-checklist.md).
 */
export function repositoryUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_REPOSITORY_URL?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** Shown where a repository call to action would otherwise sit. */
export const SOURCE_RELEASE_NOTE = 'Open source (Apache-2.0) — source release coming at launch'

export const CLI_PACKAGE = '@usertasks/cli'
export const SDK_PACKAGE = '@usertasks/sdk'
