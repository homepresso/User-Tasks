/**
 * Community gallery service: "Share your solution" submissions, the
 * moderation queue, the public community listing, downloads and abuse
 * reports. The rules a package must pass live in lib/gallery/community.ts.
 *
 * Model
 *  - Submitting needs a signed-in user on an instance where the community
 *    gallery is enabled (usertasks.com: DEPLOYMENT_MODE=cloud, or
 *    GALLERY_COMMUNITY=on). It is rate limited per user and per address,
 *    validated immediately (an invalid or unsafe package is refused and
 *    nothing is stored) and queued as `pending`. Nothing is public yet.
 *  - Moderators are the instance admins (INSTANCE_ADMIN_EMAILS /
 *    instance.admin_emails, verified email) — the same check as Settings →
 *    Infrastructure; workspace roles never grant it. Every moderation call
 *    re-checks it.
 *  - Approving re-validates the stored file with the current rules, refuses
 *    a package whose headless verification failed, lists it as Community
 *    (a new package, or a new version of the submitter's own package) and
 *    emails the submitter. Rejecting needs a reason, which is emailed too.
 *  - Headless verification (lib/gallery/verify-core) installs the package
 *    in a scratch workspace and runs it. GALLERY_HEADLESS_VERIFY decides
 *    where that may happen: `native` (default) only for packages with no
 *    integrations / AI agents and no outgoing email unless the email
 *    provider is the console; `all` also runs the mock-API verification
 *    (needs ALLOW_PRIVATE_EGRESS=true, meant for a review instance); `off`.
 *  - All writes use the service role; RLS lets anyone read LISTED packages
 *    and a user read their own submissions (migration 20261117000000).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- tables are not in the generated Database types */

import { createHash, randomUUID } from 'node:crypto'
import { getServiceDb } from '@/lib/providers/db'
import { getStorageProvider } from '@/lib/providers/storage'
import { readEnv } from '@/lib/config/bootstrap'
import { isCloud, publicBaseUrl } from '@/lib/deployment'
import { rateLimit } from '@/lib/rate-limit'
import { compareSemver } from '@/lib/packages/semver'
import {
  ABUSE_REASONS, cleanScreenshot, COMMUNITY_LIMITS, CommunityListingSchema, validateCommunityPackage,
  type AbuseReason, type CommunityListing, type CommunityValidation, type ScreenshotInput,
} from '@/lib/gallery/community'
import type { GalleryIndexEntry } from '@/lib/gallery/types'
import { ServiceError } from './context'

export const GALLERY_COMMUNITY_BUCKET = 'gallery-community'
const DAY = 24 * 60 * 60 * 1000

/** Is the community gallery (submissions, moderation, community listing) served by this instance? */
export function communityGalleryEnabled(): boolean {
  const flag = String(readEnv('GALLERY_COMMUNITY') ?? '').toLowerCase()
  if (flag === 'off') return false
  return isCloud() || flag === 'on'
}

function requireEnabled() {
  if (!communityGalleryEnabled()) throw ServiceError.notFound('The community gallery is not available on this instance')
}

export interface GalleryUser {
  id: string
  email?: string | null
}

export interface ModeratorCheck {
  (user: GalleryUser): Promise<boolean>
}

/** Instance admins moderate (verified email on the instance admin list). */
export const isGalleryModerator: ModeratorCheck = async (user) => {
  const { viewerCanSeeInfrastructure } = await import('@/lib/admin/infrastructure')
  return viewerCanSeeInfrastructure(user)
}

async function requireModerator(user: GalleryUser | null | undefined, check: ModeratorCheck = isGalleryModerator): Promise<GalleryUser> {
  requireEnabled()
  if (!user?.id) throw new ServiceError('unauthorized', 'Sign in to moderate the gallery')
  if (!(await check(user))) throw ServiceError.forbidden('Only instance administrators can moderate the community gallery')
  return user
}

