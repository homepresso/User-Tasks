/**
 * Local side of config-as-code: reading and writing a config folder (the
 * GitHub-sync layout: `manifest.json` + `<section-dir>/<slug>-<shortid>.json`,
 * plus `workspace-theme.json`),
 * YAML ⇄ JSON conversion, id generation for hand-written files and
 * `${env:VAR}` / `${file:path}` substitution. Substitution happens here, on
 * the client, right before upload — secrets never come back from the server
 * and are never written into the files.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import YAML from 'yaml'
import { CliUsageError } from './exit-codes'

export type ConfigFormat = 'json' | 'yaml'

/** Manifest sections, their folder and the names `config new` accepts. */
export const CONFIG_SECTIONS: ReadonlyArray<{ section: string; dir: string; aliases: string[] }> = [
  { section: 'workflows', dir: 'workflows', aliases: ['workflow'] },
  { section: 'decision_tables', dir: 'decision-tables', aliases: ['decision-table', 'decision_table', 'rule', 'rules'] },
  { section: 'workflow_activities', dir: 'workflow-activities', aliases: ['workflow-activity', 'workflow_activity', 'activity', 'activities'] },
  { section: 'data_tables', dir: 'data-tables', aliases: ['data-table', 'data_table', 'table', 'tables'] },
  { section: 'integrations', dir: 'integrations', aliases: ['integration'] },
  { section: 'references', dir: 'references', aliases: ['reference'] },
  { section: 'objects', dir: 'objects', aliases: ['object'] },
  { section: 'agents', dir: 'agents', aliases: ['agent'] },
  { section: 'reports', dir: 'reports', aliases: ['report'] },
  { section: 'retention_policies', dir: 'retention-policies', aliases: ['retention-policy', 'retention_policy'] },
  { section: 'roles', dir: 'roles', aliases: ['role'] },
  { section: 'mcp_servers', dir: 'mcp-servers', aliases: ['mcp-server', 'mcp_server'] },
  { section: 'email_templates', dir: 'email-templates', aliases: ['email-template', 'email_template', 'template'] },
  { section: 'connectors', dir: 'connectors', aliases: ['connector'] },
  { section: 'log_destinations', dir: 'log-destinations', aliases: ['log-destination', 'log_destination', 'destination'] },
  { section: 'form_themes', dir: 'form-themes', aliases: ['form-theme', 'form_theme'] },
  { section: 'forms', dir: 'forms', aliases: ['form'] },
  // Data-table rows (`config export --include-rows`); one file per table.
  { section: 'table_rows', dir: 'data-rows', aliases: ['table-rows', 'table_rows', 'rows'] },
]

const SECTION_DIRS = new Set(CONFIG_SECTIONS.map((s) => s.dir))
/** Singleton files at the folder root (one object per workspace, no id). */
const SINGLETON_FILES = /^workspace-theme\.(json|ya?ml)$/
const SINGLETON_TYPES = new Set(['workspace_theme'])
const CONFIG_EXT = new Set(['.json', '.yaml', '.yml'])

export interface UploadFile {
  path: string
  content: string
}

// ─── Naming (mirrors lib/github-sync/layout.ts) ─────────────────────────────

export function assetSlug(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled'
}

export function assetShortId(id: string): string {
  return String(id).replace(/-/g, '').slice(0, 8)
}

/** `foo.json` ⇄ `foo.yaml` */
export function withFormat(path: string, format: ConfigFormat): string {
  const ext = extname(path)
  const stem = CONFIG_EXT.has(ext) ? path.slice(0, -ext.length) : path
  return `${stem}.${format}`
}

const toPosix = (path: string) => path.split(sep).join('/')

// ─── Substitution ───────────────────────────────────────────────────────────

const PLACEHOLDER = /\$\{(env|file):([^}]*)\}/g

export interface SubstitutionContext {
  env: NodeJS.ProcessEnv
  /** Directory `${file:…}` paths are relative to. */
  baseDir: string
  readText?: (path: string) => string
}

