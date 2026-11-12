import Image from 'next/image'
import { FileCode2, Info, Lightbulb, OctagonAlert, Terminal, TriangleAlert } from 'lucide-react'
import type { DocBlock, DocListItem } from '@/lib/docs/markdown'
import { stripInline } from '@/lib/docs/markdown'
import { highlight, isShellLanguage, languageLabel } from '@/lib/docs/highlight'
import { SCREENSHOTS } from '@/lib/docs/screenshots'
import { getTopology } from '@/lib/topologies'
import { TopologyDiagram } from '@/components/topology/topology-diagram'
import type { ScreenshotName } from '@/lib/docs/screenshot-names'
import { ScreenshotFrame } from '@/components/marketing/screenshot-frame'
import { CopyButton, LanguageTag } from './copy-button'
import { Inline } from './inline'

/** Renders expanded docs blocks (lib/docs/render.ts) as the article body. */
export function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return <>{blocks.map((block, index) => <Block key={index} block={block} />)}</>
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'heading':
      return <Heading level={block.level} id={block.id} text={block.text} />
    case 'paragraph':
      return <p className="mt-5 text-[1.0625rem] leading-[1.8] text-(color:--mkt-prose)"><Inline text={block.text} /></p>
    case 'list':
      return <List block={block} />
    case 'code':
      return <CodeBlock code={block.code} lang={block.lang} title={block.title} />
    case 'table':
      return <Table head={block.head} rows={block.rows} />
    case 'callout':
      return <Callout tone={block.tone} text={block.text} />
    case 'directive':
      if (block.name === 'image') return <Screenshot name={block.args[0] as ScreenshotName} alt={block.args[1] ?? ''} caption={block.args[2]} />
      if (block.name === 'topology') {
        const topology = getTopology(block.args[0])
        return topology ? <TopologyDiagram topology={topology} className="mt-8 block" /> : null
      }
      return null
  }
}

const HEADING_STYLE: Record<2 | 3 | 4, string> = {
  2: 'mt-14 border-t border-(color:--mkt-ink)/[0.07] pt-10 font-display text-[1.65rem] font-semibold leading-tight tracking-[-0.01em]',
  3: 'mt-10 text-[1.2rem] font-semibold leading-snug tracking-[-0.01em]',
  4: 'mt-8 text-base font-semibold',
}

/** Section heading with a "#" anchor (hover or focus); the article enhancer copies its link on click. */
export function Heading({ level, id, text }: { level: 2 | 3 | 4; id: string; text: string }) {
  const Tag = `h${level}` as 'h2' | 'h3' | 'h4'
  return (
    <Tag id={id} className={`group relative scroll-mt-24 text-(color:--mkt-ink) ${HEADING_STYLE[level]}`}>
      <Inline text={text} />
      <a
        href={`#${id}`}
        data-docs-anchor=""
        aria-label={`Link to section: ${stripInline(text)}`}
        title="Copy link to this section"
        className="ml-2 inline-block rounded px-1 align-baseline font-sans text-[0.8em] font-medium text-(color:--mkt-bronze) no-underline opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 sm:absolute sm:-left-7 sm:ml-0"
      >
        #
      </a>
    </Tag>
  )
}

function List({ block }: { block: Extract<DocBlock, { kind: 'list' }> }) {
  // Ordered lists are steps: numbered circles joined by a line (docs.css .docs-steps).
  if (block.ordered) {
    return (
      <ol
        start={block.start}
        className="docs-steps mt-6 space-y-4 leading-[1.75] text-(color:--mkt-prose)"
        style={block.start ? ({ '--docs-step-start': block.start - 1 } as React.CSSProperties) : undefined}
      >
        {block.items.map((item, index) => <ListItem key={index} item={item} />)}
      </ol>
    )
  }
  return (
    <ul className="mt-5 space-y-2.5 pl-6 leading-[1.75] text-(color:--mkt-prose) marker:text-(color:--mkt-gold) list-disc">
      {block.items.map((item, index) => <ListItem key={index} item={item} />)}
    </ul>
  )
}

