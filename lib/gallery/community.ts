/**
 * Community gallery: the rules a shared solution must pass before a
 * moderator can approve it. Pure apart from the bytes it is given (no
 * database, storage or network), so the submission endpoint, the approval
 * step (re-validation) and the tests run the same checks.
 *
 *  - Listing metadata: title, summary, description, category, tags, licence
 *    (SPDX id, default Apache-2.0), author display name and optional link.
 *  - The .utpkg: at most 5 MB, a valid package (checksums; a signature is
 *    optional but must verify when present), no credential material, and
 *    the gallery validator on its assets — real node types and node
 *    settings, one trigger per workflow, every path connected, every id it
 *    points at inside the package, placeholder hosts only for integrations,
 *    no raw HTTP or placeholder nodes, forms / lookups / buttons valid.
 *  - Screenshots: up to 6 PNG / JPEG / WebP / SVG images of at most 2 MB;
 *    raster types are checked by their magic bytes, SVGs are sanitised
 *    (scripts, event handlers, external references removed) or refused.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { z } from 'zod'
import { fromPackageFiles, findSecretLeaks, countAssets, PACKAGE_SECTIONS } from '@/lib/packages/build'
import { unpackPackage, type PackageFileManifest } from '@/lib/packages/format'
import { isSemver } from '@/lib/packages/semver'
import { sanitizeSvg } from '@/lib/sanitize-svg'
import { isNativeContents } from './build'
import type { GallerySource } from './source'
import { GALLERY_CATEGORIES, type GalleryMeta, type GalleryTrigger } from './types'
import { validateGallerySource, type GalleryIssue } from './validate'

export const COMMUNITY_LIMITS = {
  packageBytes: 5 * 1024 * 1024,
  screenshots: 6,
  screenshotBytes: 2 * 1024 * 1024,
  svgChars: 200_000,
  /** Submissions per signed-in user per day, and per address per day. */
  perUserPerDay: 5,
  perIpPerDay: 10,
  /** Abuse reports per address per hour. */
  reportsPerIpPerHour: 5,
} as const

/** Common SPDX licence ids people pick; anything else must still look like an SPDX id. */
export const COMMUNITY_LICENCES = ['Apache-2.0', 'MIT', 'BSD-3-Clause', 'MPL-2.0', 'CC-BY-4.0', 'CC0-1.0', 'GPL-3.0-only', 'LGPL-3.0-only'] as const
export const DEFAULT_LICENCE = 'Apache-2.0'

export { ABUSE_REASONS, type AbuseReason } from './types'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SPDX = /^[A-Za-z0-9.+-]{2,40}$/
const NO_MARKUP = /^[^<>]*$/

const url = z.string().trim().max(300).refine((v) => {
  if (!v) return true
  try {
    const u = new URL(v)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password
  } catch {
    return false
  }
}, { message: 'Use an http(s) link' })

