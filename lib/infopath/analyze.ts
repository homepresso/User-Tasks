/**
 * The InfoPath analyzer: an uploaded .xsn (or zipped source files) → the
 * intermediate model (lib/infopath/model.ts). Pure apart from hashing; no
 * I/O, no network, no code from the file is ever run.
 *
 * XML is read with the safe parser (lib/documents/xml: no DTDs, no external
 * entities, bounded depth / node count) and the work is bounded by
 * INFOPATH_LIMITS and a wall-clock budget (ANALYZE_BUDGET_MS) checked
 * between parts.
 */

import { attr, elements, parseXml, textOf, type XmlElement } from '@/lib/documents/xml'
import { INFOPATH_LIMITS, InfoPathFileError, openInfoPathPackage, partText, type InfoPathPackage, type PackageLimits } from './archive'
import { parseManifest } from './manifest'
import { parseSchema, schemaNodes } from './schema'
import { parseView } from './view'
import { localOf } from './xpath'
import type { InfoPathModel, IpControl, IpSchemaNode, IpViewItem } from './model'

export const ANALYZE_BUDGET_MS = 20_000

function xml(pkg: InfoPathPackage, name: string, required = false): XmlElement | null {
  const text = partText(pkg, name)
  if (text === null) {
    if (required) throw new InfoPathFileError(`${name} is missing from the form template`, 'corrupt')
    return null
  }
  try {
    return parseXml(text, { maxDepth: 400, maxNodes: 600_000 })
  } catch (error) {
    if (required) throw new InfoPathFileError(`${name} could not be read: ${(error as Error).message}`, 'corrupt')
    return null
  }
}

/** Leaf values of template.xml by absolute local-name path (first occurrence). */
function templateDefaults(doc: XmlElement | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!doc) return out
  let count = 0
  const walk = (el: XmlElement, path: string, depth: number) => {
    if (depth > 60 || ++count > 50_000) return
    const p = `${path}/${el.local}`
    const kids = elements(el)
    for (const [k, v] of Object.entries(el.attrs)) {
      if (k.startsWith('xmlns') || k.includes(':')) continue
      if (!(`${p}/@${k}` in out) && v) out[`${p}/@${k}`] = v
    }
    if (!kids.length || el.local === 'html' || kids.every((k) => /xhtml/.test(k.attrs.xmlns ?? ''))) {
      const nil = el.attrs['xsi:nil'] === 'true'
      const text = nil ? '' : textOf(el).trim()
      if (!(p in out) && text) out[p] = text
      return
    }
    for (const k of kids) walk(k, p, depth + 1)
  }
  walk(doc, '', 0)
  return out
}

export interface AnalyzeOptions {
  fileName?: string
  now?: () => number
  /** Wall-clock budget (default ANALYZE_BUDGET_MS); the public analyzer uses less. */
  budgetMs?: number
  /** Lower caps for untrusted, anonymous uploads (see openInfoPathPackage). */
  limits?: PackageLimits
}