function ListItem({ item }: { item: DocListItem }) {
  return (
    <li className="pl-1">
      <Inline text={item.text} />
      {item.items && (
        <ul className="mt-2 list-[circle] space-y-1.5 pl-6 marker:text-(color:--mkt-subtle)">
          {item.items.map((child, index) => <ListItem key={index} item={child} />)}
        </ul>
      )}
    </li>
  )
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  const label = head.some(Boolean) ? `Table: ${head.map(stripInline).filter(Boolean).join(', ')}` : 'Table'
  return (
    <div role="region" aria-label={label} tabIndex={0} className="docs-scroll mt-6 overflow-x-auto rounded-xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) shadow-[0_1px_2px_rgba(27,25,22,0.04)]">
      <table className="w-full border-collapse text-left text-sm">
        {head.some(Boolean) && (
          <thead className="bg-(color:--mkt-sand)">
            <tr>{head.map((cell, index) => <th key={index} scope="col" className="whitespace-nowrap border-b border-(color:--mkt-ink)/[0.08] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-(color:--mkt-ink-soft)"><Inline text={cell} /></th>)}</tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-(color:--mkt-ink)/[0.06] align-top transition-colors first:border-t-0 even:bg-(color:--mkt-ink)/[0.025] hover:bg-(color:--mkt-bronze)/[0.05]">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`px-4 py-2.5 leading-6 text-(color:--mkt-prose) ${cellIndex === 0 && !head[0] ? 'whitespace-nowrap font-medium text-(color:--mkt-ink)' : ''}`}><Inline text={cell} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const CALLOUTS = {
  note: { label: 'Note', icon: Info },
  tip: { label: 'Tip', icon: Lightbulb },
  warning: { label: 'Warning', icon: TriangleAlert },
  danger: { label: 'Danger', icon: OctagonAlert },
} as const

/** Note / tip / warning / danger callout with an icon and a visible label. */
export function Callout({ tone, text }: { tone: keyof typeof CALLOUTS; text: string }) {
  const { label, icon: Icon } = CALLOUTS[tone]
  return (
    <aside
      aria-label={label}
      data-callout={tone}
      className="mt-6 flex gap-3 rounded-xl border border-l-[3px] px-4 py-3.5 text-[0.95rem] leading-7"
      style={{ borderColor: `color-mix(in srgb, var(--docs-callout-${tone}) 28%, transparent)`, borderLeftColor: `var(--docs-callout-${tone})`, background: `var(--docs-callout-${tone}-bg)` }}
    >
      <Icon size={18} aria-hidden="true" className="mt-1 shrink-0" style={{ color: `var(--docs-callout-${tone})` }} />
      <div className="min-w-0 space-y-2 text-(color:--mkt-prose)">
        {text.split('\n\n').map((para, index) => (
          <p key={index}>
            {index === 0 && <strong className="mr-1.5 font-semibold" style={{ color: `var(--docs-callout-${tone})` }}>{label}.</strong>}
            <Inline text={para} />
          </p>
        ))}
      </div>
    </aside>
  )
}

/** Code well: title or language, copy, build-time highlighting, wrapping on small screens. */
export function CodeBlock({ code, lang, title }: { code: string; lang: string; title?: string }) {
  const tokens = highlight(code, lang)
  const shell = isShellLanguage(lang)
  const HeaderIcon = title ? FileCode2 : shell ? Terminal : null
  const label = title ?? (lang && lang !== 'text' ? languageLabel(lang) : '')
  return (
    <figure data-code-lang={lang} className="docs-code group/code mt-6 overflow-hidden rounded-xl border border-black/30 bg-(color:--mkt-code-bg) shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_10px_30px_-18px_rgba(16,14,11,0.6)]">
      <figcaption className="flex min-h-10 items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.025)] py-1.5 pl-4 pr-2">
        <span className="flex min-w-0 items-center gap-2 font-mono text-xs text-[#C9BFAE]">
          {HeaderIcon && <HeaderIcon size={13} aria-hidden="true" className="shrink-0 text-[#E8B266]" />}
          <span className="truncate">{label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {title && <LanguageTag lang={lang === 'text' ? undefined : languageLabel(lang)} />}
          <CopyButton text={code} />
        </span>
      </figcaption>
      <pre className="docs-scroll overflow-x-auto px-4 py-3.5 font-mono text-[0.8125rem] leading-6 text-(color:--mkt-code-text) max-sm:whitespace-pre-wrap max-sm:[overflow-wrap:anywhere]">
        <code className="font-mono">
          {tokens.map((token, index) => (token.kind ? <span key={index} className={`docs-tok-${token.kind}`}>{token.text}</span> : token.text))}
        </code>
      </pre>
    </figure>
  )
}

export function Screenshot({ name, alt, caption, priority = false }: { name: ScreenshotName; alt: string; caption?: string; priority?: boolean }) {
  const image = SCREENSHOTS[name]
  return (
    <figure className="mt-8">
      <ScreenshotFrame>
        <Image src={image} alt={alt} sizes="(min-width: 1280px) 760px, (min-width: 1024px) 60vw, 100vw" placeholder="blur" priority={priority} className="h-auto w-full" />
      </ScreenshotFrame>
      {caption && <figcaption className="mt-3 text-center text-sm text-(color:--mkt-muted)"><Inline text={caption} /></figcaption>}
    </figure>
  )
}
