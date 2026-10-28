/**
 * Size suite: production build output, node_modules and (optionally) the
 * Docker image, measured in an app directory (run it in a clone, not the
 * working tree you develop in).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { SuiteResult } from '../lib/results'

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...files(path))
    else if (entry.isFile()) out.push(path)
  }
  return out
}

/** `du -sk` in bytes (follows the on-disk size, like the audit numbers). */
function du(path: string): number | null {
  if (!existsSync(path)) return null
  try {
    return Number(execFileSync('du', ['-sk', path], { encoding: 'utf8' }).split('\t')[0]) * 1024
  } catch {
    return null
  }
}

/** Recognisable libraries in a hashed chunk (substring markers). */
const MARKERS: Array<[string, string]> = [
  ['SheetJS', 'xlsx'], ['recharts', 'recharts'], ['ZodError', 'zod'], ['@dnd-kit', 'dnd-kit'], ['cmdk', 'cmdk'],
  ['__reactInternal', 'react-dom'], ['GoTrueClient', 'supabase-js'], ['QueryClient', 'react-query'], ['lucide', 'lucide'],
]

function libraries(source: string): string {
  return MARKERS.filter(([marker]) => source.includes(marker)).map(([, name]) => name).join(', ')
}

/** Routes whose first-load JS is reported (app dir segment paths). */
const ROUTES: Array<[string, string]> = [
  ['/automations/[id]', '(dashboard)/automations/[id]'],
  ['/automations/runs/[id]', '(dashboard)/automations/runs/[id]'],
  ['/reports', '(dashboard)/reports'],
  ['/reports/workflows', '(dashboard)/reports/workflows'],
  ['/reports/workflows/[id]', '(dashboard)/reports/workflows/[id]'],
  ['/reports/[id]', '(dashboard)/reports/[id]'],
  ['/reports/builder', '(dashboard)/reports/builder'],
  ['/settings/api-keys', '(dashboard)/settings/api-keys'],
  ['/docs/api-explorer', 'docs/api-explorer'],
  ['/tasks', '(dashboard)/tasks'],
]

/**
 * First-load JS of a route: the root main files plus every entry chunk the
 * route's client reference manifest lists (layouts, loading UI and the page).
 * Chunks loaded later by next/dynamic or import() are not counted.
 */
