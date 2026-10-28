import Link from 'next/link'
import type { ReactNode } from 'react'

/** Inline Markdown subset used by the docs: `code`, **bold**, *italic*, [links](href) and <br>. */
const TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(<br>)|(\*[^*\s][^*]*\*)/g

export function Inline({ text }: { text: string }) {
  return <>{renderInline(text, 'i')}</>
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let index = 0
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    const key = `${keyPrefix}-${index++}`
    const [token] = match
    if (match[1]) {
      out.push(<code key={key} className="rounded bg-[#1B1916]/[0.06] px-1.5 py-0.5 font-mono text-[0.85em] text-[#2E2A24]">{token.slice(1, -1)}</code>)
    } else if (match[2]) {
      out.push(<strong key={key} className="font-semibold text-[#1B1916]">{renderInline(token.slice(2, -2), key)}</strong>)
    } else if (match[3]) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      const label = linkMatch?.[1] ?? token
      const href = linkMatch?.[2] ?? '#'
      out.push(<DocLink key={key} href={href}>{renderInline(label, key)}</DocLink>)
    } else if (match[4]) {
      out.push(<br key={key} />)
    } else if (match[5]) {
      out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>)
    }
    last = start + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const LINK_CLASS = 'font-medium text-[#8A6D45] underline decoration-[#8A6D45]/30 underline-offset-2 hover:decoration-[#8A6D45]'

export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  if (/^https?:/.test(href)) {
    return <a href={href} className={LINK_CLASS} target="_blank" rel="noopener noreferrer">{children}</a>
  }
  // App routes (docs, sign-in, contact) navigate client-side; API and download links are plain.
  if (href.startsWith('/api/') || href.startsWith('/downloads/') || href.startsWith('/.well-known/')) {
    return <a href={href} className={LINK_CLASS}>{children}</a>
  }
  return <Link href={href} className={LINK_CLASS}>{children}</Link>
}
