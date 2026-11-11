import { ALL_DOC_PAGES, DOC_SECTIONS, docHref } from '@/lib/docs/registry'
import type { DocBlock, DocListItem } from '@/lib/docs/markdown'
import { pageBlocks } from '@/lib/docs/render'
import { SEO_PAGES, type SeoPage } from '@/lib/seo-pages'
import { USE_CASES } from '@/lib/use-cases'
import { PUBLIC_PAGES, pageUpdated, type PublicPage } from '@/lib/seo/public-pages'
import { DOCS_UPDATED, PRODUCT_DEFINITION, SITE_CONTENT_UPDATED } from '@/lib/seo/site'

/**
 * /llms.txt and /llms-full.txt (https://llmstxt.org): a Markdown map of the
 * public site for AI assistants and answer engines, and the full text of the
 * guides, use cases and docs. Generated from the same data the pages render,
 * so they can't drift from the site.
 */

const KEY_FACTS = [
  'Licence: Apache-2.0 (open source). The cloud edition at usertasks.com runs the same code and is free during the beta.',
  'Runs on: the UserTasks cloud, Docker Compose, Kubernetes (Helm chart), AWS, Azure, Google Cloud, or air-gapped from a signed offline bundle.',
  'Stack: TypeScript and Next.js, PostgreSQL 15+, S3-compatible storage.',
  'Developer surface: REST API (OpenAPI 3.1), MCP server, TypeScript SDK (@user-tasks/sdk) and CLI (@user-tasks/cli), with config as code.',
  'InfoPath importer: rebuilds Microsoft InfoPath .xsn form templates (2007, 2010, 2013) as UserTasks forms; free preview at https://usertasks.com/infopath.',
  'Performance: median time to run a workflow step is under 1 ms, measured on live runs.',
  'AI is optional: the Agent and AI workflow steps use your own provider key or a local model (Ollama, vLLM, any OpenAI-compatible endpoint).',
]

