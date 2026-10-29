/**
 * Reference sections derived from the code at build time, so the docs cannot
 * drift from what the server, the MCP server and the CLI actually do. Each
 * generator returns DocBlocks; pages pull them in with `::<name>` directives
 * (see GENERATED_DIRECTIVES). __tests__/docs-reference.test.ts checks that
 * every node, function, permission, scope, MCP tool and CLI command appears.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { NODE_CATALOG, type NodeType } from '@/lib/workflow-schema'
import { validateNode } from '@/lib/workflow-validation'
import { getNodeConfigSummary } from '@/lib/workflow-utils'
import { FUNCTION_CATALOG, FUNCTION_CATEGORIES } from '@/lib/expression-functions'
import { PERMISSION_GROUPS } from '@/lib/permissions'
import { SYSTEM_ROLES } from '@/lib/tenant-provisioning'
import { OAUTH_SCOPES, SCOPE_DESCRIPTIONS, FIRST_PARTY_ONLY_SCOPES, expandScopes } from '@/lib/oauth/scopes'
import { createMcpServer } from '@/lib/mcp/server'
import { requiredToolPermission } from '@/lib/mcp/authz'
import { CONNECTOR_CATALOG, CONNECTOR_CATEGORIES } from '@/lib/connectors/registry'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { renderParityMarkdown } from '@/lib/surface-parity'
import { REPORT_SOURCES } from '@/lib/report-sources'
import { BUILTIN_TOOL_DEFS } from '@/lib/agent-tool-defs'
import { COMMAND_SPECS } from '@/packages/cli/src/generated/commands'
import type { CommandSpec } from '@/packages/cli/src/spec'
import { NODE_DOCS } from './node-docs'
import { CLI_EXIT_CODES, CLI_GLOBAL_OPTIONS, CLI_HANDWRITTEN_COMMANDS } from './cli-commands'
import { parseMarkdown, slugify, type DocBlock } from './markdown'

const code = (value: string) => `\`${value.replace(/`/g, "'")}\``

const CATEGORY_TITLES: Record<string, { title: string; intro: string }> = {
  trigger: { title: 'Triggers', intro: 'Every workflow has one trigger. It decides when a run starts and which variables the run begins with. Workflows can also be started from the API, MCP or CLI (`workflows start`) whatever their trigger.' },
  logic: { title: 'Logic and flow', intro: 'Branching, loops, waits, jumps and parallel paths.' },
  operation: { title: 'Data, files and documents', intro: 'Transform values, JSON, dates, text, files and Office documents inside the run.' },
  collection: { title: 'Collections', intro: 'Count, pick, filter, sort, deduplicate and join lists.' },
  action: { title: 'Actions', intro: 'Call systems, update tasks and data, notify people, run rules, agents and other workflows, and wait for people.' },
  section: { title: 'Canvas tools', intro: 'Organise the canvas or bind live data.' },
}

/* ── Workflow nodes ── */

export function nodeReferenceBlocks(): DocBlock[] {
  const blocks: DocBlock[] = []
  const order = ['trigger', 'logic', 'action', 'operation', 'collection', 'section']
  for (const category of order) {
    const nodes = NODE_CATALOG.filter((node) => node.category === category)
    if (nodes.length === 0) continue
    const copy = CATEGORY_TITLES[category]
    blocks.push({ kind: 'heading', level: 2, text: copy.title, id: `category-${category}` })
    blocks.push({ kind: 'paragraph', text: copy.intro })
    blocks.push({
      kind: 'table',
      head: ['Node', 'Type', 'What it does'],
      rows: nodes.map((node) => [`[${node.label}](#node-${node.type.replace(/_/g, '-')})`, code(node.type), node.description]),
    })
    for (const node of nodes) {
      const doc = NODE_DOCS[node.type as NodeType]
      blocks.push({ kind: 'heading', level: 3, text: node.label, id: `node-${node.type.replace(/_/g, '-')}` })
      blocks.push({ kind: 'paragraph', text: `${code(node.type)} · ${node.description}.` })
      const required = validateNode({ id: 'docs', type: node.type as NodeType, label: node.label, position: { x: 0, y: 0 }, config: {} })
      const rows: string[][] = [['Settings', doc.settings]]
      if (required.length > 0) rows.push(['Validation', required.join('; ')])
      if (doc.outputs) rows.push(['Sets', doc.outputs])
      blocks.push({ kind: 'table', head: ['', ''], rows })
      if (doc.example) {
        const summary = getNodeConfigSummary({ type: node.type, config: doc.example })
        blocks.push({
          kind: 'code',
          lang: 'json',
          title: summary ? `config — shown on the canvas as “${summary}”` : 'config',
          code: JSON.stringify(doc.example, null, 2),
        })
      }
    }
  }
  return blocks
}

