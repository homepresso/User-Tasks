import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import type { Command } from 'commander'
import { NODE_CATALOG, type NodeType } from '@/lib/workflow-schema'
import { FUNCTION_CATALOG } from '@/lib/expression-functions'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { OAUTH_SCOPES } from '@/lib/oauth/scopes'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { NODE_DOCS } from '@/lib/docs/node-docs'
import { CLI_EXIT_CODES, CLI_GLOBAL_OPTIONS, CLI_HANDWRITTEN_COMMANDS } from '@/lib/docs/cli-commands'
import { listMcpTools, parseEnvExample, resolveRepoLink } from '@/lib/docs/generated'
import { parseMarkdown, type DocBlock } from '@/lib/docs/markdown'
import { ALL_DOC_PAGES, LEGACY_DOC_REDIRECTS, getDocPage } from '@/lib/docs/registry'
import { buildSearchIndex, pageBlocks } from '@/lib/docs/render'
import { SCREENSHOT_NAMES } from '@/lib/docs/screenshot-names'
import { COMMAND_SPECS } from '@/packages/cli/src/generated/commands'

// The CLI sources are typechecked by their own package (against the SDK
// sources); load them dynamically so the root tsc does not pull them in.
const CLI_SRC = '@/packages/cli/src'
async function loadCli() {
  const [{ buildProgram }, { Runtime }, { EXIT }] = await Promise.all([
    import(/* @vite-ignore */ `${CLI_SRC}/main`),
    import(/* @vite-ignore */ `${CLI_SRC}/runtime`),
    import(/* @vite-ignore */ `${CLI_SRC}/exit-codes`),
  ])
  return { program: buildProgram(new Runtime(io)) as Command, EXIT: EXIT as Record<string, number> }
}

function pageText(slug: string): string {
  const page = getDocPage(slug)
  if (!page) throw new Error(`missing docs page ${slug}`)
  return JSON.stringify(pageBlocks(page))
}

function headingIds(blocks: DocBlock[]): Set<string> {
  return new Set(blocks.filter((block) => block.kind === 'heading').map((block) => (block as { id: string }).id))
}

/** Every inline Markdown link target in a page's blocks. */
function linksIn(blocks: DocBlock[]): string[] {
  const text = JSON.stringify(blocks)
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1])
}

const io = {
  env: {},
  stdout: { write: () => true, isTTY: false },
  stderr: { write: () => true, isTTY: false },
  stdinIsTTY: false,
  readStdin: async () => '',
  confirm: async () => false,
  promptSecret: async () => '',
  fetch: (async () => new Response('{}')) as unknown as typeof fetch,
  configPath: path.join(process.cwd(), 'node_modules/.cache/docs-test/config.json'),
}

function leafCommands(command: Command, prefix: string[] = []): Array<{ path: string; command: Command }> {
  return command.commands.flatMap((child) => {
    const childPath = [...prefix, child.name()]
    return child.commands.length === 0 ? [{ path: childPath.join(' '), command: child }] : leafCommands(child, childPath)
  })
}