function db(): any {
  return getServiceDb() as any
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Rate-limit keys never hold a raw address. */
function addressKey(ip: string | null | undefined): string {
  return createHash('sha256').update(`gallery:${String(ip ?? 'unknown')}`).digest('hex').slice(0, 32)
}

async function officialSlugs(): Promise<Set<string>> {
  const { GALLERY_PACKAGES } = await import('@/lib/gallery/site')
  return new Set(GALLERY_PACKAGES.map((pkg) => pkg.slug))
}

/* ── Submitting ──────────────────────────────────────────────────────── */

export interface SubmitInput {
  file: { name: string; bytes: Uint8Array }
  listing: unknown
  screenshots?: ScreenshotInput[]
}

export interface SubmissionView {
  id: string
  slug: string
  version: string
  title: string
  status: string
  decision_reason: string | null
  created_at: string
  reviewed_at: string | null
  validation: { ok: boolean; issues: Array<{ path: string; message: string }> }
}

const SUBMISSION_LIST = 'id, slug, version, title, status, decision_reason, created_at, reviewed_at, validation'

/**
 * Share a solution: validate the listing, screenshots and package now (an
 * invalid package is refused with its issues and nothing is stored), then
 * store the file and screenshots privately and queue the submission.
 */
export async function submitCommunityPackage(user: GalleryUser & { tenantId?: string | null }, input: SubmitInput, options: { ip?: string | null } = {}): Promise<SubmissionView> {
  requireEnabled()
  if (!user?.id) throw new ServiceError('unauthorized', 'Sign in to share a solution')

  const perUser = await rateLimit(`gallery-submit:user:${user.id}`, { max: COMMUNITY_LIMITS.perUserPerDay, windowMs: DAY })
  const perIp = await rateLimit(`gallery-submit:ip:${addressKey(options.ip)}`, { max: COMMUNITY_LIMITS.perIpPerDay, windowMs: DAY })
  if (!perUser.ok || !perIp.ok) throw new ServiceError('rate_limited', `You can share up to ${COMMUNITY_LIMITS.perUserPerDay} packages a day. Please try again later.`, { status: 429 })

  const parsed = CommunityListingSchema.safeParse(input.listing)
  if (!parsed.success) {
    throw ServiceError.validation(`Check the listing: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'listing'}: ${i.message}`).join('; ')}`)
  }
  const listing = parsed.data

  const shots = (input.screenshots ?? []).filter((s) => s && s.bytes?.byteLength)
  if (shots.length > COMMUNITY_LIMITS.screenshots) throw ServiceError.validation(`At most ${COMMUNITY_LIMITS.screenshots} screenshots`)
  const cleanShots = shots.map(cleanScreenshot)
  const badShot = cleanShots.find((s): s is { error: string } => 'error' in s)
  if (badShot) throw ServiceError.validation(badShot.error)

  if (!/\.utpkg$/i.test(String(input.file?.name ?? ''))) throw ServiceError.validation('Upload a .utpkg package file (Automations → Packages → Build, or usertasks packages build)')
  const bytes = input.file.bytes
  const validation = validateCommunityPackage(bytes, listing)
  if (!validation.ok || !validation.summary) {
    throw ServiceError.validation(`The package did not pass validation: ${validation.issues.slice(0, 5).map((i) => i.message).join('; ')}`, { issues: validation.issues })
  }
  const summary = validation.summary
  if ((await officialSlugs()).has(summary.slug)) throw ServiceError.conflict(`"${summary.slug}" is the name of an official package: give your package its own slug`)

  const client = db()
  const { data: existing } = await client.from('community_packages').select('id, owner_id, slug, current_version, package_uid').or(`package_uid.eq.${summary.package_uid},slug.eq.${summary.slug}`)
  for (const row of existing ?? []) {
    if (row.owner_id !== user.id) throw ServiceError.conflict(row.package_uid === summary.package_uid ? 'This package is already listed by another author' : `The name "${summary.slug}" is taken by another community package`)
    if (row.package_uid === summary.package_uid && compareSemver(summary.version, row.current_version) <= 0) {
      throw ServiceError.conflict(`Version ${summary.version} is not newer than the listed ${row.current_version}: bump the version`)
    }
  }

  const id = randomUUID()
  const fileName = `${summary.slug}-${summary.version}.utpkg`
  const storage = await getStorageProvider()
  await storage.ensureBucket(GALLERY_COMMUNITY_BUCKET, { public: false }).catch(() => {})
  const filePath = `submissions/${id}/${fileName}`
  await storage.put(GALLERY_COMMUNITY_BUCKET, filePath, bytes, { contentType: 'application/zip' })
  const screenshots: Array<{ path: string; type: string; size: number }> = []
  for (const [index, shot] of cleanShots.entries()) {
    if ('error' in shot) continue
    const path = `submissions/${id}/screenshot-${index + 1}.${shot.ext}`
    await storage.put(GALLERY_COMMUNITY_BUCKET, path, shot.bytes, { contentType: shot.type })
    screenshots.push({ path, type: shot.type, size: shot.bytes.byteLength })
  }

  const { data, error } = await client.from('gallery_submissions').insert({
    id,
    submitter_id: user.id,
    submitter_email: user.email ?? null,
    tenant_id: user.tenantId ?? null,
    package_uid: summary.package_uid,
    slug: summary.slug,
    version: summary.version,
    title: listing.title,
    summary: listing.summary,
    description: listing.description,
    category: listing.category,
    tags: [...new Set(listing.tags)],
    licence: listing.licence,
    author_name: listing.author_name,
    author_url: listing.author_url,
    notes: listing.notes,
    sample_input: listing.sample_input ?? null,
    expect: listing.expect ?? null,
    file_path: filePath,
    file_name: fileName,
    size_bytes: bytes.byteLength,
    sha256: sha256(bytes),
    checksum: summary.checksum,
    signed: summary.signed,
    fingerprint: summary.fingerprint,
    screenshots,
    validation: validationRecord(validation),
  }).select(SUBMISSION_LIST).single()
  if (error) {
    await storage.delete(GALLERY_COMMUNITY_BUCKET, [filePath, ...screenshots.map((s) => s.path)]).catch(() => {})
    if (error.code === '23505') throw ServiceError.conflict(`Version ${summary.version} of this package is already waiting for review`)
    throw new ServiceError('internal', 'The submission could not be stored')
  }
  void notify(user.email, `We received "${listing.title}"`, `<p>Thanks for sharing <strong>${esc(listing.title)}</strong> ${esc(summary.version)} with the UserTasks community.</p><p>It passed the automatic checks and is waiting for a moderator. Nothing is public until it is approved; we will email you the decision.</p>`)
  return data as SubmissionView
}

function validationRecord(validation: CommunityValidation) {
  return { ok: validation.ok, issues: validation.issues, summary: validation.summary, checked_at: new Date().toISOString() }
}

/** The signed-in user's own submissions (newest first). */
export async function listMySubmissions(user: GalleryUser): Promise<SubmissionView[]> {
  requireEnabled()
  const { data } = await db().from('gallery_submissions').select(SUBMISSION_LIST).eq('submitter_id', user.id).order('created_at', { ascending: false }).limit(50)
  return (data ?? []) as SubmissionView[]
}

/** The submitter withdraws a pending submission. */
export async function withdrawSubmission(user: GalleryUser, id: string): Promise<void> {
  requireEnabled()
  const { data } = await db().from('gallery_submissions').update({ status: 'withdrawn', updated_at: new Date().toISOString() }).eq('id', id).eq('submitter_id', user.id).eq('status', 'pending').select('id')
  if (!data?.length) throw ServiceError.notFound('No pending submission to withdraw')
}

/* ── Moderation ──────────────────────────────────────────────────────── */

export async function listModerationQueue(user: GalleryUser | null, filter: { status?: string } = {}, check?: ModeratorCheck) {
  await requireModerator(user, check)
  let query = db().from('gallery_submissions').select('id, slug, version, title, summary, category, author_name, submitter_email, status, created_at, reviewed_at, validation, verification, signed, size_bytes, screenshots, decision_reason').order('created_at', { ascending: filter.status === 'pending' || !filter.status })
  query = query.eq('status', filter.status ?? 'pending')
  const { data, error } = await query.limit(100)
  if (error) throw new ServiceError('internal', error.message)
  return data ?? []
}

export async function getSubmissionForReview(user: GalleryUser | null, id: string, check?: ModeratorCheck) {
  await requireModerator(user, check)
  const { data } = await db().from('gallery_submissions').select('*').eq('id', id).maybeSingle()
  if (!data) throw ServiceError.notFound('Submission not found')
  const { data: listed } = await db().from('community_packages').select('id, slug, current_version, owner_id, status').eq('package_uid', data.package_uid).maybeSingle()
  return { ...data, listed: listed ?? null }
}

async function readStored(path: string): Promise<Uint8Array> {
  const storage = await getStorageProvider()
  const object = await storage.get(GALLERY_COMMUNITY_BUCKET, path)
  if (!object) throw ServiceError.notFound('The stored file is missing')
  return new Uint8Array(await new Response(object.body).arrayBuffer())
}

export type HeadlessMode = 'off' | 'native' | 'all'

export function headlessMode(): HeadlessMode {
  const raw = String(readEnv('GALLERY_HEADLESS_VERIFY') ?? 'native').toLowerCase()
  return raw === 'off' || raw === 'all' ? raw : 'native'
}

/** Why a package cannot be run headlessly on this instance (null = it can). */
async function headlessBlocker(validation: CommunityValidation): Promise<string | null> {
  const mode = headlessMode()
  if (mode === 'off') return 'Headless verification is off on this instance (GALLERY_HEADLESS_VERIFY=off): verify it with npm run gallery:verify on a local stack'
  const assets = (validation.contents?.assets ?? {}) as Record<string, any[]>
  const external = (assets.integrations?.length ?? 0) + (assets.agents?.length ?? 0) + (assets.connectors?.length ?? 0)
  if (external && mode !== 'all') return 'The package calls external systems: its mock-API run needs GALLERY_HEADLESS_VERIFY=all on a review instance (or npm run gallery:verify locally)'
  if (external && readEnv('ALLOW_PRIVATE_EGRESS') !== 'true') return 'The mock-API run needs ALLOW_PRIVATE_EGRESS=true on this review instance'
  const sendsEmail = (assets.workflows ?? []).some((wf: any) => (wf.nodes ?? []).some((n: any) => n?.type === 'send_email'))
  if (sendsEmail) {
    const { getEmailProvider } = await import('@/lib/providers/email')
    const provider = await getEmailProvider().catch(() => null)
    if (provider?.id !== 'console') return 'The package sends email: it is run headlessly only where EMAIL_PROVIDER=console, so a test run never emails anyone'
  }
  return null
}

/**
 * Run the headless verification (install into a scratch workspace, run,
 * delete) when this instance allows it; the result is stored on the
 * submission either way ("skipped" with the reason when it may not run).
 */
export async function verifySubmission(user: GalleryUser | null, id: string, check?: ModeratorCheck) {
  await requireModerator(user, check)
  const submission = await getSubmissionForReview(user, id, check ?? (async () => true))
  const bytes = await readStored(submission.file_path)
  const validation = validateCommunityPackage(bytes, { sample_input: submission.sample_input ?? undefined, expect: submission.expect ?? undefined })
  let verification: Record<string, unknown>
  const blocker = validation.ok ? await headlessBlocker(validation) : 'The package does not pass validation'
  if (blocker || !validation.summary || !validation.contents) {
    verification = { status: 'skipped', detail: blocker, ran_at: new Date().toISOString() }
  } else {
    const { verifyPackagesHeadless } = await import('@/lib/gallery/verify-core')
    try {
      const { results, workspace } = await verifyPackagesHeadless(db(), [{
        slug: validation.summary.slug, trigger: validation.summary.trigger, fileName: submission.file_name, bytes, contents: validation.contents,
        meta: {
          entry_workflow: String(validation.summary.entry_workflow),
          sample_input: (submission.sample_input ?? {}) as Record<string, unknown>,
          expect: submission.expect ?? 'waiting',
        },
      }])
      const result = results[0]
      verification = { status: result.ok ? 'passed' : 'failed', detail: result.detail, run: result.run, installed: result.installed, setup: result.completed, native: result.native ?? false, workspace: workspace.slug, ran_at: new Date().toISOString() }
    } catch (error) {
      verification = { status: 'failed', detail: (error as Error).message.slice(0, 300), ran_at: new Date().toISOString() }
    }
  }
  await db().from('gallery_submissions').update({ verification, validation: validationRecord(validation), updated_at: new Date().toISOString() }).eq('id', id)
  return verification
}

export interface Decision {
  decision: 'approve' | 'reject'
  reason?: string | null
}

/** Approve (re-validated, listed as Community) or reject (with a reason); the submitter is emailed. */
export async function decideSubmission(user: GalleryUser | null, id: string, input: Decision, check?: ModeratorCheck) {
  const moderator = await requireModerator(user, check)
  const client = db()
  const { data: submission } = await client.from('gallery_submissions').select('*').eq('id', id).maybeSingle()
  if (!submission) throw ServiceError.notFound('Submission not found')
  if (submission.status !== 'pending') throw ServiceError.conflict(`This submission is already ${submission.status}`)
  const reason = String(input.reason ?? '').trim().slice(0, 2000) || null
  const now = new Date().toISOString()

  if (input.decision === 'reject') {
    if (!reason) throw ServiceError.validation('Give the submitter a reason')
    await client.from('gallery_submissions').update({ status: 'rejected', decision_reason: reason, reviewed_by: moderator.id, reviewed_at: now, updated_at: now }).eq('id', id).eq('status', 'pending')
    void notify(submission.submitter_email, `"${submission.title}" was not approved`, `<p>Thanks for sharing <strong>${esc(submission.title)}</strong> ${esc(submission.version)}. A moderator did not approve it for the community gallery:</p><blockquote>${esc(reason)}</blockquote><p>You can fix it and share it again from ${esc(publicBaseUrl())}/gallery/share.</p>`)
    return { status: 'rejected' as const }
  }

  if (input.decision !== 'approve') throw ServiceError.validation('decision must be approve or reject')
  // Re-validate with today's rules: the stored bytes must still pass.
  const bytes = await readStored(submission.file_path)
  if (sha256(bytes) !== submission.sha256) throw ServiceError.conflict('The stored file does not match its checksum')
  const validation = validateCommunityPackage(bytes, { sample_input: submission.sample_input ?? undefined, expect: submission.expect ?? undefined })
  if (!validation.ok || !validation.summary) {
    await client.from('gallery_submissions').update({ validation: validationRecord(validation), updated_at: now }).eq('id', id)
    throw ServiceError.validation(`The package no longer passes validation: ${validation.issues.slice(0, 3).map((i) => i.message).join('; ')}`)
  }
  if (submission.verification?.status === 'failed') throw ServiceError.validation('The headless verification failed: reject it, or verify again after checking the run')
  const summary = validation.summary

  const { data: current } = await client.from('community_packages').select('*').eq('package_uid', summary.package_uid).maybeSingle()
  if (current && current.owner_id && current.owner_id !== submission.submitter_id) throw ServiceError.conflict('Another author owns this package')
  if (current && compareSemver(summary.version, current.current_version) <= 0) throw ServiceError.conflict(`Version ${summary.version} is not newer than the listed ${current.current_version}`)

  const listing = {
    slug: summary.slug, title: submission.title, summary: submission.summary, description: submission.description, category: submission.category,
    tags: submission.tags ?? [], licence: submission.licence, author_name: submission.author_name, author_url: submission.author_url,
    trigger: summary.trigger, native: summary.native, current_version: summary.version, current_submission_id: id,
    screenshots: submission.screenshots ?? [], updated_at: now,
  }
  let packageId: string
  if (current) {
    const { error } = await client.from('community_packages').update(listing).eq('id', current.id)
    if (error) throw new ServiceError('internal', error.message)
    packageId = current.id
  } else {
    const { data: created, error } = await client.from('community_packages').insert({ ...listing, package_uid: summary.package_uid, owner_id: submission.submitter_id }).select('id').single()
    if (error) throw error.code === '23505' ? ServiceError.conflict(`The name "${summary.slug}" is already taken`) : new ServiceError('internal', error.message)
    packageId = created.id
  }
  const { error: versionError } = await client.from('community_package_versions').insert({
    package_id: packageId, submission_id: id, version: summary.version, file_path: submission.file_path, file_name: submission.file_name,
    size_bytes: submission.size_bytes, sha256: submission.sha256, checksum: summary.checksum, signed: summary.signed, fingerprint: summary.fingerprint,
    notes: submission.notes, requirement_count: summary.requirement_count, asset_count: summary.asset_count, released_at: now,
  })
  if (versionError) throw new ServiceError('internal', versionError.message)
  await client.from('gallery_submissions').update({
    status: 'approved', decision_reason: reason, reviewed_by: moderator.id, reviewed_at: now, updated_at: now,
    community_package_id: packageId, validation: validationRecord(validation),
  }).eq('id', id)
  const link = `${publicBaseUrl()}/gallery/community/${summary.slug}`
  void notify(submission.submitter_email, `"${submission.title}" is live in the community gallery`, `<p><strong>${esc(submission.title)}</strong> ${esc(summary.version)} was approved and is listed as a Community package:</p><p><a href="${esc(link)}">${esc(link)}</a></p>${reason ? `<p>Moderator note: ${esc(reason)}</p>` : ''}<p>Thank you for sharing it.</p>`)
  return { status: 'approved' as const, package_id: packageId, slug: summary.slug }
}

/* ── Public listing ──────────────────────────────────────────────────── */

export interface CommunityPackageView {
  id: string
  package_uid: string
  slug: string
  title: string
  summary: string
  description: string
  category: string
  tags: string[]
  licence: string
  author_name: string
  author_url: string | null
  trigger: 'form' | 'api' | 'schedule' | 'event'
  native: boolean
  current_version: string
  downloads: number
  screenshots: Array<{ path: string; type: string; size: number }>
  created_at: string
  updated_at: string
  versions: Array<{ version: string; file_name: string; size_bytes: number; sha256: string; checksum: string; signed: boolean; fingerprint: string | null; notes: string | null; requirement_count: number; asset_count: number; downloads: number; released_at: string }>
}

const PACKAGE_COLUMNS = 'id, package_uid, slug, title, summary, description, category, tags, licence, author_name, author_url, trigger, native, current_version, downloads, screenshots, created_at, updated_at'
const VERSION_COLUMNS = 'package_id, version, file_name, size_bytes, sha256, checksum, signed, fingerprint, notes, requirement_count, asset_count, downloads, released_at'

/** Listed community packages with their versions (newest first). Empty when the gallery is off or the tables are missing. */
export async function listCommunityPackages(): Promise<CommunityPackageView[]> {
  if (!communityGalleryEnabled()) return []
  try {
    const { data, error } = await db().from('community_packages').select(PACKAGE_COLUMNS).eq('status', 'listed').order('updated_at', { ascending: false }).limit(500)
    if (error || !data?.length) return []
    const { data: versions } = await db().from('community_package_versions').select(VERSION_COLUMNS).in('package_id', data.map((p: any) => p.id)).order('released_at', { ascending: false })
    return data.map((p: any) => ({ ...p, downloads: Number(p.downloads ?? 0), versions: (versions ?? []).filter((v: any) => v.package_id === p.id).map(({ package_id: _id, ...v }: any) => ({ ...v, downloads: Number(v.downloads ?? 0) })) }))
  } catch {
    return []
  }
}

export async function getCommunityPackage(slug: string): Promise<CommunityPackageView | null> {
  const all = await listCommunityPackages()
  return all.find((p) => p.slug === slug) ?? null
}

/** Community entries for the gallery index (index.json format; `file` is an absolute download URL). */
export function communityIndexEntry(pkg: CommunityPackageView, baseUrl: string): GalleryIndexEntry {
  const version = pkg.versions.find((v) => v.version === pkg.current_version) ?? pkg.versions[0]
  return {
    id: pkg.package_uid,
    slug: pkg.slug,
    title: pkg.title,
    category: pkg.category as GalleryIndexEntry['category'],
    summary: pkg.summary,
    trigger: pkg.trigger,
    version: pkg.current_version,
    released: String(version?.released_at ?? pkg.updated_at).slice(0, 10),
    tags: pkg.tags,
    needs: [],
    optional_needs: [],
    difficulty: 'intermediate',
    setup_minutes: pkg.native ? 5 : 20,
    file: `${baseUrl}/api/gallery/community/${pkg.slug}/download`,
    file_name: version?.file_name ?? `${pkg.slug}-${pkg.current_version}.utpkg`,
    size_bytes: version?.size_bytes ?? 0,
    sha256: version?.sha256 ?? '',
    checksum: version?.checksum ?? '',
    signed: Boolean(version?.signed),
    fingerprint: version?.fingerprint ?? null,
    asset_count: version?.asset_count ?? 0,
    requirement_count: version?.requirement_count ?? 0,
    page: `${baseUrl}/gallery/community/${pkg.slug}`,
    source: 'community',
    systems: [],
    native: pkg.native,
    author: { name: pkg.author_name, url: pkg.author_url },
    licence: pkg.licence,
    downloads: pkg.downloads,
  }
}

/** The file of a listed package version (current by default); counts the download. */
export async function downloadCommunityPackage(slug: string, version?: string | null): Promise<{ bytes: Uint8Array; file_name: string; sha256: string }> {
  requireEnabled()
  const { data: pkg } = await db().from('community_packages').select('id, current_version, status').eq('slug', slug).maybeSingle()
  if (!pkg || pkg.status !== 'listed') throw ServiceError.notFound('Package not found')
  const wanted = version || pkg.current_version
  const { data: row } = await db().from('community_package_versions').select('version, file_path, file_name, sha256').eq('package_id', pkg.id).eq('version', wanted).maybeSingle()
  if (!row) throw ServiceError.notFound('Version not found')
  const bytes = await readStored(row.file_path)
  await db().rpc('gallery_record_download', { p_package_id: pkg.id, p_version: row.version })
  return { bytes, file_name: row.file_name, sha256: row.sha256 }
}

/**
 * A screenshot: of a listed package (anyone), or of a submission (its
 * submitter or a moderator). Index is 1-based.
 */
export async function readScreenshot(target: { slug?: string; submissionId?: string }, index: number, viewer: GalleryUser | null = null, check: ModeratorCheck = isGalleryModerator): Promise<{ bytes: Uint8Array; type: string }> {
  requireEnabled()
  let shots: Array<{ path: string; type: string }> = []
  if (target.slug) {
    const { data } = await db().from('community_packages').select('screenshots, status').eq('slug', target.slug).maybeSingle()
    if (!data || data.status !== 'listed') throw ServiceError.notFound('Screenshot not found')
    shots = data.screenshots ?? []
  } else if (target.submissionId) {
    const { data } = await db().from('gallery_submissions').select('screenshots, submitter_id').eq('id', target.submissionId).maybeSingle()
    if (!data || !viewer?.id || (data.submitter_id !== viewer.id && !(await check(viewer)))) throw ServiceError.notFound('Screenshot not found')
    shots = data.screenshots ?? []
  }
  const shot = shots[index - 1]
  if (!shot) throw ServiceError.notFound('Screenshot not found')
  return { bytes: await readStored(shot.path), type: shot.type }
}

/* ── Abuse reports ───────────────────────────────────────────────────── */

export async function reportAbuse(input: { slug: string; version?: string | null; reason: string; details?: string | null }, reporter: { userId?: string | null; ip?: string | null }) {
  requireEnabled()
  if (!(input.reason in ABUSE_REASONS)) throw ServiceError.validation(`reason must be one of ${Object.keys(ABUSE_REASONS).join(', ')}`)
  const limited = await rateLimit(`gallery-report:${addressKey(reporter.ip)}`, { max: COMMUNITY_LIMITS.reportsPerIpPerHour, windowMs: 60 * 60 * 1000 })
  if (!limited.ok) throw new ServiceError('rate_limited', 'Too many reports from this address. Please try again later.', { status: 429 })
  const { data: pkg } = await db().from('community_packages').select('id').eq('slug', input.slug).maybeSingle()
  if (!pkg) throw ServiceError.notFound('Package not found')
  const details = String(input.details ?? '').replace(/[<>]/g, '').trim().slice(0, 2000) || null
  const { error } = await db().from('gallery_abuse_reports').insert({ package_id: pkg.id, version: input.version ?? null, reporter_id: reporter.userId ?? null, reporter_hash: addressKey(reporter.ip), reason: input.reason as AbuseReason, details })
  if (error) throw new ServiceError('internal', 'The report could not be stored')
  return { ok: true }
}

export async function listAbuseReports(user: GalleryUser | null, check?: ModeratorCheck) {
  await requireModerator(user, check)
  const { data } = await db().from('gallery_abuse_reports').select('id, package_id, version, reason, details, status, created_at, community_packages(slug, title, status)').eq('status', 'open').order('created_at', { ascending: true }).limit(100)
  return data ?? []
}

/** Resolve a report: dismiss it, or unlist the package (hidden from the gallery and downloads at once). */
export async function resolveAbuseReport(user: GalleryUser | null, id: string, action: 'dismiss' | 'unlist', check?: ModeratorCheck) {
  const moderator = await requireModerator(user, check)
  const { data: report } = await db().from('gallery_abuse_reports').select('id, package_id, reason').eq('id', id).maybeSingle()
  if (!report) throw ServiceError.notFound('Report not found')
  const now = new Date().toISOString()
  if (action === 'unlist') {
    await db().from('community_packages').update({ status: 'unlisted', unlisted_reason: `Abuse report: ${report.reason}`, updated_at: now }).eq('id', report.package_id)
  }
  await db().from('gallery_abuse_reports').update({ status: action === 'unlist' ? 'resolved' : 'dismissed', resolved_by: moderator.id, resolved_at: now }).eq('id', id)
  return { ok: true }
}

/** A moderator lists an unlisted package again (or unlists one directly). */
export async function setPackageListed(user: GalleryUser | null, packageId: string, listed: boolean, check?: ModeratorCheck) {
  await requireModerator(user, check)
  await db().from('community_packages').update({ status: listed ? 'listed' : 'unlisted', unlisted_reason: listed ? null : 'Unlisted by a moderator', updated_at: new Date().toISOString() }).eq('id', packageId)
}

/* ── Email ───────────────────────────────────────────────────────────── */

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]!)
}

/** Email through the instance's EmailProvider; never throws (a decision stands without it). */
async function notify(to: string | null | undefined, subject: string, body: string): Promise<void> {
  if (!to) return
  try {
    const { sendEmail } = await import('@/lib/email')
    await sendEmail({ to, subject: `UserTasks gallery: ${subject}`, body: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1B1916">${body}<p style="color:#6E6759;font-size:13px">UserTasks community gallery</p></div>` })
  } catch (error) {
    console.warn('[gallery] notification failed:', (error as Error).message)
  }
}

export type { CommunityListing }
