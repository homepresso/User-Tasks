/**
 * Custom workflow action packages: what an upload turns into before it is
 * stored as an immutable version — the validated manifest, the module text,
 * its SHA-256 and an optional signature.
 *
 * Accepted shapes (the starter kit's `npm run package` makes the zip):
 *   - a .zip with manifest.json (at the root or in one top-level folder) and
 *     the module (manifest `entry`, else dist/action.js, else the only .js /
 *     .mjs file); README / LICENSE / sources are ignored; signature.json
 *     ({ alg: 'ed25519', public_key, signature: base64 over the module's
 *     SHA-256 hex }) optional;
 *   - a module (text) plus the manifest (JSON).
 *
 * The module must be ONE self-contained ES module (no imports) — the
 * sandbox has no module loader. It is loaded once in the sandbox at upload
 * to check that every declared operation has a function. Server only.
 */

import { moduleProblems as controlModuleProblems, sha256Hex, verifyPackageSignature, type ControlSignature } from '@/lib/forms/custom-controls/package'
import { ACTION_LIMITS, type ActionManifest } from './contract'
import { ActionManifestError, parseActionManifest } from './manifest'

export type ActionSignature = ControlSignature

export interface ParsedActionPackage {
  manifest: ActionManifest
  module: string
  sha256: string
  size_bytes: number
  signature: ActionSignature | null
  warnings: string[]
}

export class ActionPackageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionPackageError'
  }
}

const ZIP_MAX_BYTES = 5 * 1024 * 1024

/** Problems with the module text (empty = acceptable). */
export function actionModuleProblems(module: string): string[] {
  if (!module.trim()) return ['The module is empty']
  const problems: string[] = []
  if (Buffer.byteLength(module, 'utf8') > ACTION_LIMITS.moduleBytes) problems.push(`The module is larger than ${ACTION_LIMITS.moduleBytes / 1024} KB`)
  // Same import scan as form controls; the limit message there is about their size, so filter it.
  for (const problem of controlModuleProblems(module.length > 2 * 1024 * 1024 ? module.slice(0, 2 * 1024 * 1024) : module)) {
    if (/imports/.test(problem)) problems.push(problem.replace('(the starter kit\'s build does this)', '(the action starter kit\'s build does this)'))
  }
  if (!/export\s+default|export\s*\{[^}]*\bdefault\b/.test(module)) problems.push('The module has no default export — export default defineAction({ operations: { … } })')
  return problems
}

function parseManifest(raw: unknown): ActionManifest {
  try {
    return parseActionManifest(raw)
  } catch (error) {
    if (error instanceof ActionManifestError) throw new ActionPackageError(`manifest.json: ${error.message}`)
    throw error
  }
}

function finish(manifest: ActionManifest, module: string, signatureRaw?: unknown): ParsedActionPackage {
  const problems = actionModuleProblems(module)
  if (problems.length) throw new ActionPackageError(problems.join('; '))
  const sha256 = sha256Hex(module)
  const warnings: string[] = []
  for (const op of manifest.operations) {
    if (!module.includes(op.id)) warnings.push(`The module never mentions the operation "${op.id}"`)
  }
  let signature: ActionSignature | null = null
  if (signatureRaw !== undefined && signatureRaw !== null) {
    try {
      signature = verifyPackageSignature(signatureRaw, sha256)
    } catch (error) {
      throw new ActionPackageError((error as Error).message)
    }
    if (signature && !signature.verified) warnings.push('signature.json does not verify against the module — recorded as unverified')
  }
  return { manifest, module, sha256, size_bytes: Buffer.byteLength(module, 'utf8'), signature, warnings }
}

/** A module (text) plus its manifest (JSON text or object). */
export function parseActionModule(module: string, manifest: unknown, signature?: unknown): ParsedActionPackage {
  return finish(parseManifest(manifest), module, signature)
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)
}

