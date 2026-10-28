/**
 * Result files: scripts/bench/results/<label>.json (machine-readable, merged
 * per suite so suites can be re-run on their own) and <label>.md (rendered
 * from the stored tables).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem, platform, release, arch } from 'node:os'
import { join } from 'node:path'
import { benchEnv, RESULTS_DIR, ROOT } from './env'

export interface MdTable {
  title: string
  columns: string[]
  rows: Array<Array<string | number | null>>
}

export interface SuiteResult {
  /** Raw numbers for later comparison. */
  data: unknown
  /** What the markdown summary shows. */
  tables: MdTable[]
  notes?: string[]
}

export interface ResultFile {
  label: string
  updatedAt: string
  environment: Record<string, string | number>
  suites: Record<string, SuiteResult & { ranAt: string; durationMs: number }>
}

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

export function environmentInfo(): Record<string, string | number> {
  return {
    machine: platform() === 'darwin' ? sh('sysctl', ['-n', 'machdep.cpu.brand_string']) : cpus()[0]?.model ?? 'unknown',
    cpus: cpus().length,
    memory_gb: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()} ${arch()}`,
    node: process.version,
    git_commit: sh('git', ['rev-parse', '--short', 'HEAD']),
    git_branch: sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    supabase_cli: sh('npx', ['supabase', '--version']),
    postgres_server: sh('psql', [benchEnv().dbUrl, '-Atc', 'SHOW server_version']),
    docker: sh('docker', ['version', '--format', '{{.Server.Version}}']),
  }
}

const jsonPath = (label: string) => join(RESULTS_DIR, `${label}.json`)

export function loadResults(label: string): ResultFile {
  if (existsSync(jsonPath(label))) return JSON.parse(readFileSync(jsonPath(label), 'utf8')) as ResultFile
  return { label, updatedAt: new Date().toISOString(), environment: {}, suites: {} }
}

export function saveSuite(label: string, name: string, result: SuiteResult, durationMs: number): ResultFile {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const file = loadResults(label)
  file.updatedAt = new Date().toISOString()
  file.environment = environmentInfo()
  file.suites[name] = { ...result, ranAt: new Date().toISOString(), durationMs: Math.round(durationMs) }
  writeFileSync(jsonPath(label), JSON.stringify(file, null, 2) + '\n')
  writeFileSync(join(RESULTS_DIR, `${label}.md`), renderMarkdown(file))
  return file
}

const SUITE_ORDER = ['engine', 'probes', 'queue', 'api', 'db', 'size']

export function renderMarkdown(file: ResultFile): string {
  const out: string[] = [`# Bench results: ${file.label}`, '', `Updated ${file.updatedAt}.`, '']
  out.push('| Environment | |', '|---|---|')
  for (const [k, v] of Object.entries(file.environment)) out.push(`| ${k} | ${String(v).replace(/\|/g, '\\|')} |`)
  out.push('')
  const names = Object.keys(file.suites).sort((a, b) => (SUITE_ORDER.indexOf(a) + 99) % 99 - (SUITE_ORDER.indexOf(b) + 99) % 99)
  for (const name of names) {
    const suite = file.suites[name]
    out.push(`## ${name}`, '', `_ran ${suite.ranAt} in ${(suite.durationMs / 1000).toFixed(1)} s_`, '')
    for (const table of suite.tables) out.push(...renderTable(table), '')
    if (suite.notes?.length) out.push(...suite.notes.map((n) => `- ${n}`), '')
  }
  return out.join('\n')
}

export function renderTable(table: MdTable): string[] {
  const cell = (v: string | number | null) => (v === null || v === undefined ? '—' : String(v).replace(/\|/g, '\\|'))
  return [
    `**${table.title}**`,
    '',
    `| ${table.columns.join(' | ')} |`,
    `|${table.columns.map(() => '---').join('|')}|`,
    ...table.rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ]
}

/** p50/p95/max/mean over a sample (ms). */
export function summarize(samples: number[]): { n: number; p50: number; p95: number; max: number; mean: number } {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : 0)
  const round = (n: number) => Math.round(n * 10) / 10
  const mean = sorted.length ? sorted.reduce((s, x) => s + x, 0) / sorted.length : 0
  return { n: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1] ?? 0), mean: round(mean) }
}

export const median = (xs: number[]): number => summarize(xs).p50
