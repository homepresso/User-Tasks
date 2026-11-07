import Image from 'next/image'
import { Link2 } from 'lucide-react'
import type { DocBlock, DocListItem } from '@/lib/docs/markdown'
import { SCREENSHOTS } from '@/lib/docs/screenshots'
import { getTopology } from '@/lib/topologies'
import { TopologyDiagram } from '@/components/topology/topology-diagram'
import type { ScreenshotName } from '@/lib/docs/screenshot-names'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ScreenshotFrame } from '@/components/marketing/screenshot-frame'
import { CopyButton, LanguageTag } from './copy-button'
import { Inline } from './inline'

/** Renders expanded docs blocks (lib/docs/render.ts) as the article body. */
export function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return <>{blocks.map((block, index) => <Block key={index} block={block} />)}</>
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h2' | 'h3' | 'h4'
      const size = block.level === 2
        ? 'mt-12 border-t border-(color:--mkt-ink)/[0.07] pt-8 text-2xl'
        : block.level === 3 ? 'mt-8 text-lg' : 'mt-6 text-base'
      return (
        <Tag id={block.id} className={`group scroll-mt-24 font-semibold tracking-tight text-(color:--mkt-ink) ${block.level === 2 ? 'font-display' : ''} ${size}`}>
          <Inline text={block.text} />
          <a href={`#${block.id}`} aria-label="Link to this section" className="ml-2 inline-block align-middle text-(color:--mkt-bronze) opacity-0 transition group-hover:opacity-100">
            <Link2 size={14} aria-hidden="true" />
          </a>
        </Tag>
      )
    }
    case 'paragraph':
      return <p className="mt-4 leading-7 text-(color:--mkt-prose)"><Inline text={block.text} /></p>
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag start={block.start} className={`mt-4 space-y-2 pl-6 leading-7 text-(color:--mkt-prose) ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-(color:--mkt-gold)`}>
          {block.items.map((item, index) => <ListItem key={index} item={item} />)}
        </Tag>
      )
    }
    case 'code':
      return <CodeBlock code={block.code} lang={block.lang} title={block.title} />
    case 'table':
      return (
        <div className="mt-5 overflow-x-auto rounded-xl border border-(color:--mkt-ink)/[0.09]">
          <table className="w-full border-collapse text-left text-sm">
            {block.head.some(Boolean) && (
              <thead className="bg-(color:--mkt-sand)">
                <tr>{block.head.map((cell, index) => <th key={index} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold text-(color:--mkt-ink)"><Inline text={cell} /></th>)}</tr>
              </thead>
            )}
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-(color:--mkt-ink)/[0.06] align-top odd:bg-(color:--mkt-white)/70 even:bg-(color:--mkt-paper)">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={`px-3 py-2 leading-6 text-(color:--mkt-prose) ${cellIndex === 0 && !block.head[0] ? 'whitespace-nowrap font-medium text-(color:--mkt-ink)' : ''}`}><Inline text={cell} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'callout': {
      // Callouts use the InlineNotice tones: note = info, tip = success, warning = warning.
      const tone = ({ note: 'info', tip: 'success', warning: 'warning' } as const)[block.tone]
      const label = ({ note: 'Note', tip: 'Tip', warning: 'Warning' } as const)[block.tone]
      return (
        <InlineNotice tone={tone} className="mt-5 px-4 py-3 text-sm leading-6">
          <div className="space-y-2">
            {block.text.split('\n\n').map((para, index) => (
              <p key={index}>{index === 0 && <span className="sr-only">{label}: </span>}<Inline text={para} /></p>
            ))}
          </div>
        </InlineNotice>
      )
    }
    case 'directive':
      if (block.name === 'image') return <Screenshot name={block.args[0] as ScreenshotName} alt={block.args[1] ?? ''} caption={block.args[2]} />
      if (block.name === 'topology') {
        const topology = getTopology(block.args[0])
        return topology ? <TopologyDiagram topology={topology} className="mt-6 block" /> : null
      }
      return null
  }
}

function ListItem({ item }: { item: DocListItem }) {
  return (
    <li>
      <Inline text={item.text} />
      {item.items && (
        <ul className="mt-2 list-[circle] space-y-1 pl-6">
          {item.items.map((child, index) => <ListItem key={index} item={child} />)}
        </ul>
      )}
    </li>
  )
}

export function CodeBlock({ code, lang, title }: { code: string; lang: string; title?: string }) {
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-(color:--mkt-ink)/20 bg-(color:--mkt-code-bg)">
      <div className="flex items-center justify-between gap-3 border-b border-(color:--mkt-white)/[0.08] py-1.5 pl-4 pr-2">
        <span className="truncate font-mono text-xs text-(color:--mkt-faint)">{title ?? ''}</span>
        <div className="flex shrink-0 items-center gap-1"><LanguageTag lang={lang} /><CopyButton text={code} /></div>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-ui leading-6 text-(color:--mkt-code-text)"><code className="font-mono">{code}</code></pre>
    </div>
  )
}

export function Screenshot({ name, alt, caption, priority = false }: { name: ScreenshotName; alt: string; caption?: string; priority?: boolean }) {
  const image = SCREENSHOTS[name]
  return (
    <figure className="mt-6">
      <ScreenshotFrame>
        <Image src={image} alt={alt} sizes="(min-width: 1280px) 720px, (min-width: 1024px) 60vw, 100vw" placeholder="blur" priority={priority} className="h-auto w-full" />
      </ScreenshotFrame>
      {caption && <figcaption className="mt-2 text-center text-sm text-(color:--mkt-muted)"><Inline text={caption} /></figcaption>}
    </figure>
  )
}
