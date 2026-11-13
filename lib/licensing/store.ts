/**
 * Installed licences.
 *
 * Sources, all read on every refresh and all honoured together:
 *   - the `instance.licences` instance setting: an array of licence documents
 *     (Settings → Licence upload, `usertasks-admin licence install`,
 *     PUT /api/v1/licence);
 *   - USERTASKS_LICENCE: the licence JSON, its base64, or a secret://
 *     reference resolved through the configured secrets provider (Helm /
 *     Kubernetes secrets, Vault, …);
 *   - USERTASKS_LICENCE_FILE: a path to a licence file (a mounted secret).
 * USERTASKS_LICENSE / USERTASKS_LICENSE_FILE are accepted as aliases.
 *
 * The pure helpers here are shared with the admin CLI, which edits the same
 * setting over its own database connection.
 */

import { parseLicence } from './format'
import type { LicenceDocument, LicenceSource } from './types'

export const LICENCES_SETTING = 'instance.licences'
/** Expiry notices already sent, per licence and threshold (the daily job). */
export const LICENCE_NOTICES_SETTING = 'instance.licence_notices'

export const LICENCE_ENV = ['USERTASKS_LICENCE', 'USERTASKS_LICENSE'] as const
export const LICENCE_FILE_ENV = ['USERTASKS_LICENCE_FILE', 'USERTASKS_LICENSE_FILE'] as const

export interface RawLicence {
  source: LicenceSource
  /** A licence document, its text, or the error that stopped it being read. */
  raw: unknown
  error?: string
}

/** The stored array (anything else = none). */
export function storedLicences(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []
}

function idOf(value: unknown): string | null {
  return value && typeof value === 'object' && typeof (value as { licence_id?: unknown }).licence_id === 'string'
    ? (value as { licence_id: string }).licence_id
    : null
}

/** Add a licence; one with the same licence_id is replaced. */
export function mergeLicence(current: unknown[], doc: LicenceDocument): { next: unknown[]; replaced: boolean } {
  const replaced = current.some((item) => idOf(item) === doc.licence_id)
  return { next: [...current.filter((item) => idOf(item) !== doc.licence_id), doc], replaced }
}

/** Remove one licence (by id) or all of them (no id). */
export function removeLicence(current: unknown[], licenceId?: string | null): { next: unknown[]; removed: string[] } {
  if (!licenceId) return { next: [], removed: current.map((item) => idOf(item) ?? '?') }
  const removed = current.filter((item) => idOf(item) === licenceId).map(() => licenceId)
  return { next: current.filter((item) => idOf(item) !== licenceId), removed }
}

/** Licence text → document (throws LicenceFormatError). */
export function readLicenceText(text: string): LicenceDocument {
  return parseLicence(text)
}

function firstEnv(env: Record<string, string | undefined>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

export interface EnvLicenceDeps {
  env?: Record<string, string | undefined>
  readFile?: (path: string) => Promise<string>
  resolveSecret?: (ref: string) => Promise<string>
}

/** Licences from the environment (USERTASKS_LICENCE, USERTASKS_LICENCE_FILE). */
export async function envLicences(deps: EnvLicenceDeps = {}): Promise<RawLicence[]> {
  const env = deps.env ?? process.env
  const out: RawLicence[] = []
  const inline = firstEnv(env, LICENCE_ENV)
  if (inline) {
    try {
      let text = inline
      if (inline.startsWith('secret://')) {
        const resolve = deps.resolveSecret ?? defaultResolveSecret
        text = await resolve(inline)
      }
      out.push({ source: 'env', raw: text })
    } catch (error) {
      out.push({ source: 'env', raw: null, error: `USERTASKS_LICENCE could not be read: ${(error as Error).message}` })
    }
  }
  const file = firstEnv(env, LICENCE_FILE_ENV)
  if (file) {
    try {
      const read = deps.readFile ?? (async (p: string) => (await import('node:fs/promises')).readFile(p, 'utf8'))
      out.push({ source: 'env_file', raw: await read(file) })
    } catch (error) {
      out.push({ source: 'env_file', raw: null, error: `USERTASKS_LICENCE_FILE (${file}) could not be read: ${(error as Error).message}` })
    }
  }
  return out
}

async function defaultResolveSecret(ref: string): Promise<string> {
  const [{ resolveSecretRef }, { getSecretStore }] = await Promise.all([
    import('@/lib/config/secret-refs'),
    import('@/lib/providers/secrets'),
  ])
  return resolveSecretRef(ref, await getSecretStore(), { label: 'USERTASKS_LICENCE' })
}