describe('docs pages', () => {
  it('have unique slugs and build without errors', () => {
    const slugs = ALL_DOC_PAGES.map((page) => page.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const page of ALL_DOC_PAGES) {
      expect(page.title.length).toBeGreaterThan(2)
      expect(page.description.length).toBeGreaterThan(20)
      expect(pageBlocks(page).length).toBeGreaterThan(0)
    }
  })

  it('link only to pages and anchors that exist', () => {
    const problems: string[] = []
    for (const page of ALL_DOC_PAGES) {
      for (const href of linksIn(pageBlocks(page))) {
        if (!href.startsWith('/docs') && !href.startsWith('#')) continue
        if (href.startsWith('/docs/api-explorer')) continue
        const [pathname, hash] = href.startsWith('#') ? [`/docs/${page.slug}`, href.slice(1)] : href.split('#')
        const slug = pathname.replace(/^\/docs\/?/, '')
        if (slug === '') continue
        const target = getDocPage(slug)
        if (!target) {
          problems.push(`${page.slug}: ${href} (no page)`)
          continue
        }
        if (hash && !headingIds(pageBlocks(target)).has(hash)) problems.push(`${page.slug}: ${href} (no anchor)`)
      }
    }
    expect(problems).toEqual([])
  })

  it('use only screenshots that exist', () => {
    for (const name of SCREENSHOT_NAMES) {
      expect(existsSync(path.join(process.cwd(), 'public/screenshots', `${name}.webp`)), name).toBe(true)
    }
    for (const page of ALL_DOC_PAGES) {
      for (const block of pageBlocks(page)) {
        if (block.kind === 'directive' && block.name === 'image') expect(SCREENSHOT_NAMES).toContain(block.args[0])
      }
    }
  })

  it('redirect every retired slug to a page that exists', () => {
    for (const [from, to] of Object.entries(LEGACY_DOC_REDIRECTS)) {
      expect(getDocPage(from)).toBeUndefined()
      expect(getDocPage(to.replace(/^\/docs\//, ''))).toBeDefined()
    }
    for (const kept of ['workflows', 'integrations', 'tasks', 'decision-tables', 'agents', 'api', 'cli', 'observability', 'governance']) {
      expect(getDocPage(kept), kept).toBeDefined()
    }
  })

  it('index every page and heading for search', () => {
    const index = buildSearchIndex()
    for (const page of ALL_DOC_PAGES) expect(index.some((entry) => entry.h === `/docs/${page.slug}`)).toBe(true)
    expect(index.some((entry) => entry.t === 'usertasks logs tail')).toBe(true)
  })
})

describe('generated references cover the code', () => {
  it('document every workflow node', () => {
    const text = pageText('workflows/nodes')
    for (const node of NODE_CATALOG) {
      expect(NODE_DOCS[node.type as NodeType], node.type).toBeDefined()
      expect(text, node.type).toContain(`node-${node.type.replace(/_/g, '-')}`)
    }
    expect(Object.keys(NODE_DOCS).sort()).toEqual(NODE_CATALOG.map((node) => node.type).sort())
  })

  it('document every expression function', () => {
    const text = pageText('workflows/functions')
    for (const fn of FUNCTION_CATALOG) expect(text, fn.name).toContain(`\`${fn.name}(`)
  })

  it('document every permission and OAuth scope', () => {
    const permissions = pageText('governance/roles-and-permissions')
    for (const key of PERMISSION_KEYS) expect(permissions, key).toContain(`\`${key}\``)
    const scopes = pageText('governance/oauth-apps')
    for (const scope of OAUTH_SCOPES) expect(scopes, scope).toContain(`\`${scope}\``)
  })

  it('document every MCP tool with its permission', () => {
    const tools = listMcpTools()
    expect(tools.length).toBeGreaterThan(100)
    const text = pageText('mcp')
    for (const tool of tools) expect(text, tool.name).toContain(`\`${tool.name}\``)
  })

  it('document every REST endpoint', () => {
    const text = pageText('api/endpoints')
    for (const endpoint of API_ENDPOINTS) expect(text, endpoint.operationId).toContain(`\`/api/v1${endpoint.path}\``)
  })

  it('document every CLI command, option and exit code', async () => {
    const { program, EXIT } = await loadCli()
    const text = pageText('cli/commands')
    const generated = new Set(COMMAND_SPECS.map((spec) => `${spec.resource} ${spec.verb}`))
    const handwritten = new Map(CLI_HANDWRITTEN_COMMANDS.flatMap((group) => group.commands).map((command) => [command.command, command]))

    for (const { path: commandPath, command } of leafCommands(program)) {
      if (generated.has(commandPath)) {
        expect(text, commandPath).toContain(`usertasks ${commandPath}`)
        continue
      }
      const doc = handwritten.get(commandPath)
      expect(doc, `hand-written command "${commandPath}" is not in lib/docs/cli-commands.ts`).toBeDefined()
      const documented = new Set((doc?.options ?? []).map((option) => option.flags))
      for (const option of command.options) expect(documented, `${commandPath} ${option.flags}`).toContain(option.flags)
      expect(text).toContain(`cmd-${commandPath.replace(/ /g, '-')}`)
    }
    for (const command of handwritten.keys()) {
      expect(leafCommands(program).some((leaf) => leaf.path === command), `documented command "${command}" does not exist`).toBe(true)
    }

    const globals = new Set(CLI_GLOBAL_OPTIONS.map((option) => option.flags))
    for (const option of program.options) expect(globals, option.flags).toContain(option.flags)

    expect(CLI_EXIT_CODES.map(([exitCode]) => exitCode).sort((a, b) => a - b)).toEqual(Object.values(EXIT).sort((a, b) => a - b))
  })

  it('document every variable in .env.example', () => {
    const text = readFileSync(path.join(process.cwd(), '.env.example'), 'utf8')
    const vars = parseEnvExample(text)
    const names = vars.map((v) => v.name)
    for (const name of [...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1])) expect(names).toContain(name)
    expect(vars.find((v) => v.name === 'WORKFLOW_PROCESSOR_SECRET')?.commented).toBe(true)
    expect(vars.find((v) => v.name === 'ENCRYPTION_KEY')?.description).toMatch(/AES-256-GCM/)
    const page = pageText('self-hosting/environment')
    for (const name of names) expect(page, name).toContain(`\`${name}\``)
  })
})

describe('docs markdown', () => {
  it('parses lists, code, tables, callouts and directives', () => {
    const blocks = parseMarkdown([
      '## Title', '', 'Some `code` and **bold**.', '', '- one', '  - nested', '- two', '', '3. three', '4. four', '',
      '```bash title="x"', 'echo hi', '```', '', '| a | b |', '|---|---|', '| `x|y` | 2 |', '', '> [!WARNING]', '> careful', '', '::image designer | Alt | Caption',
    ].join('\n'))
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'code', 'table', 'callout', 'directive'])
    expect(blocks[2]).toMatchObject({ items: [{ text: 'one', items: [{ text: 'nested' }] }, { text: 'two' }] })
    expect(blocks[3]).toMatchObject({ ordered: true, start: 3 })
    expect(blocks[4]).toMatchObject({ lang: 'bash', title: 'x', code: 'echo hi' })
    expect(blocks[5]).toMatchObject({ rows: [['`x|y`', '2']] })
    expect(blocks[6]).toMatchObject({ tone: 'warning', text: 'careful' })
    expect(blocks[7]).toMatchObject({ name: 'image', args: ['designer', 'Alt', 'Caption'] })
  })

  it('maps repository links to docs pages', () => {
    expect(resolveRepoLink('migrations.md')).toBe('/docs/self-hosting/database')
    expect(resolveRepoLink('../perf/results.md')).toBe('/docs/performance')
    expect(resolveRepoLink('docs/self-hosting.md#optional-database-drivers')).toBe('/docs/self-hosting#optional-database-drivers')
    expect(resolveRepoLink('https://example.com')).toBe('https://example.com')
    expect(resolveRepoLink('../../scripts/bench/run.ts')).toBeNull()
  })
})