/* ── Expression functions ── */

export function functionReferenceBlocks(): DocBlock[] {
  const blocks: DocBlock[] = []
  for (const category of FUNCTION_CATEGORIES) {
    const functions = FUNCTION_CATALOG.filter((fn) => fn.category === category.id)
    if (functions.length === 0) continue
    blocks.push({ kind: 'heading', level: 2, text: `${category.label} functions`, id: `functions-${category.id}` })
    blocks.push({
      kind: 'table',
      head: ['Function', 'Returns', 'Description', 'Example'],
      rows: functions.map((fn) => [
        code(`${fn.name}(${fn.args.map((arg) => (arg.optional ? `[${arg.name}]` : arg.name)).join(', ')})`),
        fn.returnType,
        fn.description,
        code(fn.example),
      ]),
    })
  }
  return blocks
}

/* ── Permissions, roles and scopes ── */

/** OAuth scopes (excluding admin and the first-party scope) whose expansion includes the permission. */
function scopesGranting(permission: string): string[] {
  return OAUTH_SCOPES.filter((scope) => scope !== 'admin' && scope !== 'mcp' && expandScopes([scope]).includes(permission))
}

export function permissionReferenceBlocks(): DocBlock[] {
  const blocks: DocBlock[] = []
  blocks.push({
    kind: 'table',
    head: ['System role', 'Description', 'Permissions'],
    rows: SYSTEM_ROLES.map((role) => [role.name, role.description, `${role.permissions.length}`]),
  })
  for (const group of PERMISSION_GROUPS) {
    blocks.push({ kind: 'heading', level: 3, text: group.label, id: `permissions-${group.key}` })
    blocks.push({
      kind: 'table',
      head: ['Permission', 'Allows', ...SYSTEM_ROLES.map((role) => role.name), 'OAuth scopes'],
      rows: group.permissions.map((permission) => [
        code(permission.key),
        permission.description,
        ...SYSTEM_ROLES.map((role) => ((role.permissions as string[]).includes(permission.key) ? '✓' : '')),
        scopesGranting(permission.key).map(code).join(' '),
      ]),
    })
  }
  return blocks
}

export function scopeReferenceBlocks(): DocBlock[] {
  return [{
    kind: 'table',
    head: ['Scope', 'Grants', 'Expands to'],
    rows: OAUTH_SCOPES.map((scope) => [
      code(scope) + (FIRST_PARTY_ONLY_SCOPES.includes(scope) ? ' (first-party CLI only)' : ''),
      SCOPE_DESCRIPTIONS[scope] ?? '',
      scope === 'admin' ? 'every permission' : scope === 'mcp' ? 'access to /api/mcp (tools still need their permissions)' : expandScopes([scope]).map(code).join(' '),
    ]),
  }]
}

/* ── MCP tools ── */

export interface McpToolDoc {
  name: string
  description: string
  category: string
  permission: string | null
}

export function listMcpTools(): McpToolDoc[] {
  const server = createMcpServer({ tenantId: 'docs', supabase: {}, actingUserId: 'docs', keyType: 'tenant', scopes: { workflow_ids: [], table_ids: [] } })
  return server.getRegisteredTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    category: tool.category,
    permission: requiredToolPermission(tool.name) ?? null,
  }))
}

const MCP_CATEGORY_LABELS: Record<string, string> = {
  tasks: 'Tasks', workflows: 'Workflows', agents: 'AI agents', data: 'Data tables', reports: 'Reports',
  integrations: 'Integrations', governance: 'Governance', api_keys: 'API keys', observability: 'Observability',
  decision_tables: 'Decision tables', extensibility: 'Custom workflow steps', email_templates: 'Email templates',
  retention: 'Retention', webhooks: 'Webhooks', log_destinations: 'Log destinations', workspace_theme: 'Workspace theme',
}

function firstSentence(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const end = flat.search(/(?<=[.!?])\s/)
  const sentence = end > 0 ? flat.slice(0, end) : flat
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence
}

