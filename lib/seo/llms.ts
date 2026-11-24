import { ALL_DOC_PAGES, DOC_SECTIONS, docHref } from '@/lib/docs/registry'
import type { DocBlock, DocListItem } from '@/lib/docs/markdown'
import { pageBlocks } from '@/lib/docs/render'
import { SEO_PAGES, type SeoPage } from '@/lib/seo-pages'
import { USE_CASES } from '@/lib/use-cases'
import { PUBLIC_PAGES, pageUpdated, type PublicPage } from '@/lib/seo/public-pages'
import { DOCS_UPDATED, PRODUCT_DEFINITION, SITE_CONTENT_UPDATED } from '@/lib/seo/site'
import { EXTENSIONS, EXTENSIONS_PAGE, LICENSING_FACTS, STATUS_LABEL } from '@/lib/seo/extensions'
import { ALTERNATIVES_COMPARISON, SHAREPOINT_FACTS_CHECKED, SHAREPOINT_FAQS, SHAREPOINT_KEY_FACTS, SHAREPOINT_TIMELINE } from '@/lib/seo/sharepoint-facts'

/**
 * /llms.txt and /llms-full.txt (https://llmstxt.org): a Markdown map of the
 * public site for AI assistants and answer engines, and the full text of the
 * guides, use cases and docs. Generated from the same data the pages render,
 * so they can't drift from the site.
 */

const KEY_FACTS = [
  'Status: UserTasks Cloud is in beta; self-hosted UserTasks is production-ready (install with the one-line installer, Docker, Kubernetes or air-gapped today). The SharePoint extension is production-ready on self-hosted UserTasks.',
  'Licence: Apache-2.0 (open source). The cloud edition at usertasks.com runs the same code, is in beta and is free during the beta.',
  'Runs on: the UserTasks cloud, Docker Compose, Kubernetes (Helm chart), AWS, Azure, Google Cloud, or air-gapped from a signed offline bundle.',
  'Stack: TypeScript and Next.js, PostgreSQL 15+, S3-compatible storage.',
  'Developer surface: REST API (OpenAPI 3.1), MCP server, TypeScript SDK (@user-tasks/sdk) and CLI (@user-tasks/cli), with config as code.',
  'InfoPath importer: rebuilds Microsoft InfoPath .xsn form templates (2007, 2010, 2013) as UserTasks forms; free preview at https://usertasks.com/infopath.',
  'SharePoint Server extension (paid, $7,500 USD per farm per year with updates and support): a provider-hosted add-in for SharePoint Server 2016, 2019 and Subscription Edition that replaces SharePoint 2010 and 2013 workflows and InfoPath forms: list-event workflow triggers, embedded New/Edit/Display list forms, a dashboard per list (runs queue, metrics, permissions), manual start from the item menu, My tasks and Form web parts, the SharePoint REST API as workflow steps, and InfoPath and SharePoint Designer 2010 importers; https://usertasks.com/sharepoint.',
  `Paid extensions to the open-source core (https://usertasks.com/extensions): ${EXTENSIONS.map((extension) => `${extension.name} (${extension.price.amount} USD ${extension.price.unit}, ${STATUS_LABEL[extension.status].toLowerCase()})`).join('; ')}. Licences are signed files verified offline, so extensions work air-gapped.`,
  'Microsoft (KB5002945): the July 13, 2027 public update removes SharePoint 2010 workflows and InfoPath Forms Services from SharePoint Server Subscription Edition; both reached end of support on July 14, 2026. Source: https://support.microsoft.com/en-us/servicing/office/hotfix/sharepoint/5002945',
  'Nintex: a free Nintex workflow importer in UserTasks core reads .nwf and .nwp exports, previews them with a mapping report and imports them as drafts (in SharePoint, with a column check and SharePoint steps, through the extension). Nintex alternative page: https://usertasks.com/nintex-alternative.',
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
    '## SharePoint workflow and InfoPath replacement',
    '',
    ...SHAREPOINT_KEY_FACTS.map((fact) => `- ${fact.label}: ${fact.value}`),
    `- Pages: [SharePoint Server extension](${baseUrl}/sharepoint), [Get started with SharePoint in 4 steps](${baseUrl}/sharepoint/get-started), [SharePoint 30-day free trial](${baseUrl}/sharepoint/trial), [SharePoint workflow migration guide](${baseUrl}/sharepoint-workflow-migration), [InfoPath importer](${baseUrl}/infopath), [InfoPath migration guide](${baseUrl}/infopath-migration-guide), [Nintex alternative](${baseUrl}/nintex-alternative), [SharePoint extension docs](${baseUrl}/docs/sharepoint)`,
    '',
    '## Paid extensions',
    '',
    `- ${EXTENSIONS_PAGE.definition}`,
    ...LICENSING_FACTS.map((fact) => `- ${fact}`),
    ...EXTENSIONS.map((extension) => `- [${extension.name} extension](${baseUrl}${extension.href}): ${STATUS_LABEL[extension.status]}. ${extension.price.amount} USD ${extension.price.unit}. ${extension.summary} Free in the core: ${extension.freeInCore}`),
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

/** A titled comparison table with its note and sources, as Markdown. */
export function tableMarkdown(table: { title: string; body: string; columns: string[]; rows: string[][]; note?: string; sources: Array<{ label: string; href: string }> }): string {
  return [
    `## ${table.title}`, '', table.body, '',
    `| ${table.columns.map((c) => cell(c) || ' ').join(' | ')} |`, `|${table.columns.map(() => '---').join('|')}|`, ...table.rows.map((row) => `| ${row.map(cell).join(' | ')} |`), '',
    ...(table.note ? [table.note, ''] : []),
    ...table.sources.map((source) => `- Source: [${source.label}](${source.href})`),
  ].join('\n')
}

/** The SharePoint Server and InfoPath facts block: key facts, Microsoft's dates with sources, the options compared and the /sharepoint FAQ. */
export function sharePointMarkdown(baseUrl: string): string {
  return [
    '# SharePoint workflow and InfoPath replacement: key facts',
    '',
    `URL: ${baseUrl}/sharepoint (facts checked ${SHAREPOINT_FACTS_CHECKED})`,
    '',
    ...SHAREPOINT_KEY_FACTS.map((fact) => `- ${fact.label}: ${fact.value}${fact.source ? ` ([${fact.source.label}](${fact.source.href}))` : ''}`),
    '',
    '## Microsoft dates',
    '',
    ...SHAREPOINT_TIMELINE.map((event) => `- ${event.date}: ${event.text} ([${event.source.label}](${event.source.href}))`),
    '',
    tableMarkdown(ALTERNATIVES_COMPARISON),
    '',
    '## Frequently asked questions about the SharePoint extension',
    '',
    ...SHAREPOINT_FAQS.flatMap((faq) => [`### ${faq.question}`, '', faq.answer, '']),
  ].join('\n')
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
  if (page.facts) {
    parts.push('## Key facts', '', ...page.facts.map((fact) => `- ${fact.label}: ${fact.value}${fact.source ? ` ([${fact.source.label}](${fact.source.href}))` : ''}`), '')
  }
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
  if (page.alternatives) parts.push(tableMarkdown(page.alternatives), '')
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
    sharePointMarkdown(baseUrl),
    '',
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