export function analyzeInfoPath(bytes: Uint8Array, options: AnalyzeOptions = {}): InfoPathModel {
  const now = options.now ?? Date.now
  const started = now()
  const checkBudget = (stage: string) => {
    if (now() - started > (options.budgetMs ?? ANALYZE_BUDGET_MS)) throw new InfoPathFileError(`Analysing the form took too long (stopped while reading ${stage})`, 'limit')
  }
  const pkg = openInfoPathPackage(bytes, options.limits)
  checkBudget('the archive')
  const manifestDoc = xml(pkg, 'manifest.xsf', true)!
  const first = parseManifest(manifestDoc)

  // Main schema: documentSchema rootSchema="yes" location="<ns> myschema.xsd", plus what it imports / includes.
  const docSchemas = descendants(manifestDoc, 'documentSchema')
  const rootSchema = docSchemas.find((d) => attr(d, 'rootSchema') === 'yes') ?? docSchemas[0]
  const schemaFile = (attr(rootSchema, 'location') ?? '').trim().split(/\s+/).pop() || 'myschema.xsd'
  const schemaDocs: XmlElement[] = []
  const queue = [schemaFile]
  const seen = new Set<string>()
  while (queue.length && schemaDocs.length < 20) {
    const name = queue.shift()!
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const doc = xml(pkg, name)
    if (!doc) continue
    schemaDocs.push(doc)
    for (const inc of elements(doc).filter((e) => e.local === 'import' || e.local === 'include')) {
      const loc = attr(inc, 'schemaLocation')
      if (loc && !/^[a-z]+:/i.test(loc)) queue.push(loc)
    }
  }
  const warnings: string[] = []
  if (!schemaDocs.length) warnings.push(`The main schema (${schemaFile}) is missing: field types are guessed from the controls`)
  const { root: schema, warnings: schemaWarnings } = parseSchema(schemaDocs, first.root)
  warnings.push(...schemaWarnings)
  checkBudget('the schema')
  const nodes = new Map(schemaNodes(schema).map((n) => [n.path.toLowerCase(), n]))
  const rootPath = schema ? schema.path : first.root ? `/${localOf(first.root)}` : ''
  const repeating = new Set(first.repeating.map((p) => p.toLowerCase()))
  const optional = new Set(first.optional.map((p) => p.toLowerCase()))
  const isRepeating = (p: string) => repeating.has(p.toLowerCase()) || Boolean(nodes.get(p.toLowerCase())?.repeating)
  const isOptional = (p: string) => optional.has(p.toLowerCase())

  const views = []
  for (const v of first.views.slice(0, INFOPATH_LIMITS.maxViews)) {
    const doc = xml(pkg, v.file)
    if (!doc) { warnings.push(`View "${v.name}" (${v.file}) could not be read`); continue }
    views.push(parseView(doc, { ...v, default: v.name === first.default_view }, { root: rootPath, isRepeating, isOptional }))
    checkBudget(`view "${v.name}"`)
  }
  if (first.views.length > INFOPATH_LIMITS.maxViews) warnings.push(`The form has ${first.views.length} views: the first ${INFOPATH_LIMITS.maxViews} are read`)
  if (!views.length) throw new InfoPathFileError('The form template has no views that could be read', 'corrupt')
  if (!first.default_view && views[0]) views[0].default = true

  // Buttons' rule context: where the button sits in its view.
  const buttonContext = new Map<string, string>()
  for (const v of views) for (const c of walkControls(v.items)) if (c.kind === 'button' && c.context) buttonContext.set(`${v.name}|${c.id}`, c.context)
  const manifest = parseManifest(manifestDoc, (view, id) => buttonContext.get(`${view}|${id}`) ?? null)
  if (pkg.names.some((n) => /\.(dll|js|vbs)$/i.test(n)) && !manifest.code.length) manifest.code.push(`Code files: ${pkg.names.filter((n) => /\.(dll|js|vbs)$/i.test(n)).join(', ')}`)

  const templateFile = attr(descendants(manifestDoc, 'initialXmlDocument')[0], 'href') ?? 'template.xml'
  const defaults = templateDefaults(xml(pkg, templateFile))

  return {
    file_name: (options.fileName ?? 'form.xsn').slice(0, 200),
    hash: pkg.hash,
    format: pkg.format,
    files: pkg.names.slice(0, 500),
    manifest,
    schema,
    defaults,
    views,
    warnings: [...warnings, ...views.flatMap((v) => v.warnings.map((w) => `${v.name}: ${w}`))].slice(0, 200),
  }
}

function descendants(node: XmlElement, local: string, depth = 0, out: XmlElement[] = []): XmlElement[] {
  if (depth > 60) return out
  for (const c of elements(node)) {
    if (c.local === local) out.push(c)
    descendants(c, local, depth + 1, out)
  }
  return out
}

/** Every control of a view (sections and repeating parts included), depth first. */
export function walkControls(items: IpViewItem[]): IpControl[] {
  const out: IpControl[] = []
  const walk = (list: IpViewItem[]) => {
    for (const i of list) {
      if (i.kind === 'static') continue
      out.push(i)
      if (i.children) walk(i.children)
    }
  }
  walk(items)
  return out
}

/** Schema node by absolute path (case-insensitive). */
export function schemaIndex(model: Pick<InfoPathModel, 'schema'>): Map<string, IpSchemaNode> {
  return new Map(schemaNodes(model.schema).map((n) => [n.path.toLowerCase(), n]))
}
