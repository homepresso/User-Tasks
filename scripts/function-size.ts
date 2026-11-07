/**
 * Server function size check, run after a production build.
 *
 *   npm run check:function-size                  # after `next build` (reads .next/**.nft.json)
 *   npm run check:function-size -- --vercel      # after `vercel build` (reads .vercel/output/functions)
 *   npm run check:function-size -- --max-mb 120 --top 15 --route /api/v1
 *
 * It fails when
 *  - a function is over the budget (--max-mb, default 150). In .nft.json mode
 *    a "function" is one route's trace plus Next's minimal-server trace, and
 *    the report also estimates the functions Vercel would make: its builder
 *    packs many routes into one function until the union of their files
 *    reaches MAX_UNCOMPRESSED_LAMBDA_SIZE (default 250 MiB) less 25 MiB, so
 *    deployed functions are much bigger than any one route. `npm run
 *    vercel:build` sets MAX_UNCOMPRESSED_LAMBDA_SIZE to keep them under the
 *    budget;
 *  - a route is missing a file it reads at runtime (REQUIRED_TRACED_FILES in
 *    lib/function-tracing.ts);
 *  - a server chunk does not compile (scripts/check-server-chunks.mjs, run
 *    on .next/server): a minifier that breaks a chunk fails
 *    here instead of with "Failed to load chunk" in production. --no-parse
 *    skips this.
 *
 * Sizes are of the files on disk: a macOS build counts the darwin binaries
 * that next.config.ts leaves out of Vercel builds only when VERCEL is set.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { REQUIRED_TRACED_FILES } from '../lib/function-tracing'

const MIB = 1024 * 1024

interface Options {
  vercel: boolean
  maxMb: number
  top: number
  route: string | null
  parse: boolean
  dir: string
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { vercel: false, maxMb: 150, top: 10, route: null, parse: true, dir: process.cwd() }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--vercel') opts.vercel = true
    else if (arg === '--no-parse') opts.parse = false
    else if (arg === '--max-mb') opts.maxMb = Number(argv[++i])
    else if (arg === '--top') opts.top = Number(argv[++i])
    else if (arg === '--route') opts.route = argv[++i]
    else if (arg === '--dir') opts.dir = path.resolve(argv[++i])
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isFinite(opts.maxMb) || opts.maxMb <= 0) throw new Error('--max-mb must be a positive number')
  return opts
}

const sizeCache = new Map<string, number>()
function fileSize(file: string): number {
  let size = sizeCache.get(file)
  if (size === undefined) {
    try {
      const st = statSync(file)
      size = st.isFile() ? st.size : 0
    } catch {
      size = 0
    }
    sizeCache.set(file, size)
  }
  return size
}

function walk(dir: string, match: (file: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, match, out)
    else if (match(full)) out.push(full)
  }
  return out
}

interface Fn {
  name: string
  /** App path without route groups, e.g. /tasks/[id]/page. */
  route: string
  isRoute: boolean
  files: Set<string>
  bytes: number
}

const sumBytes = (files: Iterable<string>) => {
  let bytes = 0
  for (const f of files) bytes += fileSize(f)
  return bytes
}

const stripGroups = (name: string) => name.replace(/\/\([^/)]+\)/g, '').replace(/\/@[^/]+/g, '') || '/'

function readTrace(traceFile: string): string[] {
  const { files = [] } = JSON.parse(readFileSync(traceFile, 'utf8')) as { files?: string[] }
  const base = path.dirname(traceFile)
  return files.map((f) => path.resolve(base, f))
}

/** One function per route, from the build's .nft.json traces. */
function functionsFromNft(root: string): { fns: Fn[]; shared: string[] } {
  const distDir = path.join(root, '.next')
  const minimalTrace = path.join(distDir, 'next-minimal-server.js.nft.json')
  const shared = existsSync(minimalTrace) ? readTrace(minimalTrace) : []
  const serverAppDir = path.join(distDir, 'server', 'app')
  const fns: Fn[] = []
  for (const trace of walk(serverAppDir, (f) => /[/\\](page|route)\.js\.nft\.json$/.test(f))) {
    const entry = trace.replace(/\.nft\.json$/, '')
    const name = '/' + path.relative(serverAppDir, entry).replace(/\\/g, '/').replace(/\.js$/, '')
    const files = new Set([entry, ...readTrace(trace), ...shared])
    fns.push({ name, route: stripGroups(name), isRoute: name.endsWith('/route'), files, bytes: sumBytes(files) })
  }
  return { fns, shared }
}