function absolute(baseUrl: string, text: string): string {
  return text.replace(/\]\(\//g, `](${baseUrl}/`)
}

function link(baseUrl: string, page: Pick<PublicPage, 'path' | 'title' | 'description'>): string {
  return `- [${page.title}](${baseUrl}${page.path}): ${page.description}`
}

export function buildLlmsTxt(baseUrl: string): string {
  const groups: Array<[string, PublicPage[]]> = [
    ['Product', PUBLIC_PAGES.filter((page) => page.group === 'product')],
    ['Guides: migration, on-premises and open source', PUBLIC_PAGES.filter((page) => page.group === 'guide')],
  ]
  const lines = [
    '# UserTasks',
    '',
    `> ${PRODUCT_DEFINITION}`,
    '',
    ...KEY_FACTS.map((fact) => `- ${fact}`),
    '',
    `Full text of every guide, use case and documentation page: ${baseUrl}/llms-full.txt. Last updated ${SITE_CONTENT_UPDATED}.`,
    '',
  ]
  for (const [title, pages] of groups) {
    lines.push(`## ${title}`, '', ...pages.map((page) => link(baseUrl, page)), '')
  }
  lines.push('## Use cases', '', ...USE_CASES.map((useCase) => link(baseUrl, { path: `/use-cases/${useCase.slug}`, title: useCase.title, description: useCase.description })), '')
  for (const section of DOC_SECTIONS) {
    lines.push(`## Docs: ${section.title}`, '', ...section.pages.map((page) => link(baseUrl, { path: docHref(page.slug), title: page.title, description: page.description })), '')
  }
  lines.push('## Optional', '', ...PUBLIC_PAGES.filter((page) => page.group === 'company').map((page) => link(baseUrl, page)), `- [Sitemap](${baseUrl}/sitemap.xml): every public URL`, '')
  return lines.join('\n')
}

function listMarkdown(items: DocListItem[], ordered: boolean, start: number, depth: number): string[] {
  return items.flatMap((item, index) => [
    `${'  '.repeat(depth)}${ordered ? `${start + index}.` : '-'} ${item.text}`,
    ...(item.items ? listMarkdown(item.items, false, 1, depth + 1) : []),
  ])
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** Docs blocks back to Markdown (generated references and includes already expanded). */
export function blocksToMarkdown(blocks: DocBlock[]): string {
  const out: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': out.push(`${'#'.repeat(block.level + 1)} ${block.text}`); break
      case 'paragraph': out.push(block.text); break
      case 'list': out.push(listMarkdown(block.items, block.ordered, block.start ?? 1, 0).join('\n')); break
      case 'code': out.push(`\`\`\`${block.lang}\n${block.code}\n\`\`\``); break
      case 'table': out.push([`| ${block.head.map(cell).join(' | ')} |`, `|${block.head.map(() => '---').join('|')}|`, ...block.rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n')); break
      case 'callout': out.push(block.text.split('\n').map((line) => `> ${line}`).join('\n')); break
      case 'directive':
        // Screenshots and diagrams: keep the caption, which describes what the picture shows.
        if (block.name === 'image' && (block.args[2] || block.args[1])) out.push(`(Screenshot: ${block.args[2] || block.args[1]})`)
        break
    }
  }
  return out.join('\n\n')
}

export function seoPageMarkdown(page: SeoPage, baseUrl: string): string {
  const parts = [
    `# ${page.title}`,
    '',
    `URL: ${baseUrl}/${page.slug}`,
    `Last updated: ${page.updated}`,
    '',
    page.definition,
    '',
    page.intro,
    '',
    ...page.outcomes.map((outcome) => `- ${outcome}`),
    '',
  ]
  if (page.timeline) {
    parts.push(`## ${page.timeline.title}`, '', page.timeline.body, '', ...page.timeline.events.map((event) => `- ${event.date}: ${event.text}`), '', 'Sources:', ...page.timeline.sources.map((source) => `- [${source.label}](${source.href})`), '')
  }
  for (const section of page.sections) {
    parts.push(`## ${section.title}`, '', section.body, '', ...section.points.map((point) => `- ${point}`), '')
  }
  if (page.comparison) {
    const { columns, rows } = page.comparison
    parts.push(`## ${page.comparison.title}`, '', page.comparison.body, '', `| ${columns.map((c) => c || ' ').join(' | ')} |`, `|${columns.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`), '')
    if (page.comparison.note) parts.push(page.comparison.note, '')
  }
  parts.push(`## ${page.stepsTitle ?? 'Implementation path'}`, '', ...page.steps.map((step, index) => `${index + 1}. **${step.title}.** ${step.body}`), '')
  parts.push('## Frequently asked questions', '')
  for (const faq of page.faqs) parts.push(`### ${faq.question}`, '', faq.answer, '')
  if (page.disclaimer) parts.push(`_${page.disclaimer}_`, '')
  return parts.join('\n')
}

export function buildLlmsFullTxt(baseUrl: string): string {
  const parts: string[] = [
    '# UserTasks — full text',
    '',
    `> ${PRODUCT_DEFINITION}`,
    '',
    ...KEY_FACTS.map((fact) => `- ${fact}`),
    '',
    `Generated from ${baseUrl}. Site content last updated ${SITE_CONTENT_UPDATED}; docs ${DOCS_UPDATED}. Index: ${baseUrl}/llms.txt`,
    '',
    '# Product pages',
    '',
    ...PUBLIC_PAGES.filter((page) => page.group === 'product').flatMap((page) => [`## ${page.title}`, '', `URL: ${baseUrl}${page.path} (updated ${pageUpdated(page)})`, '', page.description, '']),
  ]
  for (const page of SEO_PAGES) parts.push(absolute(baseUrl, seoPageMarkdown(page, baseUrl)), '')
  parts.push('# Use cases', '')
  for (const useCase of USE_CASES) {
    parts.push(
      `## ${useCase.title}`, '', `URL: ${baseUrl}/use-cases/${useCase.slug}`, '', useCase.description, '',
      `### ${useCase.problem.title}`, '', useCase.problem.body, '', ...useCase.problem.points.map((point) => `- ${point}`), '',
      `### ${useCase.solution.title}`, '', useCase.solution.body, '', ...useCase.solution.points.map((point) => `- ${point}`), '',
    )
    if (useCase.timeline) parts.push(`### ${useCase.timeline.title}`, '', ...useCase.timeline.events.map((event) => `- ${event.date}: ${event.text}`), '', ...useCase.timeline.sources.map((source) => `- Source: [${source.label}](${source.href})`), '')
    if (useCase.mapping) parts.push(`### ${useCase.mapping.title}`, '', ...useCase.mapping.rows.map((row) => `- ${row.from} → ${row.to}`), '')
    for (const faq of useCase.faqs) parts.push(`#### ${faq.question}`, '', faq.answer, '')
    if (useCase.disclaimer) parts.push(`_${useCase.disclaimer}_`, '')
  }
  parts.push('# Documentation', '')
  for (const page of ALL_DOC_PAGES) {
    parts.push(`## ${page.title}`, '', `URL: ${baseUrl}${docHref(page.slug)}`, '', page.description, '', absolute(baseUrl, blocksToMarkdown(pageBlocks(page)).replace(/^(#{2,5}) /gm, (_, hashes: string) => `${hashes}# `)), '')
  }
  return parts.join('\n')
}
