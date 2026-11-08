'use client'

import { useMemo, type ReactNode } from 'react'
import { parseMarkdown, type DocBlock, type DocListItem } from '@/lib/docs/markdown'

/**
 * The assistant's replies as Markdown — a safe subset, rendered as React
 * elements (never HTML): paragraphs, headings, lists, code blocks, tables,
 * `code`, **bold**, *italic* and links (http(s) and same-site paths only,
 * opened in a new tab).
 */

const TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*)/g

function safeHref(href: string): string | null {
  if (/^https?:\/\//i.test(href)) return href
  if (href.startsWith('/') && !href.startsWith('//')) return href
  return null
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    const k = `${key}-${i++}`
    const token = m[0]
    if (m[1]) out.push(<code key={k} className="rounded bg-subtle px-1 py-px font-mono text-[0.85em]">{token.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={k} className="font-semibold">{inline(token.slice(2, -2), k)}</strong>)
    else if (m[3]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      const href = lm ? safeHref(lm[2]) : null
      out.push(href
        ? <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-primary-text underline underline-offset-2">{inline(lm![1], k)}</a>
        : <span key={k}>{lm?.[1] ?? token}</span>)
    } else if (m[4]) out.push(<em key={k}>{inline(token.slice(1, -1), k)}</em>)
    last = start + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function List({ items, ordered, k }: { items: DocListItem[]; ordered: boolean; k: string }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={ordered ? 'list-decimal space-y-0.5 pl-5' : 'list-disc space-y-0.5 pl-5'}>
      {items.map((item, i) => (
        <li key={`${k}-${i}`}>
          {inline(item.text, `${k}-${i}`)}
          {item.items?.length ? <List items={item.items} ordered={false} k={`${k}-${i}-s`} /> : null}
        </li>
      ))}
    </Tag>
  )
}

function Block({ block, k }: { block: DocBlock; k: string }) {
  switch (block.kind) {
    case 'heading': return <p className="font-semibold">{inline(block.text, k)}</p>
    case 'paragraph': return <p className="whitespace-pre-wrap">{inline(block.text, k)}</p>
    case 'list': return <List items={block.items} ordered={block.ordered} k={k} />
    case 'code': return <pre className="overflow-x-auto rounded-md bg-subtle p-2 font-mono text-2xs"><code>{block.code}</code></pre>
    case 'callout': return <p className="border-l-2 border-border pl-2 text-fg-muted">{inline(block.text, k)}</p>
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="text-2xs">
            <thead><tr>{block.head.map((h, i) => <th key={i} className="border-b border-border px-1.5 py-1 text-left font-semibold">{inline(h, `${k}-h${i}`)}</th>)}</tr></thead>
            <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((c, i) => <td key={i} className="border-b border-border-subtle px-1.5 py-1 align-top">{inline(c, `${k}-${r}-${i}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
    default: return null
  }
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => {
    try { return parseMarkdown(text).filter((b) => b.kind !== 'directive') } catch { return [{ kind: 'paragraph', text } as DocBlock] }
  }, [text])
  return <div className="space-y-2 break-words">{blocks.map((b, i) => <Block key={i} block={b} k={`b${i}`} />)}</div>
}