/** The functions `vercel build` wrote (.vc-config.json filePathMap + files in the .func dir). */
function functionsFromVercel(root: string): Fn[] {
  const fnRoot = path.join(root, '.vercel', 'output', 'functions')
  if (!existsSync(fnRoot)) throw new Error(`${fnRoot} not found: run \`vercel build\` first`)
  const fns: Fn[] = []
  const seen = new Set<string>()
  for (const config of walk(fnRoot, (f) => f.endsWith('.func/.vc-config.json'))) {
    const funcDir = path.dirname(config)
    // Vercel links the routes of one function together: count each real dir once.
    const real = realpathSync(funcDir)
    if (seen.has(real)) continue
    seen.add(real)
    const { filePathMap = {} } = JSON.parse(readFileSync(config, 'utf8')) as { filePathMap?: Record<string, string> }
    const files = new Set<string>(Object.values(filePathMap).map((src) => path.resolve(root, src)))
    for (const f of walk(real, () => true)) files.add(f)
    const name = '/' + path.relative(fnRoot, funcDir).replace(/\\/g, '/').replace(/\.func$/, '')
    fns.push({ name, route: name, isRoute: false, files, bytes: sumBytes(files) })
  }
  return fns
}

/**
 * Roughly how @vercel/next groups routes into functions: route handlers and
 * pages separately, in order, each group growing until its files would reach
 * the lambda size less 25 MiB reserved.
 */
function estimateVercelGroups(fns: Fn[], shared: string[], lambdaBytes: number): { bytes: number; routes: number }[] {
  const limit = lambdaBytes - 25 * MIB
  const groups: { files: Set<string>; bytes: number; routes: number; isRoute: boolean }[] = []
  for (const fn of [...fns].sort((a, b) => a.name.localeCompare(b.name))) {
    let placed = false
    for (const group of groups) {
      if (group.isRoute !== fn.isRoute) continue
      let added = 0
      for (const f of fn.files) if (!group.files.has(f)) added += fileSize(f)
      if (group.bytes + added < limit) {
        for (const f of fn.files) group.files.add(f)
        group.bytes += added
        group.routes++
        placed = true
        break
      }
    }
    if (!placed) {
      const files = new Set([...shared, ...fn.files])
      groups.push({ files, bytes: sumBytes(files), routes: 1, isRoute: fn.isRoute })
    }
  }
  return groups.map(({ bytes, routes }) => ({ bytes, routes })).sort((a, b) => b.bytes - a.bytes)
}

/** Bucket a file for the contributor report: node_modules package, .next dir, or top-level dir. */
function bucket(root: string, file: string): string {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  const nm = rel.lastIndexOf('node_modules/')
  if (nm !== -1) {
    const parts = rel.slice(nm + 'node_modules/'.length).split('/')
    return `node_modules/${parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]}`
  }
  if (rel.startsWith('.next/')) return rel.split('/').slice(0, rel.startsWith('.next/server/chunks/') ? 4 : 3).join('/').replace(/\/[^/]+\.js$/, '')
  const parts = rel.split('/')
  return parts.length > 2 ? parts.slice(0, 2).join('/') : rel
}

/** Missing REQUIRED_TRACED_FILES, as "route: file (why)". */
function missingRequiredFiles(root: string, fns: Fn[]): string[] {
  const problems: string[] = []
  for (const rule of REQUIRED_TRACED_FILES) {
    const matching = fns.filter((fn) => rule.routes.test(fn.route))
    if (matching.length === 0) {
      problems.push(`no function matches ${rule.routes} (${rule.why})`)
      continue
    }
    for (const fn of matching) {
      for (const file of rule.files) {
        if (!fn.files.has(path.resolve(root, file))) problems.push(`${fn.name}: ${file} (${rule.why})`)
      }
    }
  }
  return problems
}