function routeFirstLoad(appDir: string, segment: string): { bytes: number; gzip: number; chunks: number } | null {
  const next = join(appDir, '.next')
  const manifestPath = join(next, 'server', 'app', segment, 'page_client-reference-manifest.js')
  if (!existsSync(manifestPath)) return null
  const sandbox: { __RSC_MANIFEST?: Record<string, { entryJSFiles?: Record<string, string[]> }> } = {}
  new Function('globalThis', readFileSync(manifestPath, 'utf8'))(sandbox)
  const manifest = Object.values(sandbox.__RSC_MANIFEST ?? {})[0]
  const build = JSON.parse(readFileSync(join(next, 'build-manifest.json'), 'utf8')) as { rootMainFiles?: string[] }
  const set = new Set<string>(build.rootMainFiles ?? [])
  for (const list of Object.values(manifest?.entryJSFiles ?? {})) for (const file of list) set.add(file.replace(/^\/?_next\//, ''))
  let bytes = 0
  let gzip = 0
  for (const file of set) {
    const path = join(next, file)
    if (!existsSync(path)) continue
    const source = readFileSync(path)
    bytes += source.length
    gzip += gzipSync(source).length
  }
  return { bytes, gzip, chunks: set.size }
}

const mb = (bytes: number | null) => (bytes === null ? null : Math.round((bytes / 2 ** 20) * 10) / 10)
const kb = (bytes: number) => Math.round(bytes / 1024)

export async function runSize(opts: { appDir: string; build: boolean; docker: boolean; env: Record<string, string> }): Promise<SuiteResult> {
  const data: Record<string, unknown> = {}
  const notes: string[] = []

  if (opts.build) {
    process.stdout.write('  size: next build … ')
    const started = Date.now()
    const res = spawnSync('npm', ['run', 'build'], { cwd: opts.appDir, env: { ...process.env, ...opts.env, NEXT_TELEMETRY_DISABLED: '1' }, encoding: 'utf8', maxBuffer: 64 * 2 ** 20 })
    if (res.status !== 0) throw new Error(`next build failed:\n${(res.stdout ?? '').slice(-3000)}\n${(res.stderr ?? '').slice(-3000)}`)
    data.build_seconds = Math.round((Date.now() - started) / 100) / 10
    console.log(`${data.build_seconds} s`)
  }

  const chunksDir = join(opts.appDir, '.next', 'static', 'chunks')
  if (!existsSync(chunksDir)) throw new Error(`${chunksDir} not found — build first (--build)`)
  const chunks = files(chunksDir).filter((f) => f.endsWith('.js')).map((f) => {
    const source = readFileSync(f)
    return { file: relative(chunksDir, f), bytes: source.length, gzip: gzipSync(source).length, libraries: libraries(source.toString('utf8')) }
  })
  chunks.sort((a, b) => b.bytes - a.bytes)
  const total = chunks.reduce((s, c) => s + c.bytes, 0)
  const totalGzip = chunks.reduce((s, c) => s + c.gzip, 0)
  const css = files(join(opts.appDir, '.next', 'static')).filter((f) => f.endsWith('.css')).reduce((s, f) => s + statSync(f).size, 0)

  const routes = ROUTES.map(([route, segment]) => ({ route, ...(routeFirstLoad(opts.appDir, segment) ?? { bytes: null, gzip: null, chunks: null }) }))

  const serverBytes = du(join(opts.appDir, '.next', 'server'))
  const standaloneBytes = du(join(opts.appDir, '.next', 'standalone'))
  const nodeModulesBytes = du(join(opts.appDir, 'node_modules'))
  Object.assign(data, {
    client_chunks: { count: chunks.length, bytes: total, gzip_bytes: totalGzip, largest: chunks.slice(0, 10) },
    client_css_bytes: css,
    route_first_load_js: routes,
    server_output_bytes: serverBytes,
    standalone_bytes: standaloneBytes,
    node_modules_bytes: nodeModulesBytes,
  })

  let imageBytes: number | null = null
  if (opts.docker) {
    process.stdout.write('  size: docker build … ')
    const started = Date.now()
    const tag = 'usertasks-bench:size'
    const buildArgs = Object.entries(opts.env).filter(([k]) => k.startsWith('NEXT_PUBLIC_')).flatMap(([k, v]) => ['--build-arg', `${k}=${v}`])
    const res = spawnSync('docker', ['build', '-q', '-t', tag, ...buildArgs, '.'], { cwd: opts.appDir, encoding: 'utf8', maxBuffer: 64 * 2 ** 20 })
    if (res.status === 0) {
      imageBytes = Number(execFileSync('docker', ['image', 'inspect', '--format', '{{.Size}}', tag], { encoding: 'utf8' }).trim())
      data.docker_build_seconds = Math.round((Date.now() - started) / 100) / 10
      console.log(`${data.docker_build_seconds} s`)
    } else {
      console.log('failed')
      notes.push(`docker build failed: ${(res.stderr ?? '').trim().split('\n').slice(-3).join(' / ')}`)
    }
  } else {
    notes.push('Docker image not built (pass --docker).')
  }
  data.docker_image_bytes = imageBytes

  return {
    data,
    tables: [
      {
        title: 'Build & install size',
        columns: ['measure', 'value'],
        rows: [
          ['client JS chunks (count)', chunks.length],
          ['client JS total MB (gzip MB)', `${mb(total)} (${mb(totalGzip)})`],
          ['client CSS KB', kb(css)],
          ['.next/server MB', mb(serverBytes)],
          ['.next/standalone MB', mb(standaloneBytes)],
          ['node_modules MB', mb(nodeModulesBytes)],
          ['Docker image MB', mb(imageBytes)],
          ...(data.build_seconds ? [['next build s', data.build_seconds as number]] : []),
        ],
      },
      {
        title: 'Largest client chunks',
        columns: ['chunk', 'KB', 'gzip KB', 'contains'],
        rows: chunks.slice(0, 10).map((c) => [c.file, kb(c.bytes), kb(c.gzip), c.libraries || null]),
      },
      {
        title: 'First-load JS per route (root + route entry chunks; lazy chunks excluded)',
        columns: ['route', 'KB', 'gzip KB', 'chunks'],
        rows: routes.map((r) => [r.route, r.bytes === null ? null : kb(r.bytes), r.gzip === null ? null : kb(r.gzip), r.chunks]),
      },
    ],
    notes,
  }
}
