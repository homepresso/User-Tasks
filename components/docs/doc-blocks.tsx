import Image from 'next/image'
import { AlertTriangle, Info, Lightbulb, Link2 } from 'lucide-react'
import type { DocBlock, DocListItem } from '@/lib/docs/markdown'
import { SCREENSHOTS } from '@/lib/docs/screenshots'
import { getTopology } from '@/lib/topologies'
import { TopologyDiagram } from '@/components/topology/topology-diagram'
import type { ScreenshotName } from '@/lib/docs/screenshot-names'
import { CopyButton } from './copy-button'
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
        ? 'mt-12 border-t border-[#1B1916]/[0.07] pt-8 text-2xl'
        : block.level === 3 ? 'mt-8 text-lg' : 'mt-6 text-base'
      return (
        <Tag id={block.id} className={`group scroll-mt-24 font-semibold tracking-tight text-[#1B1916] ${block.level === 2 ? 'font-[family-name:var(--font-display)]' : ''} ${size}`}>
          <Inline text={block.text} />
          <a href={`#${block.id}`} aria-label="Link to this section" className="ml-2 inline-block align-middle text-[#8A6D45] opacity-0 transition group-hover:opacity-100">
            <Link2 size={14} aria-hidden="true" />
          </a>
        </Tag>
      )
    }
    case 'paragraph':
      return <p className="mt-4 leading-7 text-[#3D3932]"><Inline text={block.text} /></p>
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag start={block.start} className={`mt-4 space-y-2 pl-6 leading-7 text-[#3D3932] ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-[#B08A54]`}>
          {block.items.map((item, index) => <ListItem key={index} item={item} />)}
        </Tag>
      )
    }
    case 'code':
      return <CodeBlock code={block.code} lang={block.lang} title={block.title} />
    case 'table':
      return (
        <div className="mt-5 overflow-x-auto rounded-xl border border-[#1B1916]/[0.09]">
          <table className="w-full border-collapse text-left text-sm">
            {block.head.some(Boolean) && (
              <thead className="bg-[#F1EDE3]">
                <tr>{block.head.map((cell, index) => <th key={index} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold text-[#1B1916]"><Inline text={cell} /></th>)}</tr>
              </thead>
            )}
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-[#1B1916]/[0.06] align-top odd:bg-[#FFFFFF]/70 even:bg-[#FAF8F3]">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={`px-3 py-2 leading-6 text-[#3D3932] ${cellIndex === 0 && !block.head[0] ? 'whitespace-nowrap font-medium text-[#1B1916]' : ''}`}><Inline text={cell} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'callout': {
      const tone = {
        note: { Icon: Info, className: 'border-[#8A6D45]/25 bg-[#B08A54]/[0.07]', label: 'Note' },
        tip: { Icon: Lightbulb, className: 'border-[#4F7A5B]/25 bg-[#4F7A5B]/[0.07]', label: 'Tip' },
        warning: { Icon: AlertTriangle, className: 'border-[#B23A2E]/25 bg-[#B23A2E]/[0.06]', label: 'Warning' },
      }[block.tone]
      return (
        <div className={`mt-5 flex gap-3 rounded-xl border p-4 text-sm leading-6 text-[#3D3932] ${tone.className}`} role="note">
          <tone.Icon size={18} className="mt-0.5 shrink-0 text-[#8A6D45]" aria-label={tone.label} />
          <div className="space-y-2">{block.text.split('\n\n').map((para, index) => <p key={index}><Inline text={para} /></p>)}</div>
        </div>
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
    <div className="mt-5 overflow-hidden rounded-xl border border-[#1B1916]/20 bg-[#1C1A16] shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-1.5">
        <span className="truncate font-mono text-xs text-[#B9B2A3]">{title ?? lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6 text-[#EDE8DC]"><code className="font-mono">{code}</code></pre>
    </div>
  )
}

export function Screenshot({ name, alt, caption, priority = false }: { name: ScreenshotName; alt: string; caption?: string; priority?: boolean }) {
  const image = SCREENSHOTS[name]
  return (
    <figure className="mt-6">
      <div className="overflow-hidden rounded-xl border border-[#1B1916]/10 bg-[#FFFFFF] shadow-[0_8px_30px_rgba(27,25,22,0.08)]">
        <Image src={image} alt={alt} sizes="(min-width: 1280px) 768px, (min-width: 1024px) 60vw, 100vw" placeholder="blur" priority={priority} className="h-auto w-full" />
      </div>
      {caption && <figcaption className="mt-2 text-center text-sm text-[#6E6759]"><Inline text={caption} /></figcaption>}
    </figure>
  )
}