export function mcpToolReferenceBlocks(): DocBlock[] {
  const tools = listMcpTools()
  const blocks: DocBlock[] = [{ kind: 'paragraph', text: `The server currently registers **${tools.length} tools** in ${new Set(tools.map((tool) => tool.category)).size} groups. A tool call is refused unless the credential holds the listed permission (and, for OAuth tokens, a scope that grants it).` }]
  const categories = [...new Set(tools.map((tool) => tool.category))]
  for (const category of categories) {
    const label = MCP_CATEGORY_LABELS[category] ?? category
    blocks.push({ kind: 'heading', level: 3, text: label, id: `mcp-${slugify(category)}` })
    blocks.push({
      kind: 'table',
      head: ['Tool', 'What it does', 'Permission'],
      rows: tools.filter((tool) => tool.category === category).map((tool) => [code(tool.name), firstSentence(tool.description), tool.permission ? code(tool.permission) : 'any authenticated credential']),
    })
  }
  return blocks
}

/* ── CLI ── */

export function cliUsage(spec: CommandSpec): string {
  const parts = ['usertasks', spec.resource, spec.verb, ...spec.positional.map((name) => `<${name}>`), ...spec.pathFlags.map((name) => `--${name.replace(/_/g, '-')} <value>`)]
  return parts.join(' ')
}

function specFlags(spec: CommandSpec): string {
  const flags: string[] = []
  for (const query of spec.query) flags.push(`${code(`--${query.flag}`)}${query.required ? ' (required)' : ''}${query.enum ? ` ${query.enum.join(' / ')}` : ''}`)
  if (spec.paginated) flags.push(`${code('--all')} ${code('--limit')} ${code('--offset')}`)
  if (spec.cursor) flags.push(`${code('--limit')} ${code('--after')}`)
  if (spec.body) {
    const fields = spec.body.fields.map((field) => `${field.name}${field.required ? '*' : ''}`)
    flags.push(`body via ${code('-f')} / ${code('--set')}${fields.length ? `: ${fields.join(', ')}` : ''}`)
  }
  if (spec.destructive) flags.push(`asks to confirm (${code('--yes')} to skip)`)
  return flags.join('<br>')
}

export function cliResources(): string[] {
  return [...new Set(COMMAND_SPECS.map((spec) => spec.resource))].sort()
}

export function cliCommandReferenceBlocks(): DocBlock[] {
  const blocks: DocBlock[] = []
  blocks.push({ kind: 'heading', level: 2, text: 'Global options', id: 'global-options' })
  blocks.push({ kind: 'table', head: ['Option', 'Description'], rows: CLI_GLOBAL_OPTIONS.map((option) => [code(option.flags), option.description]) })

  blocks.push({ kind: 'heading', level: 2, text: 'Exit codes', id: 'exit-codes' })
  blocks.push({ kind: 'table', head: ['Code', 'Meaning'], rows: CLI_EXIT_CODES.map(([exitCode, meaning]) => [String(exitCode), meaning]) })

  for (const group of CLI_HANDWRITTEN_COMMANDS) {
    blocks.push({ kind: 'heading', level: 2, text: group.title, id: slugify(group.title) })
    for (const command of group.commands) {
      blocks.push({ kind: 'heading', level: 3, text: `usertasks ${command.command}`, id: `cmd-${slugify(command.command)}` })
      blocks.push({ kind: 'paragraph', text: `${code(`usertasks ${command.command}${command.args ? ` ${command.args}` : ''}`)} — ${command.description}` })
      if (command.options?.length) blocks.push({ kind: 'table', head: ['Option', 'Description'], rows: command.options.map((option) => [code(option.flags), option.description]) })
      if (command.example) blocks.push({ kind: 'code', lang: 'bash', code: command.example })
    }
  }

  blocks.push({ kind: 'heading', level: 2, text: 'Resource commands', id: 'resource-commands' })
  blocks.push({ kind: 'paragraph', text: `These ${COMMAND_SPECS.length} commands are generated from the server's OpenAPI document (one per REST operation), so they always match the API. The permission column is the permission the server checks. Fields marked * are required.` })
  for (const resource of cliResources()) {
    const specs = COMMAND_SPECS.filter((spec) => spec.resource === resource)
    blocks.push({ kind: 'heading', level: 3, text: resource, id: `cli-${slugify(resource)}` })
    blocks.push({
      kind: 'table',
      head: ['Command', 'What it does', 'Permission', 'Options'],
      rows: specs.map((spec) => [code(cliUsage(spec)), `${spec.summary} (${code(`${spec.method} /api/v1${spec.path}`)})`, spec.permission ? code(spec.permission) : 'any', specFlags(spec)]),
    })
  }
  return blocks
}

