/**
 * End-to-end check of every gallery package against a LOCAL stack:
 *
 *   1. creates a scratch workspace (deleted again at the end unless --keep)
 *   2. installs each public/gallery/*.utpkg exactly as Settings → Packages
 *      does, keeping it incomplete (no requirement values)
 *   3. completes setup against a mock API this script serves: every REST
 *      integration's base URL points at the mock, which answers each
 *      reference with its response-model sample (and AI integrations with a
 *      canned chat completion); assignees are the scratch owner
 *   4. starts the entry workflow with gallery.json sample_input and checks the
 *      run reaches what gallery.json `expect`s: waiting on a User Task
 *      (assigned to the owner) or completed
 *
 *   npm run gallery:build && npm run gallery:verify [-- <slug> …] [--keep] [--json <file>]
 *   npm run gallery:verify -- --dir <dir> <slug>   # packages built with gallery:build -- --out <dir>
 *   npm run gallery:verify -- --cleanup     # delete leftover gallery-verify-* workspaces (older than 30 min, or the one named)
 *
 * The engine is lib/gallery/verify-core.ts (shared with the community
 * moderation queue's re-verification).
 *
 * Needs the local-stack env (NEXT_PUBLIC_SUPABASE_URL on localhost,
 * SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY). Refuses any non-local
 * database. Sets ALLOW_PRIVATE_EGRESS=true and EMAIL_PROVIDER=console for
 * its own process so the engine may call the mock and emails go to the log.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role client and free-form manifests */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

process.env.ALLOW_PRIVATE_EGRESS = 'true'
process.env.EMAIL_PROVIDER ??= 'console'

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null
/** --dir <dir>: verify packages built with `gallery:build -- --out <dir>` instead of public/gallery. */
const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : join(process.cwd(), 'public', 'gallery')
const only = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--json' && args[i - 1] !== '--dir')

function assertLocal() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  let host = ''
  try { host = new URL(url).hostname } catch { /* unset */ }
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL (${url || 'unset'}) is not a local stack. This script creates and deletes a workspace.`)
    process.exit(2)
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY is required'); process.exit(2) }
  if (!process.env.ENCRYPTION_KEY) { console.error('ENCRYPTION_KEY is required (integration credentials are encrypted at rest)'); process.exit(2) }
}

async function main() {
  assertLocal()
  const { createClient } = await import('@supabase/supabase-js')
  const { unpackPackage } = await import('@/lib/packages/format')
  const { fromPackageFiles } = await import('@/lib/packages/build')
  const { readGallerySource } = await import('@/lib/gallery/source')
  const { deleteScratchTenant, verifyPackagesHeadless } = await import('@/lib/gallery/verify-core')

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) as any
  if (args.includes('--cleanup')) {
    // Leftovers of interrupted runs (--keep, crashes): every gallery-verify-* workspace.
    // Only workspaces older than 30 minutes, so a verify running in parallel keeps its own.
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString()
    // `--cleanup <slug>` removes that one workspace now (it must still be a gallery-verify-* one).
    const named = only.find((slug) => slug.startsWith('gallery-verify-'))
    const query = db.from('tenants').select('id, slug').like('slug', 'gallery-verify-%')
    const { data: stale } = named ? await query.eq('slug', named) : await query.lt('created_at', cutoff)
    for (const tenant of stale ?? []) console.log(`${tenant.slug}: ${(await deleteScratchTenant(db, tenant.id)) ?? 'deleted'}`)
    return
  }
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
  const entries = (index.packages as any[]).filter((p) => !only.length || only.includes(p.slug))
  if (!entries.length) throw new Error('No packages to verify (run npm run gallery:build first)')

  const packages = entries.map((entry) => {
    const bytes = new Uint8Array(readFileSync(join(dir, entry.file_name)))
    const unpacked = unpackPackage(bytes)
    if (!unpacked.verification.valid) throw new Error(`${entry.slug}: ${unpacked.verification.errors.join('; ')}`)
    const { contents } = fromPackageFiles(unpacked.manifest, unpacked.files)
    return { slug: entry.slug, trigger: entry.trigger, fileName: entry.file_name, bytes, contents, meta: readGallerySource(entry.slug).meta }
  })

  const { results } = await verifyPackagesHeadless(db, packages, {
    keep,
    log: (line) => console.log(line),
    onResult: (result) => console.log(`${result.ok ? '✓' : '✗'} ${result.slug.padEnd(36)} ${result.installed.padEnd(10)} → ${result.completed.padEnd(8)} run ${result.run.padEnd(18)} ${result.detail}`),
  })

  const passed = results.filter((r) => r.ok).length
  console.log(`\n| Package | Trigger | Native | Install | Setup | Run | Expected | Mock calls | Result |\n|---|---|---|---|---|---|---|---|---|`)
  for (const r of results) console.log(`| ${r.slug} | ${r.trigger} | ${r.native ? 'yes' : ''} | ${r.installed} | ${r.completed} | ${r.run} | ${r.expected} | ${r.calls} | ${r.ok ? 'pass' : `FAIL: ${r.detail}`} |`)
  console.log(`\n${passed}/${results.length} packages passed`)
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2))
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