/**
 * Replace `${env:VAR}` with the environment variable and `${file:path}` with
 * the file's text (one trailing newline removed), in every string at any
 * depth. Unresolvable placeholders are collected in `unresolved` and left as
 * they are.
 */
export function substitute<T>(value: T, ctx: SubstitutionContext, unresolved: string[] = []): T {
  const readText = ctx.readText ?? ((path: string) => readFileSync(path, 'utf8'))
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return node.replace(PLACEHOLDER, (match, kind: string, rawRef: string) => {
        const ref = rawRef.trim()
        if (!ref) { unresolved.push(match); return match }
        if (kind === 'env') {
          const envValue = ctx.env[ref]
          if (envValue === undefined) { unresolved.push(match); return match }
          return envValue
        }
        try {
          return readText(isAbsolute(ref) ? ref : join(ctx.baseDir, ref)).replace(/\r?\n$/, '')
        } catch {
          unresolved.push(match)
          return match
        }
      })
    }
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]))
    }
    return node
  }
  return walk(value) as T
}

// ─── Reading a config folder for upload ─────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (CONFIG_EXT.has(extname(name).toLowerCase())) out.push(full)
  }
  return out
}

function parseFile(text: string, file: string): unknown {
  try {
    return extname(file).toLowerCase() === '.json' ? JSON.parse(text) : YAML.parse(text)
  } catch (error) {
    throw new CliUsageError(`${file}: not valid ${extname(file).slice(1).toUpperCase()}: ${(error as Error).message}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export interface PreparedUpload {
  files: UploadFile[]
  /** Files that got a generated id written back. */
  assignedIds: Array<{ file: string; id: string }>
}

/**
 * Read a config folder (or one file) and produce the upload: YAML converted
 * to JSON (paths renamed to `.json`), ids generated and written back for
 * envelopes without one, then placeholders substituted. Throws a usage error
 * (exit 2) listing every unresolved placeholder.
 */
export function prepareUpload(target: string, env: NodeJS.ProcessEnv, options: { idFactory?: () => string } = {}): PreparedUpload {
  const idFactory = options.idFactory ?? randomUUID
  if (!existsSync(target)) throw new CliUsageError(`${target} does not exist`)
  const isDir = statSync(target).isDirectory()
  const paths = isDir ? walk(target) : [target]
  if (paths.length === 0) throw new CliUsageError(`${target} contains no .json or .yaml files`)

  const files: UploadFile[] = []
  const assignedIds: PreparedUpload['assignedIds'] = []
  const unresolved: string[] = []
  for (const file of paths) {
    const text = readFileSync(file, 'utf8')
    let parsed = parseFile(text, file)
    const rel = toPosix(isDir ? relative(target, file) : basename(file))

    if (isRecord(parsed) && 'asset_type' in parsed && isRecord(parsed.asset) && !parsed.id && !parsed.asset.id && !SINGLETON_TYPES.has(String(parsed.asset_type))) {
      const id = idFactory()
      parsed = { ...parsed, id, asset: { ...parsed.asset, id } }
      writeBackId(file, text, id)
      assignedIds.push({ file, id })
    }

    const missing: string[] = []
    const resolved = substitute(parsed, { env, baseDir: dirname(file) }, missing)
    for (const ref of missing) unresolved.push(`${file}: ${ref}`)
    files.push({ path: withFormat(rel, 'json'), content: `${JSON.stringify(resolved, null, 2)}\n` })
  }
  if (unresolved.length) {
    throw new CliUsageError(`Unresolved placeholders (set the variables / create the files, nothing was uploaded):\n  ${[...new Set(unresolved)].join('\n  ')}`)
  }
  return { files, assignedIds }
}

/** Add `id` to the envelope and its asset, keeping YAML comments and layout. */
function writeBackId(file: string, text: string, id: string) {
  if (extname(file).toLowerCase() === '.json') {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const asset = parsed.asset as Record<string, unknown>
    // Keep key order readable: id right after asset_type / at the top of asset.
    const envelope: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed)) {
      envelope[key] = key === 'asset' ? { id, ...asset } : value
      if (key === 'asset_type') envelope.id = id
    }
    if (!('id' in envelope)) envelope.id = id
    writeFileSync(file, `${JSON.stringify(envelope, null, 2)}\n`)
    return
  }
  const doc = YAML.parseDocument(text)
  doc.set('id', id)
  doc.setIn(['asset', 'id'], id)
  writeFileSync(file, doc.toString())
}

// ─── Writing an export ──────────────────────────────────────────────────────

/** Resolve a server-provided relative path inside `dir`, refusing anything that escapes it. */
export function safeJoin(dir: string, path: string): string {
  const root = resolve(dir)
  const full = resolve(root, path)
  if (isAbsolute(path) || (full !== root && !full.startsWith(root + sep))) throw new Error(`Refusing to write outside ${dir}: ${path}`)
  return full
}

/** Paths (relative) of managed files already in `dir`: manifest + section folders. */
function managedFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (/^manifest\.(json|ya?ml)$/.test(name) || SINGLETON_FILES.test(name)) out.push(name)
    else if (SECTION_DIRS.has(name) && statSync(full).isDirectory()) {
      for (const child of readdirSync(full)) if (CONFIG_EXT.has(extname(child).toLowerCase())) out.push(`${name}/${child}`)
    }
  }
  return out
}

export function isNonEmptyDir(dir: string): boolean {
  return existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).length > 0)
}

/**
 * Write exported files into `dir` (converted to YAML when asked). With
 * `replace`, managed files from an earlier export that are not part of this
 * one are removed (renamed/deleted assets), so the folder mirrors the export.
 */
export function writeExport(dir: string, files: UploadFile[], format: ConfigFormat, replace: boolean): { written: string[]; removed: string[] } {
  const written: string[] = []
  for (const file of files) {
    const rel = format === 'yaml' ? withFormat(file.path, 'yaml') : file.path
    const full = safeJoin(dir, rel)
    const content = format === 'yaml' ? YAML.stringify(JSON.parse(file.content), { lineWidth: 0 }) : file.content
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
    written.push(toPosix(rel))
  }
  const removed: string[] = []
  if (replace) {
    const keep = new Set(written)
    for (const rel of managedFiles(dir)) {
      if (keep.has(toPosix(rel))) continue
      rmSync(join(dir, rel))
      removed.push(toPosix(rel))
    }
  }
  return { written, removed }
}

// ─── Scaffolding (`config new`) ─────────────────────────────────────────────

export function resolveSection(type: string) {
  const key = type.trim().toLowerCase()
  const found = CONFIG_SECTIONS.find((s) => s.section === key || s.dir === key || s.aliases.includes(key))
  if (!found) throw new CliUsageError(`Unknown type "${type}" (expected one of ${CONFIG_SECTIONS.filter((s) => s.section !== 'objects' && s.section !== 'table_rows').map((s) => s.aliases[0]).join(', ')})`)
  if (found.section === 'objects') throw new CliUsageError('Composite objects cannot be scaffolded; create one with `usertasks objects create` and export it')
  if (found.section === 'table_rows') throw new CliUsageError('Table rows cannot be scaffolded; export them with `usertasks config export --include-rows`')
  return found
}

function scaffoldAsset(section: string, name: string, idFactory: () => string): Record<string, unknown> {
  switch (section) {
    case 'workflows':
      // A trigger node is required; the server would otherwise add one with a new id on every apply.
      return {
        name, description: null, trigger_type: 'manual', trigger_config: {},
        nodes: [{ id: idFactory(), type: 'manual', label: 'Manual Trigger', position: { x: 300, y: 20 }, config: {} }],
        edges: [], user_variables: [], swimlanes: [], is_active: false,
      }
    case 'decision_tables':
      return { name, description: null, inputs: [], outputs: [], rules: [] }
    case 'workflow_activities':
      return {
        name, description: null, key: assetSlug(name).replace(/-/g, '_'), status: 'draft', source_kind: 'inline', version: '1.0.0',
        source_code: 'async function run(inputs) {\n  return { outputs: { result: inputs.value } }\n}\n',
        manifest: { inputs: [{ name: 'value', type: 'string', required: true }], outputs: [{ name: 'result', type: 'string' }] },
        demo_inputs: {}, tags: [],
      }
    case 'data_tables':
      return { name, description: null, columns: [{ key: 'name', name: 'Name', type: 'text' }] }
    case 'integrations':
      return { name, type: 'rest_api', config: { base_url: 'https://api.example.com', auth_type: 'bearer', auth_config: { token: '${env:API_TOKEN}' } }, is_active: true, tags: null }
    case 'references':
      return { name, description: null, integration_id: '<integration id>', tags: null, request_config: { method: 'GET', path: '/' }, inputs: [], outputs: [] }
    case 'agents':
      return { name, description: null, model: 'gpt-4o', system_prompt: '', role: '', task: '', boundaries: '', tools: [], integration_id: null, output_config: { variables: [] }, is_active: true }
    case 'reports':
      return { name, description: null, category: null, config: {}, is_shared: false }
    case 'retention_policies':
      return { name, description: null, policy_mode: 'review', duration_value: 365, duration_unit: 'days', exact_date: null, applies_to: ['data_tables', 'data_rows', 'roles'] }
    case 'roles':
      return { name, slug: assetSlug(name).replace(/-/g, '_'), description: null, permissions: [], retention_policy_id: null }
    case 'mcp_servers':
      return { name, url: 'https://mcp.example.com/mcp', auth_type: 'bearer', auth_config: { token: '${env:MCP_TOKEN}' }, is_active: true }
    case 'email_templates':
      return { name, description: null, subject: 'Action needed: {{task.title}}', html_body: '<p>Hello,</p>\n<p>{{task.title}}</p>\n', text_body: '', is_default: false }
    case 'connectors':
      // Credentials come from the environment at apply time; without them the connector is created disabled.
      return { name, connector_key: 'slack', config: { default_channel: '#general' }, credentials: { bot_token: '${env:SLACK_BOT_TOKEN}' }, is_enabled: true }
    case 'log_destinations':
      // The token comes from the environment at apply time; without it the destination is created disabled.
      return { name, type: 'splunk_hec', config: { url: 'https://splunk.example.com:8088', index: 'usertasks', verify_tls: true }, credentials: { token: '${env:SPLUNK_HEC_TOKEN}' }, filters: { categories: ['workflow', 'integration', 'agent', 'task', 'system'] }, enabled: true }
    case 'form_themes':
      // Overrides on top of the workspace theme; forms reference it as { source: 'saved', theme_id: <this id> }.
      return { name, description: null, overrides: { colors: { light: { accent: '#2563eb' } }, radius: 8, density: 'comfortable', label_position: 'top' } }
    case 'forms':
      // User Task nodes link it with config.form_id = <this id>.
      return {
        name, description: null, tags: [],
        fields: [
          { key: 'decision', label: 'Decision', type: 'choice', required: true, options: ['Approve', 'Reject'] },
          { key: 'comments', label: 'Comments', type: 'textarea' },
        ],
        layout: null, theme: { source: 'workspace' },
      }
    default:
      return { name }
  }
}

/** Write a new asset envelope with a generated id; returns the file path. */
export function scaffold(dir: string, type: string, name: string, format: ConfigFormat, idFactory: () => string = randomUUID): { file: string; id: string; section: string } {
  const { section, dir: sectionDir } = resolveSection(type)
  const id = idFactory()
  const envelope = { format_version: 3, asset_type: section, id, asset: { id, ...scaffoldAsset(section, name, idFactory) } }
  const file = join(dir, sectionDir, `${assetSlug(name)}-${assetShortId(id)}.${format}`)
  if (existsSync(file)) throw new CliUsageError(`${file} already exists`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, format === 'yaml' ? YAML.stringify(envelope, { lineWidth: 0 }) : `${JSON.stringify(envelope, null, 2)}\n`)
  return { file, id, section }
}
