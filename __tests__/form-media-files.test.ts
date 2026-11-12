/**
 * Image and Signature fields through the form upload pipeline
 * (lib/services/form-files.ts) with an in-memory database and local
 * storage: content sniffing (a renamed text file is refused), the field's
 * size / format limits, EXIF / GPS stripped before the bytes are stored, the
 * value rebuilt as ONE file object (Image) or a signature whose PNG and
 * metadata are the server's (browser-sent user / IP ignored; capture_audit),
 * binding on submit; uploadFormImage for display images.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLocalStorageProvider } from '@/lib/providers/storage/local'
import type { StorageProvider } from '@/lib/providers/storage/types'
import { readAll } from '@/lib/providers/storage/types'
import { createMemorySupabase } from './fixtures/supabase-memory'
import type { ServiceContext } from '@/lib/services/context'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TENANT = u(1)
const FORM = u(10)
const ADA = u(40)
const BOB = u(41)

let db: any
let provider: StorageProvider
const roots: string[] = []

vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => db }))
vi.mock('@/lib/providers/storage', async (orig) => ({ ...(await orig() as object), getStorageProvider: async () => provider }))
vi.mock('@/lib/reporting-lines', () => ({ loadReportingIndex: async () => ({}), isInManagerChain: () => false }))

const svc = await import('@/lib/services/form-files')
const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
const { stampSignatureValues } = await import('@/lib/services/form-signatures')
const { uploadFormImage } = await import('@/lib/services/uploads')

const bytes = (...parts: Array<number[] | string>) => {
  const arr: number[] = []
  for (const p of parts) { if (typeof p === 'string') for (const c of p) arr.push(c.charCodeAt(0)); else arr.push(...p) }
  return new Uint8Array(arr)
}
const be16 = (n: number) => [n >> 8, n & 0xff]
/** A JPEG with an EXIF segment naming a GPS position. */
const EXIF = bytes('Exif', [0, 0], 'MM', [0, 0x2a, 0, 0, 0, 8], [0, 0], [0, 0, 0, 0], 'GPS -41.2865 174.7762')
const JPEG = bytes([0xff, 0xd8], [0xff, 0xe1], be16(EXIF.length + 2), Array.from(EXIF) as any, [0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0], [9, 9, 9], [0xff, 0xd9])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

const FIELDS = [
  { key: 'photo', label: 'Photo', type: 'image', required: true, image: { max_mb: 0.1, types: ['jpeg', 'png'] } },
  { key: 'sig', label: 'Signature', type: 'signature', required: true },
  { key: 'audited', label: 'Audited signature', type: 'signature', signature: { capture_audit: true } },
]

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'ut-media-files-'))
  roots.push(root)
  provider = createLocalStorageProvider({ local_root: root })
  db = createMemorySupabase({
    forms: [{ id: FORM, tenant_id: TENANT, name: 'Claim', fields: FIELDS, version: 1, buttons: null, layout: null, theme: null, header: null }],
    tasks: [],
    workflows: [],
    task_assignees: [],
    user_teams: [],
    form_files: [],
    form_submissions: [],
    users: [{ id: ADA, display_name: 'Ada Lovelace', email: 'ada@x' }],
    user_memberships: [],
  }, { uuids: true })
}
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }) })

const ctx = (over: Partial<ServiceContext> = {}): ServiceContext => ({
  supabase: db, db, tenantId: TENANT, actorId: ADA, authKind: 'session', source: 'ui',
  permissions: new Set(['forms.submit', 'forms.edit']), ...over,
})
const upload = (field_key: string, name: string, data: Uint8Array, c: ServiceContext = ctx()) =>
  svc.uploadFormFile(c, { context: { kind: 'form', formId: FORM }, field_key, name, bytes: data, declared_size: data.byteLength })
const files = { kind: 'form' as const, formId: FORM, actorId: ADA }
const meta = { fields: FIELDS, template_values: {} }