/** A zip package. */
export async function parseActionZip(bytes: Uint8Array): Promise<ParsedActionPackage> {
  if (bytes.byteLength > ZIP_MAX_BYTES) throw new ActionPackageError(`The package is larger than ${ZIP_MAX_BYTES / 1024 / 1024} MB`)
  if (!isZip(bytes)) throw new ActionPackageError('Not a zip file')
  const PizZip = (await import('pizzip')).default
  let zip: InstanceType<typeof PizZip>
  try {
    zip = new PizZip(bytes)
  } catch {
    throw new ActionPackageError('The zip file could not be read')
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith('__MACOSX/') && !/(^|\/)\.[^/]+$/.test(n) && !n.includes('node_modules/'))
  if (names.length > 500) throw new ActionPackageError('The package has too many files (500 at most)')
  const manifestName = names.find((n) => n === 'manifest.json') ?? names.find((n) => /^[^/]+\/manifest\.json$/.test(n))
  if (!manifestName) throw new ActionPackageError('The package has no manifest.json')
  const prefix = manifestName.slice(0, -'manifest.json'.length)
  const read = (name: string) => zip.file(name)?.asText() ?? null
  const manifest = parseManifest(read(manifestName) ?? '')
  const inside = names.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length))
  const scripts = inside.filter((n) => /\.m?js$/.test(n) && !/\.map$/.test(n) && !/^(src|scripts|test|harness)\//.test(n))
  let entry = manifest.entry
  if (entry && !inside.includes(entry)) throw new ActionPackageError(`manifest.json entry "${entry}" is not in the package`)
  if (!entry) entry = ['dist/action.js', 'dist/action.mjs', 'action.js'].find((n) => inside.includes(n)) ?? (scripts.length === 1 ? scripts[0] : undefined)
  if (!entry) throw new ActionPackageError(scripts.length ? `Several scripts in the package (${scripts.slice(0, 4).join(', ')}) — set "entry" in manifest.json` : 'The package has no .js / .mjs module')
  const moduleText = read(prefix + entry) ?? ''
  const signatureText = inside.includes('signature.json') ? read(`${prefix}signature.json`) : null
  let signature: unknown
  if (signatureText !== null) {
    try { signature = JSON.parse(signatureText) } catch { throw new ActionPackageError('signature.json is not valid JSON') }
  }
  return finish({ ...manifest, entry }, moduleText, signature)
}

/** Any upload: zip bytes, or a module with its manifest. */
export async function parseActionUpload(input: { zip?: Uint8Array | null; module?: string | null; manifest?: unknown; signature?: unknown }): Promise<ParsedActionPackage> {
  if (input.zip && input.zip.byteLength) return parseActionZip(input.zip)
  if (typeof input.module === 'string') {
    if (input.manifest === undefined || input.manifest === null || input.manifest === '') throw new ActionPackageError('Add the manifest.json for the module (or upload a zip with both)')
    return parseActionModule(input.module, input.manifest, input.signature)
  }
  throw new ActionPackageError('Upload a zip package, or a module and its manifest')
}

/**
 * Load the module in the sandbox once and check that each declared
 * operation has a function (an upload-time probe; no operation runs).
 */
export async function probeActionModule(parsed: Pick<ParsedActionPackage, 'module' | 'manifest'>): Promise<string[]> {
  const { runInSandbox } = await import('./sandbox')
  const result = await runInSandbox({ source: parsed.module, mode: 'module', operation: '__ut_list__', inputs: {}, timeoutMs: 3000, memoryMb: Math.max(16, parsed.manifest.limits.memory_mb) })
  if (!result.ok) return [result.error?.message ?? 'The module could not be loaded']
  const listed = result.outputs as { operations?: string[]; single?: boolean }
  if (listed.single) return []
  const have = new Set(listed.operations ?? [])
  return parsed.manifest.operations.filter((op) => !have.has(op.id)).map((op) => `operation "${op.id}" has no function in the module`)
}