/* ── REST endpoints ── */

export function apiEndpointBlocks(): DocBlock[] {
  const blocks: DocBlock[] = []
  const tags = [...new Set(API_ENDPOINTS.map((endpoint) => endpoint.tags[0] ?? 'Other'))]
  blocks.push({ kind: 'paragraph', text: `${API_ENDPOINTS.length} operations, generated from the same registry as the OpenAPI document. Try them in the [API Explorer](/docs/api-explorer).` })
  for (const tag of tags) {
    blocks.push({ kind: 'heading', level: 3, text: tag, id: `endpoints-${slugify(tag)}` })
    blocks.push({
      kind: 'table',
      head: ['Method', 'Path', 'Summary', 'Permission'],
      rows: API_ENDPOINTS.filter((endpoint) => (endpoint.tags[0] ?? 'Other') === tag).map((endpoint) => [
        code(endpoint.method),
        code(`/api/v1${endpoint.path}`),
        endpoint.summary,
        endpoint.auth === 'none' ? 'public' : endpoint.permission ? code(endpoint.permission) : 'any',
      ]),
    })
  }
  return blocks
}

/* ── Connectors ── */

export function connectorReferenceBlocks(): DocBlock[] {
  const blocks: DocBlock[] = [{ kind: 'paragraph', text: `${CONNECTOR_CATALOG.length} built-in connectors. Each one adds service-specific setup fields, a connection test and ready-made references on top of a normal integration.` }]
  for (const category of CONNECTOR_CATEGORIES) {
    const connectors = CONNECTOR_CATALOG.filter((connector) => connector.category === category.value)
    if (connectors.length === 0) continue
    blocks.push({ kind: 'heading', level: 3, text: category.label, id: `connectors-${category.value}` })
    blocks.push({
      kind: 'table',
      head: ['Connector', 'What it connects', 'Ready-made references'],
      rows: connectors.map((connector) => [connector.name, connector.description, String(connector.referenceTemplates.length)]),
    })
  }
  return blocks
}

/* ── Report sources and agent tools ── */

export function reportSourceBlocks(): DocBlock[] {
  return [{
    kind: 'table',
    head: ['Source', 'Key', 'Category', 'Columns'],
    rows: REPORT_SOURCES.map((source) => [source.label, code(source.key), source.category, String(source.columns.length)]),
  }]
}

export function agentToolBlocks(): DocBlock[] {
  return [{
    kind: 'table',
    head: ['Tool', 'Group', 'What it does', 'Inputs'],
    rows: BUILTIN_TOOL_DEFS.map((tool) => [
      code(tool.name),
      tool.category,
      tool.description,
      (tool.inputSchema ?? []).map((input) => `${input.name}${input.required ? '*' : ''}`).join(', '),
    ]),
  }]
}

/* ── Environment variables (.env.example) ── */

export interface EnvVarDoc {
  name: string
  section: string
  example: string
  description: string
  commented: boolean
}

/** Parses .env.example: `# ── Section ──` headers, comment blocks, `VAR=` and commented `# VAR=` lines. */
export function parseEnvExample(text: string): EnvVarDoc[] {
  const vars: EnvVarDoc[] = []
  let section = 'General'
  let comments: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      comments = []
      continue
    }
    const header = /^#\s*──\s*(.+?)\s*─+\s*$/.exec(line)
    if (header) {
      section = header[1]
      comments = []
      continue
    }
    const assignment = /^(#\s*)?([A-Z][A-Z0-9_]+)=(.*)$/.exec(line)
    if (assignment) {
      vars.push({ name: assignment[2], section, example: assignment[3], description: comments.join(' '), commented: Boolean(assignment[1]) })
      // A comment block can describe several consecutive variables.
      continue
    }
    if (line.startsWith('#')) {
      // A new comment after an assignment starts a new description.
      if (vars.length > 0 && comments.length > 0 && vars[vars.length - 1].description === comments.join(' ')) comments = []
      comments.push(line.replace(/^#\s?/, ''))
    }
  }
  return vars
}

/**
 * Reads a repository file at build time (docs pages are statically generated).
 * The ignore comment stops Turbopack tracing the whole project into the bundle.
 */
export function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), relativePath), 'utf8')
}