describe('image uploads', () => {
  beforeEach(setup)

  it('stores a real picture with its EXIF / GPS removed', async () => {
    const file = await upload('photo', 'IMG_0001.jpg', JPEG)
    expect(file).toMatchObject({ name: 'IMG_0001.jpg', mime_type: 'image/jpeg' })
    expect(file.size).toBeLessThan(JPEG.byteLength)
    const object = await provider.get('form-files', db.tables.form_files[0].storage_key)
    const stored = Buffer.from(await readAll(object!.body))
    expect(stored.toString('latin1')).not.toContain('GPS')
    expect(stored.toString('latin1')).not.toContain('Exif')
    expect([stored[0], stored[1]]).toEqual([0xff, 0xd8])
  })

  it('refuses a non-image renamed .png, other formats and pictures over the size', async () => {
    await expect(upload('photo', 'cat.png', new TextEncoder().encode('hello, not a picture'))).rejects.toMatchObject({ status: 415 })
    await expect(upload('photo', 'cat.gif', bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0]))).rejects.toMatchObject({ status: 415 })
    const big = new Uint8Array(200 * 1024); big.set(PNG)
    await expect(upload('photo', 'big.png', big)).rejects.toMatchObject({ status: 413 })
  })

  it('the value is rebuilt as one file object; a list of two or a forged file is refused', async () => {
    const file = await upload('photo', 'IMG_0001.jpg', JPEG)
    const sig = await upload('sig', 'signature.png', PNG)
    const ok = await mergeTaskFieldValuesChecked(db, TENANT, meta, { photo: { ...file, size: 1, url: 'https://evil.example' }, sig: { file: sig, method: 'draw' } }, { files, actorId: ADA })
    expect(ok.errors).toEqual({})
    expect(ok.templateValues.photo).toEqual(file)
    expect(ok.templateValues).not.toHaveProperty('photo_count')
    expect(svc.attachmentIdsIn(FIELDS as any, ok.templateValues)).toEqual([file.id, sig.id])
    expect((await mergeTaskFieldValuesChecked(db, TENANT, meta, { photo: { ...file, name: 'renamed.exe' }, sig: null }, { files, actorId: ADA })).errors.photo).toMatch(/PNG, JPEG picture/)
    const two = await mergeTaskFieldValuesChecked(db, TENANT, meta, { photo: [file, file], sig: { file: sig, method: 'draw' } }, { files, actorId: ADA })
    expect(two.errors.photo).toBeTruthy()
    const forged = await mergeTaskFieldValuesChecked(db, TENANT, meta, { photo: { ...file, id: u(999) }, sig: { file: sig, method: 'draw' } }, { files, actorId: ADA })
    expect(forged.errors.photo).toMatch(/no longer available/)
    const missing = await mergeTaskFieldValuesChecked(db, TENANT, meta, { photo: null, sig: null }, { files, actorId: ADA })
    expect(missing.errors).toEqual({ photo: 'Photo is required', sig: 'Signature: please sign' })
  })

  it('a field with a default picture stores it when the person keeps it', async () => {
    const fields = [{ key: 'photo', label: 'Photo', type: 'image', required: true, image: { default_file: { name: 'placeholder.png', url: 'storage://task-files/form-images/t/p.png' } } }]
    const kept = await mergeTaskFieldValuesChecked(db, TENANT, { fields, template_values: {} }, { photo: null }, { files, actorId: ADA })
    expect(kept.errors).toEqual({})
    expect(kept.templateValues.photo).toMatchObject({ name: 'placeholder.png', url: 'storage://task-files/form-images/t/p.png', is_default: true })
  })
})

