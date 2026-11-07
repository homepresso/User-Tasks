/**
 * Knowledge retrieval for agents (server only): search_knowledge and
 * read_knowledge_document over the agent's knowledge sources —
 * uploaded documents (output_config.knowledge.files: PDF, Word, Excel,
 * PowerPoint, text, CSV, JSON, Markdown; text extracted with the same
 * extractor as Run Agent files) and data tables
 * (output_config.knowledge.table_ids, read-only).
 *
 * Retrieval is lexical: documents are split into ~1,200-character
 * passages and ranked with BM25 over the query's terms; table rows are
 * ranked the same way over their values. Extracted document text is cached
 * in memory per stored file (bounded), so repeated searches don't re-read
 * the file. No embeddings / vector store are needed.
 */
import type { AgentKnowledgeFile } from '@/lib/agent-knowledge'
import { AgentToolError, type AgentToolRuntime, type ToolResult } from './runtime'

const PASSAGE_CHARS = 1_200
const PASSAGE_OVERLAP = 200
const MAX_ROWS_PER_TABLE = 500
const TEXT_CACHE_MAX = 40
const textCache = new Map<string, string>()

const STOP = new Set('a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with you your'.split(' '))

export function tokenize(text: string): string[] {
  return String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t))
}

export function splitPassages(text: string, size = PASSAGE_CHARS, overlap = PASSAGE_OVERLAP): string[] {
  const clean = String(text ?? '').replace(/\s+\n/g, '\n').trim()
  if (!clean) return []
  if (clean.length <= size) return [clean]
  const out: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size)
    if (end < clean.length) {
      const breakAt = clean.lastIndexOf('\n', end)
      const space = clean.lastIndexOf(' ', end)
      const cut = breakAt > start + size / 2 ? breakAt : space > start + size / 2 ? space : end
      end = cut
    }
    out.push(clean.slice(start, end).trim())
    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return out.filter(Boolean)
}

export interface KnowledgeDoc { source: string; kind: 'document' | 'table_row'; text: string; ref?: Record<string, unknown> }

/** BM25 ranking of `docs` for `query` (k1 1.2, b 0.75). */
export function rankBm25(query: string, docs: KnowledgeDoc[], limit: number): Array<KnowledgeDoc & { score: number }> {
  const terms = Array.from(new Set(tokenize(query)))
  if (terms.length === 0 || docs.length === 0) return []
  const tokenized = docs.map((d) => tokenize(d.text))
  const avg = tokenized.reduce((s, t) => s + t.length, 0) / tokenized.length || 1
  const df = new Map<string, number>()
  for (const toks of tokenized) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1)
  const n = docs.length
  const scored = docs.map((doc, i) => {
    const toks = tokenized[i]
    const tf = new Map<string, number>()
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const term of terms) {
      const f = tf.get(term) ?? 0
      if (!f) continue
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5))
      score += idf * ((f * 2.2) / (f + 1.2 * (1 - 0.75 + 0.75 * (toks.length / avg))))
    }
    return { ...doc, score }
  })
  return scored.filter((d) => d.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
}

async function documentText(runtime: AgentToolRuntime, file: AgentKnowledgeFile): Promise<string> {
  const key = `${runtime.tenantId}:${file.ref ?? file.path ?? file.url}`
  const hit = textCache.get(key)
  if (hit !== undefined) return hit
  const { loadStepFiles } = await import('@/lib/workflow-files')
  const { extractFileText } = await import('@/lib/agent-files')
  const [loaded] = await loadStepFiles([file], { tenantId: runtime.tenantId, maxFiles: 1, maxTotalBytes: 25 * 1024 * 1024 })
  if (!loaded) throw new AgentToolError(`Knowledge document "${file.name}" could not be read`, 404)
  const text = await extractFileText(loaded)
  textCache.set(key, text)
  if (textCache.size > TEXT_CACHE_MAX) textCache.delete(textCache.keys().next().value as string)
  return text
}

function rowText(row: Record<string, unknown>): string {
  return Object.entries(row).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}`).join('\n')
}

export async function runKnowledgeTool(runtime: AgentToolRuntime, name: string, args: Record<string, any>): Promise<ToolResult> {
  const { files, table_ids } = runtime.outputConfig.knowledge
  if (files.length === 0 && table_ids.length === 0) throw new AgentToolError('This agent has no knowledge sources', 403)

  if (name === 'read_knowledge_document') {
    const wanted = String(args.name ?? '').trim()
    const file = files.find((f) => f.name === wanted) ?? files.find((f) => f.name.toLowerCase() === wanted.toLowerCase())
    if (!file) return { error: `No knowledge document "${wanted}"`, documents: files.map((f) => f.name) }
    const text = await documentText(runtime, file)
    return { name: file.name, text: text.slice(0, 60_000), truncated: text.length > 60_000, characters: text.length }
  }

  if (name !== 'search_knowledge') throw new AgentToolError(`Unknown knowledge tool: ${name}`)
  const query = String(args.query ?? '').trim()
  if (!query) throw new AgentToolError('query is required')
  const limit = Math.max(1, Math.min(Number.isFinite(Number(args.limit)) ? Math.floor(Number(args.limit)) : 5, 20))

  const docs: KnowledgeDoc[] = []
  const problems: string[] = []
  for (const file of files) {
    try {
      const text = await documentText(runtime, file)
      splitPassages(text).forEach((passage, index) => docs.push({ source: file.name, kind: 'document', text: passage, ref: { passage: index + 1 } }))
    } catch (error) {
      problems.push(`${file.name}: ${error instanceof Error ? error.message : 'unreadable'}`)
    }
  }
  if (table_ids.length) {
    const db = runtime.db() as any
    const { data: tables } = await db.from('custom_tables').select('id, name').eq('tenant_id', runtime.tenantId).in('id', table_ids)
    for (const table of tables ?? []) {
      const { data: rows } = await db.from('custom_table_rows').select('id, data').eq('tenant_id', runtime.tenantId).eq('table_id', table.id)
        .order('updated_at', { ascending: false }).limit(MAX_ROWS_PER_TABLE)
      for (const row of rows ?? []) {
        docs.push({ source: `table:${table.name}`, kind: 'table_row', text: rowText(row.data ?? {}), ref: { row_id: row.id, row: row.data } })
      }
    }
  }

  const ranked = rankBm25(query, docs, limit)
  return {
    query,
    results: ranked.map((r) => ({
      source: r.source,
      kind: r.kind,
      score: Math.round(r.score * 100) / 100,
      ...(r.kind === 'document' ? { passage: (r.ref as any)?.passage, text: r.text } : { row_id: (r.ref as any)?.row_id, row: (r.ref as any)?.row }),
    })),
    searched: { documents: files.length, tables: table_ids.length, passages: docs.length },
    ...(problems.length ? { problems } : {}),
    ...(ranked.length === 0 ? { note: 'Nothing matched — try other keywords.' } : {}),
  }
}