export function envVarReferenceBlocks(): DocBlock[] {
  const vars = parseEnvExample(readRepoFile('.env.example'))
  const blocks: DocBlock[] = []
  for (const section of [...new Set(vars.map((v) => v.section))]) {
    blocks.push({ kind: 'heading', level: 3, text: section, id: `env-${slugify(section)}` })
    blocks.push({
      kind: 'table',
      head: ['Variable', 'Example / default', 'Description'],
      rows: vars.filter((v) => v.section === section).map((v) => [code(v.name), v.example ? code(v.example) : '', `${v.commented ? '(optional, commented out) ' : ''}${v.description}`]),
    })
  }
  return blocks
}

/* ── Repository Markdown (docs/*.md) ── */

/** Where repository Markdown links point on the docs site (null drops the link, keeping its text). */
const REPO_LINKS: Record<string, string> = {
  'self-hosting.md': '/docs/self-hosting',
  'migrations.md': '/docs/self-hosting/database',
  'infrastructure.md': '/docs/self-hosting/infrastructure',
  'optional-drivers.md': '/docs/self-hosting/optional-drivers',
  'switching-providers.md': '/docs/self-hosting/switching-providers',
  'deployment-profiles.md': '/docs/self-hosting/deployment-profiles',
  'setup-on-prem.md': '/docs/self-hosting/on-premises',
  'setup-azure.md': '/docs/self-hosting/azure',
  'setup-gcp.md': '/docs/self-hosting/google-cloud',
  'setup-kubernetes.md': '/docs/self-hosting/kubernetes',
  'setup-air-gapped.md': '/docs/self-hosting/air-gapped',
  'packages.md': '/docs/changelog#packages',
  'kubernetes-air-gapped.md': '/docs/changelog#kubernetes-air-gapped',
  'setup-aws.md': '/docs/self-hosting/aws',
  'admin-cli.md': '/docs/changelog#admin-cli',
  'parity.md': '/docs/api/parity',
  'results.md': '/docs/performance',
  'baseline.md': '/docs/performance',
  'performance.md': '/docs/changelog#performance',
  'log-export.md': '/docs/changelog#log-export',
  'cli-api.md': '/docs/changelog#cli-api',
}

/**
 * Repository folders whose Markdown files are docs pages of their own:
 * `docs/topologies/aws.md` → `/docs/topologies/aws`, the folder's README.md →
 * the section page.
 */
const REPO_FOLDERS: Record<string, string> = {
  'docs/topologies': '/docs/topologies',
  'docs/services': '/docs/services',
}

/**
 * Docs-site target of a link in repository Markdown. `from` is the file the
 * link appears in (relative links resolve against its folder, as on GitHub).
 */
export function resolveRepoLink(href: string, from?: string): string | null {
  if (/^(https?:|mailto:|#|\/)/.test(href)) return href
  const [file, hash] = href.split('#')
  if (from) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), file))
    const folder = path.posix.dirname(target)
    if (REPO_FOLDERS[folder]) {
      const name = path.posix.basename(target, '.md')
      const page = name === 'README' ? REPO_FOLDERS[folder] : `${REPO_FOLDERS[folder]}/${name}`
      return hash ? `${page}#${hash}` : page
    }
  }
  const base = file.split('/').pop() ?? ''
  if (REPO_LINKS[base]) return hash && !REPO_LINKS[base].includes('#') ? `${REPO_LINKS[base]}#${hash}` : REPO_LINKS[base]
  if (base === 'README.md' && file.includes('packages/cli')) return '/docs/cli'
  if (base === 'README.md' && file.includes('packages/sdk')) return '/docs/sdk'
  return null
}