describe('signatures', () => {
  beforeEach(setup)

  it('the PNG must be an uploaded PNG of this person; the metadata is the server\'s', async () => {
    const photo = await upload('photo', 'IMG.jpg', JPEG)
    await expect(upload('sig', 'signature.jpg', JPEG)).rejects.toMatchObject({ status: 415 })
    const png = await upload('sig', 'signature.png', PNG)
    const forged = { file: { ...png, name: 'x.png' }, method: 'draw', signed_at: '2001-01-01T00:00:00Z', user_id: BOB, user_name: 'Mallory', ip: '6.6.6.6', user_agent: 'forged' }
    const result = await mergeTaskFieldValuesChecked(db, TENANT, meta, { photo, sig: forged }, { files, actorId: ADA })
    expect(result.errors).toEqual({})
    const stored = result.templateValues.sig as any
    expect(stored.file).toEqual(png)
    expect(stored).toMatchObject({ method: 'draw', user_id: ADA, user_name: 'Ada Lovelace' })
    expect(stored).not.toHaveProperty('ip')
    expect(stored).not.toHaveProperty('user_agent')
    expect(Math.abs(new Date(stored.signed_at).getTime() - Date.now())).toBeLessThan(60_000)
    // Someone else's upload, or the picture of another field, is refused.
    const bobs = await upload('sig', 'signature.png', PNG, ctx({ actorId: BOB }))
    expect((await mergeTaskFieldValuesChecked(db, TENANT, meta, { photo, sig: { file: bobs, method: 'draw' } }, { files, actorId: ADA })).errors.sig).toMatch(/no longer available/)
    expect((await mergeTaskFieldValuesChecked(db, TENANT, meta, { photo, sig: { file: photo, method: 'draw' } }, { files, actorId: ADA })).errors.sig).toMatch(/must be a PNG|no longer available/)
  })

  it('capture_audit records the request\'s IP and browser; off, nothing is recorded', async () => {
    const png = await upload('audited', 'signature.png', PNG)
    const fields = (await import('@/lib/task-field-schema')).normalizeTaskFields(FIELDS)
    const value = { file: png, method: 'type', typed_name: 'Ada Lovelace', ip: '6.6.6.6' }
    const on = await stampSignatureValues(db, fields, { audited: value }, { actorId: ADA, request: { ip: '203.0.113.7', user_agent: 'Firefox/140' } })
    expect(on.audited).toMatchObject({ method: 'type', typed_name: 'Ada Lovelace', user_id: ADA, user_name: 'Ada Lovelace', ip: '203.0.113.7', user_agent: 'Firefox/140' })
    const off = await stampSignatureValues(db, fields, { sig: { ...value, file: png } }, { actorId: null, request: { ip: '203.0.113.7', user_agent: 'Firefox/140' } })
    expect(off.sig).not.toHaveProperty('ip')
    expect(off.sig).not.toHaveProperty('user_id')
  })
})

describe('uploadFormImage (display images, imported pictures)', () => {
  beforeEach(setup)

  it('needs forms.edit, takes only real pictures up to 2 MB and strips their metadata', async () => {
    await expect(uploadFormImage(ctx({ permissions: new Set(['forms.submit']) }), { name: 'logo.png', type: 'image/png', bytes: PNG })).rejects.toThrow(/forms.edit/)
    await expect(uploadFormImage(ctx(), { name: 'logo.png', type: 'image/png', bytes: new TextEncoder().encode('<script>') })).rejects.toThrow(/PNG, JPEG, WebP or GIF/)
    await expect(uploadFormImage(ctx(), { name: 'big.png', type: 'image/png', bytes: new Uint8Array(3 * 1024 * 1024) })).rejects.toMatchObject({ status: 413 })
    // The browser's type is only a hint: a JPEG sent as PNG is stored as a JPEG.
    const stored = await uploadFormImage(ctx(), { name: 'photo.png', type: 'image/png', bytes: JPEG })
    expect(stored).toMatchObject({ mime_type: 'image/jpeg' })
    expect(stored.path).toMatch(new RegExp(`^form-images/${TENANT}/[0-9a-f-]{36}\\.jpg$`))
    const object = await provider.get('task-files', stored.path)
    expect(Buffer.from(await readAll(object!.body)).toString('latin1')).not.toContain('GPS')
  })
})