export const CommunityListingSchema = z.object({
  title: z.string().trim().min(3).max(80).regex(NO_MARKUP, 'No HTML'),
  summary: z.string().trim().min(40).max(200).regex(NO_MARKUP, 'No HTML'),
  description: z.string().trim().min(100).max(6000).regex(NO_MARKUP, 'No HTML'),
  category: z.enum(GALLERY_CATEGORIES.map((c) => c.id) as [string, ...string[]]),
  tags: z.array(z.string().trim().toLowerCase().min(2).max(30).regex(/^[a-z0-9][a-z0-9 .+#-]*$/, 'Tags are words')).min(1).max(8),
  licence: z.string().trim().regex(SPDX, 'Use an SPDX licence id such as Apache-2.0').default(DEFAULT_LICENCE),
  author_name: z.string().trim().min(2).max(60).regex(NO_MARKUP, 'No HTML'),
  author_url: url.optional().transform((v) => v || null),
  /** What changed in this version (shown in the version history). */
  notes: z.string().trim().max(1000).regex(NO_MARKUP, 'No HTML').optional().transform((v) => v || null),
  /** Optional: workflow inputs for the headless verification run. */
  sample_input: z.record(z.string(), z.unknown()).optional(),
  expect: z.enum(['waiting', 'completed']).optional(),
}).strict()

export type CommunityListing = z.infer<typeof CommunityListingSchema>

export interface CommunityPackageSummary {
  package_uid: string
  slug: string
  version: string
  name: string
  checksum: string
  signed: boolean
  signature_ok: boolean | null
  fingerprint: string | null
  size_bytes: number
  asset_count: number
  requirement_count: number
  workflows: number
  native: boolean
  entry_workflow: string | null
  trigger: GalleryTrigger
  /** Third-party hosts the integrations point at (all placeholders when valid). */
  hosts: string[]
}

export interface CommunityValidation {
  ok: boolean
  issues: GalleryIssue[]
  summary: CommunityPackageSummary | null
  /** Decoded contents (for the headless verification); null when unreadable. */
  contents: ReturnType<typeof fromPackageFiles>['contents'] | null
}

/** The workflow a run starts from: the first one no other workflow (or form button) starts. */
export function deriveEntryWorkflow(assets: Record<string, any>): any | null {
  const workflows: any[] = Array.isArray(assets.workflows) ? assets.workflows : []
  const called = new Set<string>()
  for (const wf of workflows) for (const node of wf.nodes ?? []) if (node?.config?.sub_workflow_id) called.add(String(node.config.sub_workflow_id))
  return workflows.find((wf) => !called.has(String(wf.id))) ?? workflows[0] ?? null
}

/** The gallery trigger kind of an entry workflow. */
export function triggerKindOf(workflow: any): GalleryTrigger {
  const type = String(workflow?.trigger_type ?? '')
  if (type === 'schedule') return 'schedule'
  if (type === 'form_submitted') return 'form'
  if (type === 'webhook_received') return (workflow.nodes ?? []).some((n: any) => n?.config?.start_form) ? 'form' : 'api'
  if (type === 'middleware_received') return 'api'
  return 'event'
}

/** The form whose submission starts the entry workflow (Form submitted trigger, or a form button that starts it). */
export function deriveEntryForm(assets: Record<string, any>, entry: any): string | undefined {
  const trigger = (entry?.nodes ?? []).find((n: any) => n?.type === 'form_submitted')
  if (trigger?.config?.form_id) return String(trigger.config.form_id)
  for (const form of assets.forms ?? []) {
    for (const button of form.buttons ?? []) for (const action of button.actions ?? []) if (action?.type === 'start_workflow' && String(action.workflow_id) === String(entry?.id)) return String(form.id)
  }
  return undefined
}

/**
 * Validate a submitted .utpkg (never throws): integrity, size, secrets and
 * the gallery validator on its assets. `listing` supplies the sample input
 * the verification will use (checked against the entry workflow's inputs).
 */
export function validateCommunityPackage(bytes: Uint8Array, listing: Pick<CommunityListing, 'sample_input' | 'expect'> = {}): CommunityValidation {
  const issues: GalleryIssue[] = []
  const fail = (message: string, path = 'package'): CommunityValidation => ({ ok: false, issues: [...issues, { path, message }], summary: null, contents: null })
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) return fail('The file is empty')
  if (bytes.byteLength > COMMUNITY_LIMITS.packageBytes) return fail(`The package is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${COMMUNITY_LIMITS.packageBytes / 1024 / 1024} MB`)
  let unpacked: ReturnType<typeof unpackPackage>
  try {
    unpacked = unpackPackage(bytes)
  } catch (error) {
    return fail((error as Error).message)
  }
  const { manifest, files, verification } = unpacked
  if (!verification.valid) for (const message of verification.errors) issues.push({ path: 'package', message })
  const header: any = (manifest as PackageFileManifest).package ?? {}
  const slug = String(header?.slug ?? '')
  if (!SLUG.test(slug) || slug.length > 60) issues.push({ path: 'manifest.json', message: 'the package slug must be lowercase words separated by hyphens (at most 60 characters)' })
  if (!isSemver(String(header?.version ?? ''))) issues.push({ path: 'manifest.json', message: 'the package version must be semver (1.0.0)' })
  const leaks = findSecretLeaks(files)
  if (leaks.length) issues.push({ path: 'package', message: `credential material found in ${leaks.slice(0, 5).join(', ')}: remove secrets before sharing` })

  const { contents, errors } = fromPackageFiles(manifest, files)
  for (const error of errors) issues.push({ path: 'package', message: error })
  const assets = contents.assets as Record<string, any>
  const unknownSections = Object.keys(assets).filter((section) => !(PACKAGE_SECTIONS as readonly string[]).includes(section))
  for (const section of unknownSections) issues.push({ path: 'package', message: `section "${section}" cannot travel in a package` })
  if (!(assets.workflows ?? []).length) issues.push({ path: 'package', message: 'a gallery package needs at least one workflow' })
  if ((assets.mcp_servers ?? []).length || (assets.log_destinations ?? []).length || (assets.workflow_activities ?? []).length) {
    issues.push({ path: 'package', message: 'community packages may not contain MCP servers, log destinations or custom code steps (custom activities)' })
  }
  const entry = deriveEntryWorkflow(assets)
  const trigger = triggerKindOf(entry)
  const entryForm = entry ? deriveEntryForm(assets, entry) : undefined

  // The gallery validator, on a source assembled from the package.
  const tableRows = Object.entries(contents.data ?? {}).filter(([, d]) => d?.mode === 'rows').map(([id, d]) => ({ id, name: `${id} rows`, rows: d.rows ?? [] }))
  const meta = {
    id: String(header?.id ?? ''), slug, title: String(header?.name ?? slug), category: 'operations-compliance', summary: '', description: '',
    trigger, entry_workflow: String(entry?.id ?? ''), ...(entryForm ? { entry_form: entryForm } : {}), start: '', difficulty: 'starter', setup_minutes: 10,
    tags: [], version: String(header?.version ?? ''), changelog: [], needs: [], setup: [], steps: [],
    sample_input: listing.sample_input ?? {}, expect: listing.expect ?? 'waiting',
  } as unknown as GalleryMeta
  const source: GallerySource = {
    dir: '', slug: slug || 'package', meta, readme: String(header?.readme ?? ''), files: [],
    manifest: { ...assets, ...(tableRows.length ? { table_rows: tableRows } : {}) }, paths: {}, errors: [],
  }
  for (const issue of validateGallerySource(source, { community: true })) issues.push({ path: issue.path.replace(/^[^/]*\/assets\//, '').replace(/^[^/]*\/gallery\.json$/, 'listing'), message: issue.message })

  const hosts = new Set<string>()
  for (const integration of assets.integrations ?? []) {
    try { hosts.add(new URL(String(integration.config?.base_url ?? '')).hostname) } catch { /* reported by the validator */ }
  }
  const summary: CommunityPackageSummary = {
    package_uid: String(header?.id ?? ''),
    slug,
    version: String(header?.version ?? ''),
    name: String(header?.name ?? slug),
    checksum: String(verification.checksum ?? ''),
    signed: verification.signed,
    signature_ok: verification.signature_ok,
    fingerprint: verification.fingerprint,
    size_bytes: bytes.byteLength,
    asset_count: countAssets(assets),
    requirement_count: contents.requirements.length,
    workflows: (assets.workflows ?? []).length,
    native: isNativeContents(contents),
    entry_workflow: entry ? String(entry.id) : null,
    trigger,
    hosts: [...hosts].sort(),
  }
  if (!/^[0-9a-f-]{36}$/i.test(summary.package_uid)) issues.push({ path: 'manifest.json', message: 'the package id must be a uuid' })
  return { ok: issues.length === 0, issues: dedupe(issues).slice(0, 100), summary, contents }
}

function dedupe(issues: GalleryIssue[]): GalleryIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.path}\u0000${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ── Screenshots ──────────────────────────────────────────────────────── */

export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const
export type ScreenshotType = (typeof SCREENSHOT_TYPES)[number]

export interface ScreenshotInput { name: string; type: string; bytes: Uint8Array }
export interface CleanScreenshot { type: ScreenshotType; ext: string; bytes: Uint8Array }

function magicOk(bytes: Uint8Array, type: string): boolean {
  const b = (i: number) => bytes[i]
  if (type === 'image/png') return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47
  if (type === 'image/jpeg') return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff
  if (type === 'image/webp') return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50
  return false
}

/**
 * A screenshot as it will be stored: the declared type must match the
 * bytes (raster types) and SVGs are sanitised; returns an error message
 * instead when the image cannot be used.
 */
export function cleanScreenshot(input: ScreenshotInput): CleanScreenshot | { error: string } {
  const type = String(input?.type ?? '').toLowerCase()
  const name = String(input?.name ?? 'image').slice(0, 80)
  if (!(SCREENSHOT_TYPES as readonly string[]).includes(type)) return { error: `${name}: use a PNG, JPEG, WebP or SVG image` }
  if (!(input.bytes instanceof Uint8Array) || !input.bytes.byteLength) return { error: `${name}: the file is empty` }
  if (input.bytes.byteLength > COMMUNITY_LIMITS.screenshotBytes) return { error: `${name}: images must be under ${COMMUNITY_LIMITS.screenshotBytes / 1024 / 1024} MB` }
  if (type === 'image/svg+xml') {
    const text = new TextDecoder().decode(input.bytes).replace(/^﻿?\s*(<\?xml[\s\S]*?\?>\s*)?(<!DOCTYPE[^>]*>\s*)?/i, '')
    if (text.length > COMMUNITY_LIMITS.svgChars) return { error: `${name}: the SVG is too large` }
    // sanitizeSvg caps at 50k characters for icons; screenshots may be larger, so sanitise in place with the same rules.
    const clean = sanitizeSvgDocument(text)
    if (!clean) return { error: `${name}: that SVG could not be used (it is not a valid, safe SVG image)` }
    return { type: 'image/svg+xml', ext: 'svg', bytes: new TextEncoder().encode(clean) }
  }
  if (!magicOk(input.bytes, type)) return { error: `${name}: the file is not a valid ${type.split('/')[1].toUpperCase()} image` }
  return { type: type as ScreenshotType, ext: type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg', bytes: input.bytes }
}

/**
 * The icon sanitiser's rules for screenshot-sized SVGs, plus: no external
 * references of any kind (href / src / url() pointing anywhere but a
 * local #fragment) and no <animate>/<set> that could rewrite attributes.
 */
export function sanitizeSvgDocument(raw: string): string | null {
  const input = String(raw ?? '').trim()
  if (!/^<svg[\s>]/i.test(input) || !/<\/svg>\s*$/i.test(input)) return null
  if (input.length > COMMUNITY_LIMITS.svgChars) return null
  // Process in 40k-character-safe steps: sanitizeSvg's own limit is for icons only.
  let svg = input.replace(/<!--[\s\S]*?-->/g, '')
  svg = svg.replace(/<(script|foreignObject|iframe|object|embed|style|animate|set|animateTransform|animateMotion|handler|listener)[\s\S]*?<\/\1\s*>/gi, '')
  svg = svg.replace(/<(script|foreignObject|iframe|object|embed|style|animate|set|animateTransform|animateMotion|handler|listener)\b[^>]*\/?>/gi, '')
  svg = svg.replace(/<use\b[^>]*>/gi, '').replace(/<\/use\s*>/gi, '')
  svg = svg.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // Only local fragment links survive.
  svg = svg.replace(/\s(href|xlink:href|src)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*'|(?!#)[^\s>"']+)/gi, '')
  svg = svg.replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none')
  const clean = svg.trim()
  if (!clean || !/^<svg[\s>]/i.test(clean)) return null
  // Final belt-and-braces pass with the icon sanitiser's rules when it fits its size cap.
  if (clean.length <= 50_000) return sanitizeSvg(clean)
  return clean
}