/** A repository Markdown file as blocks, without its `# Title` line. */
export function includeRepoMarkdown(relativePath: string): DocBlock[] {
  const text = readRepoFile(relativePath).replace(/^#\s+.*\n/, '')
  return parseMarkdown(text, { headingShift: 0, resolveLink: (href) => resolveRepoLink(href, relativePath) })
}

export const CHANGELOG_FILES = [
  { id: 'form-attachments', file: 'docs/changes/form-attachments.md' },
  { id: 'document-actions', file: 'docs/changes/document-actions.md' },
  { id: 'form-qr-publish', file: 'docs/changes/form-qr-publish.md' },
  { id: 'manager-view', file: 'docs/changes/manager-view.md' },
  { id: 'workflow-started-by', file: 'docs/changes/workflow-started-by.md' },
  { id: 'form-theme-surfaces', file: 'docs/changes/form-theme-surfaces.md' },
  { id: 'form-buttons-submissions', file: 'docs/changes/form-buttons-submissions.md' },
  { id: 'form-lookups', file: 'docs/changes/form-lookups.md' },
  { id: 'task-forms', file: 'docs/changes/task-forms.md' },
  { id: 'engine-fixes', file: 'docs/changes/engine-fixes.md' },
  { id: 'background-jobs', file: 'docs/changes/background-jobs.md' },
  { id: 'infrastructure-ui-switching', file: 'docs/changes/infrastructure-ui-switching.md' },
  { id: 'kubernetes-air-gapped', file: 'docs/changes/kubernetes-air-gapped.md' },
  { id: 'packages-ui', file: 'docs/changes/packages-ui.md' },
  { id: 'optional-drivers', file: 'docs/changes/optional-drivers.md' },
  { id: 'aws-providers', file: 'docs/changes/aws-providers.md' },
  { id: 'instance-housekeeping', file: 'docs/changes/instance-housekeeping.md' },
  { id: 'directory-sync-providers', file: 'docs/changes/directory-sync-providers.md' },
  { id: 'api-data-picker', file: 'docs/changes/api-data-picker.md' },
  { id: 'packages', file: 'docs/changes/packages.md' },
  { id: 'admin-cli', file: 'docs/changes/admin-cli.md' },
  { id: 'database-portability', file: 'docs/changes/database-portability.md' },
  { id: 'auth-providers', file: 'docs/changes/auth-providers.md' },
  { id: 'email-secrets-providers', file: 'docs/changes/email-secrets-providers.md' },
  { id: 'scheduler-provider', file: 'docs/changes/scheduler-provider.md' },
  { id: 'storage-provider', file: 'docs/changes/storage-provider.md' },
  { id: 'realtime-provider', file: 'docs/changes/realtime-provider.md' },
  { id: 'run-workflow', file: 'docs/changes/run-workflow.md' },
  { id: 'scheduler-consolidation', file: 'docs/changes/scheduler-consolidation.md' },
  { id: 'task-html-descriptions', file: 'docs/changes/task-html-descriptions.md' },
  { id: 'live-instance-migration', file: 'docs/changes/live-instance-migration.md' },
  { id: 'workspace-theme', file: 'docs/changes/workspace-theme.md' },
  { id: 'performance', file: 'docs/changes/performance.md' },
  { id: 'log-export', file: 'docs/changes/log-export.md' },
  { id: 'cli-api', file: 'docs/changes/cli-api.md' },
]

export function changelogBlocks(): DocBlock[] {
  const blocks: DocBlock[] = []
  for (const { id, file } of CHANGELOG_FILES) {
    const text = readRepoFile(file)
    const title = /^#\s+(.*)$/m.exec(text)?.[1] ?? id
    blocks.push({ kind: 'heading', level: 2, text: title.replace(/^Release notes:\s*/i, ''), id })
    blocks.push(...parseMarkdown(text.replace(/^#\s+.*\n/, ''), { headingShift: 1, resolveLink: resolveRepoLink }).map((block) =>
      block.kind === 'heading' ? { ...block, id: `${id}-${block.id}` } : block,
    ))
  }
  return blocks
}

export function parityBlocks(): DocBlock[] {
  return parseMarkdown(renderParityMarkdown().replace(/^#\s+.*\n/, ''), { headingShift: 0, resolveLink: resolveRepoLink })
}

/* ── Directive registry ── */

export const GENERATED_DIRECTIVES: Record<string, (args: string[]) => DocBlock[]> = {
  nodes: () => nodeReferenceBlocks(),
  functions: () => functionReferenceBlocks(),
  permissions: () => permissionReferenceBlocks(),
  scopes: () => scopeReferenceBlocks(),
  'mcp-tools': () => mcpToolReferenceBlocks(),
  'cli-commands': () => cliCommandReferenceBlocks(),
  'api-endpoints': () => apiEndpointBlocks(),
  connectors: () => connectorReferenceBlocks(),
  'report-sources': () => reportSourceBlocks(),
  'agent-tools': () => agentToolBlocks(),
  'env-vars': () => envVarReferenceBlocks(),
  changelog: () => changelogBlocks(),
  parity: () => parityBlocks(),
  include: ([file]) => includeRepoMarkdown(file),
}