/** scripts/check-server-chunks.mjs (npm run check:server-chunks): every server chunk compiles. */
function serverChunksCompile(root: string): boolean {
  const script = path.join(root, 'scripts', 'check-server-chunks.mjs')
  const result = spawnSync(process.execPath, [script, path.join(root, '.next', 'server')], { stdio: 'inherit' })
  return result.status === 0
}

const mb = (bytes: number) => (bytes / MIB).toFixed(1)

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const failures: string[] = []
  let fns: Fn[]
  let shared: string[] = []
  if (opts.vercel) fns = functionsFromVercel(opts.dir)
  else ({ fns, shared } = functionsFromNft(opts.dir))
  if (fns.length === 0) throw new Error('No traced functions found: run `next build` (or `vercel build`, with --vercel) first')

  const rows = fns.filter((fn) => !opts.route || fn.name.startsWith(opts.route) || fn.route.startsWith(opts.route)).sort((a, b) => b.bytes - a.bytes)
  const sizes = rows.map((r) => r.bytes).sort((a, b) => a - b)
  console.log(`${rows.length} functions (${opts.vercel ? '.vercel/output' : 'one per route, from .nft.json traces'}), budget ${opts.maxMb} MB`)
  console.log(`largest ${mb(sizes[sizes.length - 1] ?? 0)} MB, median ${mb(sizes[Math.floor(sizes.length / 2)] ?? 0)} MB, smallest ${mb(sizes[0] ?? 0)} MB\n`)
  for (const r of rows.slice(0, opts.top)) console.log(`${mb(r.bytes).padStart(7)} MB  ${r.files.size.toString().padStart(6)} files  ${r.name}`)

  const largest = rows[0]
  if (largest) {
    const byBucket = new Map<string, number>()
    for (const f of largest.files) byBucket.set(bucket(opts.dir, f), (byBucket.get(bucket(opts.dir, f)) ?? 0) + fileSize(f))
    console.log(`\nTop contributors to ${largest.name}:`)
    for (const [key, bytes] of [...byBucket.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.top)) console.log(`${mb(bytes).padStart(7)} MB  ${key}`)
  }

  const over = rows.filter((r) => r.bytes > opts.maxMb * MIB)
  if (over.length > 0) failures.push(`${over.length} function(s) over the ${opts.maxMb} MB budget: ${over.map((r) => `${r.name} (${mb(r.bytes)} MB)`).join(', ')}`)

  if (!opts.vercel && !opts.route) {
    const envLambda = Number(process.env.MAX_UNCOMPRESSED_LAMBDA_SIZE)
    const lambdaBytes = Number.isFinite(envLambda) && envLambda > 0 ? envLambda : 250 * MIB
    const groups = estimateVercelGroups(fns, shared, lambdaBytes)
    console.log(`\nEstimated Vercel functions with MAX_UNCOMPRESSED_LAMBDA_SIZE=${lambdaBytes} (${mb(lambdaBytes)} MiB): ${groups.length}, largest ${mb(groups[0]?.bytes ?? 0)} MB`)
    console.log('(the builder\'s own sizing: the functions `vercel build` writes come out 10-35 MB larger; measure them with --vercel)')
    for (const g of groups.slice(0, Math.min(opts.top, 5))) console.log(`${mb(g.bytes).padStart(7)} MB  ${String(g.routes).padStart(4)} routes`)
  }

  // Vercel functions are named after one of their routes, so the per-route
  // check runs on the .nft.json traces (the same build's files).
  if (!opts.vercel && !opts.route) {
    const missing = missingRequiredFiles(opts.dir, fns)
    console.log(`\nRequired runtime files: ${missing.length === 0 ? 'all present' : `${missing.length} missing`}`)
    if (missing.length > 0) failures.push(`missing runtime files:\n  ${missing.slice(0, 40).join('\n  ')}${missing.length > 40 ? `\n  …and ${missing.length - 40} more` : ''}`)
  }

  if (opts.parse && !opts.route) {
    console.log('')
    if (!serverChunksCompile(opts.dir)) failures.push('server chunks Node cannot load (see above)')
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`\nFAIL ${failure}`)
    process.exit(1)
  }
}

main()
