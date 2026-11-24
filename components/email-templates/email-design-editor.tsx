'use client'

/**
 * The Design tab: a simple block editor for email-safe layouts (header /
 * logo, heading, rich text, button, image, divider, spacer, two columns,
 * footer) plus colours and width. Every change regenerates the HTML
 * (lib/email-editor/blocks.ts designToHtml) — the HTML tab stays the source
 * of truth. When the HTML has been edited beyond what blocks represent, the
 * tab shows a read-only notice with the option to start a new design.
 */

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Bold, Columns2, Copy, Heading, Image as ImageIcon, Italic, LayoutTemplate, Link as LinkIcon, List, ListOrdered, Minus, MousePointerClick, PanelBottom, Plus, Space, Trash2, Type, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { InlineNotice } from '@/components/ui/inline-notice'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { newBlock, newBlockId, sanitizeRichText, type DesignBlock, type DesignBlockType, type DesignSettings, type EmailDesign } from '@/lib/email-editor/blocks'
import { cn } from '@/lib/utils'

/** Something a variable can be inserted into (the last focused field). */
export interface InsertTarget { insert(text: string): void }

export interface EmailDesignEditorProps {
  design: EmailDesign | null
  /** The HTML is still what the design generates. */
  editable: boolean
  onChange(design: EmailDesign): void
  /** Replace the HTML with a new (or the last) design. */
  onStartDesign(design: EmailDesign | null): void
  onFocusTarget(target: InsertTarget | null): void
}

const BLOCK_TYPES: Array<{ type: DesignBlockType; label: string; icon: React.ReactNode }> = [
  { type: 'header', label: 'Header / logo', icon: <LayoutTemplate /> },
  { type: 'heading', label: 'Heading', icon: <Heading /> },
  { type: 'text', label: 'Text', icon: <Type /> },
  { type: 'button', label: 'Button', icon: <MousePointerClick /> },
  { type: 'image', label: 'Image', icon: <ImageIcon /> },
  { type: 'columns', label: 'Two columns', icon: <Columns2 /> },
  { type: 'divider', label: 'Divider', icon: <Minus /> },
  { type: 'spacer', label: 'Spacer', icon: <Space /> },
  { type: 'footer', label: 'Footer', icon: <PanelBottom /> },
]

const labelOf = (type: DesignBlockType) => BLOCK_TYPES.find((b) => b.type === type)?.label ?? type

function summary(block: DesignBlock): string {
  const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  switch (block.type) {
    case 'header': return block.logoUrl ? 'Logo' : block.wordmark ?? ''
    case 'heading': return block.text
    case 'text': case 'footer': return strip(block.html)
    case 'button': return `${block.label} → ${block.url}`
    case 'image': return block.alt || block.src
    case 'columns': return `${strip(block.left)} | ${strip(block.right)}`
    case 'spacer': return `${block.height ?? 24}px`
    default: return ''
  }
}

/** A text input that registers itself as the variable insert target while focused. */
function TargetInput({ value, onChange, onFocusTarget, ...rest }: Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value'> & { value: string; onChange(v: string): void; onFocusTarget(t: InsertTarget | null): void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <Input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => onFocusTarget({
        insert(text) {
          const el = ref.current
          if (!el) return
          const start = el.selectionStart ?? el.value.length
          const end = el.selectionEnd ?? start
          onChange(el.value.slice(0, start) + text + el.value.slice(end))
          requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length) })
        },
      })}
      {...rest}
    />
  )
}

/** A small rich-text field (bold, italic, underline, link, lists) storing sanitised HTML. */
function RichTextField({ value, onChange, onFocusTarget, label, minRows = 3 }: { value: string; onChange(html: string): void; onFocusTarget(t: InsertTarget | null): void; label: string; minRows?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const lastValue = useRef(value)
  const savedRange = useRef<Range | null>(null)
  useEffect(() => {
    if (ref.current && value !== lastValue.current) {
      ref.current.innerHTML = value
      lastValue.current = value
    }
  }, [value])
  useEffect(() => { if (ref.current) ref.current.innerHTML = value }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const emit = () => {
    const html = sanitizeRichText(ref.current?.innerHTML ?? '')
    lastValue.current = html
    onChange(html)
  }
  const saveRange = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange()
  }
  const restoreRange = () => {
    const sel = window.getSelection()
    ref.current?.focus()
    if (sel && savedRange.current) { sel.removeAllRanges(); sel.addRange(savedRange.current) }
  }
  const exec = (command: string, arg?: string) => {
    restoreRange()
    document.execCommand(command, false, arg)
    emit()
  }
  return (
    <div className="rounded-md border border-input-border bg-input focus-within:ring-2 focus-within:ring-focus/40">
      <div className="flex items-center gap-0.5 border-b border-border-subtle px-1 py-0.5" role="toolbar" aria-label={`${label} formatting`}>
        <IconButton size="sm" label="Bold" icon={<Bold />} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} />
        <IconButton size="sm" label="Italic" icon={<Italic />} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} />
        <IconButton size="sm" label="Underline" icon={<Underline />} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} />
        <IconButton size="sm" label="Link" icon={<LinkIcon />} onMouseDown={(e) => e.preventDefault()} onClick={() => {
          const url = window.prompt('Link address (https://…, mailto:… or {{variable}})', 'https://')
          if (url) exec('createLink', url.trim())
        }} />
        <IconButton size="sm" label="Bulleted list" icon={<List />} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} />
        <IconButton size="sm" label="Numbered list" icon={<ListOrdered />} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} />
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        className="prose-sm max-w-none px-2.5 py-2 text-ui text-fg outline-none [&_a]:text-primary-text [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
        style={{ minHeight: `${minRows * 1.6}em` }}
        onInput={emit}
        onBlur={() => { saveRange(); emit() }}
        onKeyUp={saveRange}
        onMouseUp={saveRange}
        onFocus={() => onFocusTarget({ insert(text) { restoreRange(); document.execCommand('insertText', false, text); emit() } })}
        data-rich-text={label}
      />
    </div>
  )
}

function BlockInspector({ block, onChange, onFocusTarget }: { block: DesignBlock; onChange(block: DesignBlock): void; onFocusTarget(t: InsertTarget | null): void }) {
  const field = (label: string, control: React.ReactNode) => (
    <label className="block space-y-1"><span className="block text-xs font-medium text-fg">{label}</span>{control}</label>
  )
  switch (block.type) {
    case 'header':
      return <div className="space-y-3">
        {field('Logo image URL (https)', <TargetInput value={block.logoUrl ?? ''} onChange={(v) => onChange({ ...block, logoUrl: v || undefined })} onFocusTarget={onFocusTarget} placeholder="https://… (leave blank to show the name)" />)}
        {field('Name / wordmark', <TargetInput value={block.wordmark ?? ''} onChange={(v) => onChange({ ...block, wordmark: v })} onFocusTarget={onFocusTarget} />)}
        {field('Alignment', <Select value={block.align ?? 'left'} onChange={(e) => onChange({ ...block, align: e.target.value as 'left' | 'center' })}><option value="left">Left</option><option value="center">Centre</option></Select>)}
      </div>
    case 'heading':
      return <div className="space-y-3">
        {field('Text', <TargetInput value={block.text} onChange={(v) => onChange({ ...block, text: v })} onFocusTarget={onFocusTarget} />)}
        {field('Size', <Select value={String(block.level ?? 1)} onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 1 | 2 | 3 })}><option value="1">Large</option><option value="2">Medium</option><option value="3">Small</option></Select>)}
      </div>
    case 'text':
      return <RichTextField label="Text" value={block.html} onChange={(html) => onChange({ ...block, html })} onFocusTarget={onFocusTarget} minRows={5} />
    case 'footer':
      return <RichTextField label="Footer" value={block.html} onChange={(html) => onChange({ ...block, html })} onFocusTarget={onFocusTarget} />
    case 'button':
      return <div className="space-y-3">
        {field('Label', <TargetInput value={block.label} onChange={(v) => onChange({ ...block, label: v })} onFocusTarget={onFocusTarget} />)}
        {field('Link', <TargetInput value={block.url} onChange={(v) => onChange({ ...block, url: v })} onFocusTarget={onFocusTarget} placeholder="https://… or {{task_url}}" className="font-mono text-xs" />)}
        {field('Alignment', <Select value={block.align ?? 'left'} onChange={(e) => onChange({ ...block, align: e.target.value as 'left' | 'center' })}><option value="left">Left</option><option value="center">Centre</option></Select>)}
      </div>
    case 'image':
      return <div className="space-y-3">
        {field('Image URL (https)', <TargetInput value={block.src} onChange={(v) => onChange({ ...block, src: v })} onFocusTarget={onFocusTarget} className="font-mono text-xs" />)}
        {field('Alt text', <TargetInput value={block.alt ?? ''} onChange={(v) => onChange({ ...block, alt: v })} onFocusTarget={onFocusTarget} placeholder="Describe the image (shown when images are blocked)" />)}
        {field('Width (px)', <Input type="number" min={16} max={656} value={block.width ?? ''} onChange={(e) => onChange({ ...block, width: Number(e.target.value) || undefined })} />)}
        {field('Link (optional)', <TargetInput value={block.href ?? ''} onChange={(v) => onChange({ ...block, href: v || undefined })} onFocusTarget={onFocusTarget} className="font-mono text-xs" />)}
      </div>
    case 'columns':
      return <div className="space-y-3">
        <RichTextField label="Left column" value={block.left} onChange={(html) => onChange({ ...block, left: html })} onFocusTarget={onFocusTarget} />
        <RichTextField label="Right column" value={block.right} onChange={(html) => onChange({ ...block, right: html })} onFocusTarget={onFocusTarget} />
        <p className="text-2xs text-fg-muted">Columns sit side by side on wide screens and stack on phones.</p>
      </div>
    case 'spacer':
      return field('Height (px)', <Input type="number" min={4} max={120} value={block.height ?? 24} onChange={(e) => onChange({ ...block, height: Number(e.target.value) || 24 })} />)
    case 'divider':
      return <p className="text-xs text-fg-muted">A thin horizontal rule.</p>
  }
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-fg">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-7 w-9 cursor-pointer rounded border border-input-border bg-transparent" aria-label={label} />
      <span className="flex-1">{label}</span>
      <code className="text-2xs text-fg-muted">{value}</code>
    </label>
  )
}

export function EmailDesignEditor({ design, editable, onChange, onStartDesign, onFocusTarget }: EmailDesignEditorProps) {
  const [selected, setSelected] = useState<string | null>(design?.blocks[0]?.id ?? null)
  const [showSettings, setShowSettings] = useState(false)

  if (!design || !editable) {
    return (
      <div className="space-y-3 p-4" data-design-readonly="">
        <InlineNotice
          tone="info"
          title={design ? 'The HTML was edited by hand' : 'This template is not a design'}
          message={design
            ? 'It now contains markup the blocks cannot represent, so the Design tab is read-only and the HTML tab is the source of truth. You can go back to the last design (your hand edits are replaced) or keep editing the HTML.'
            : 'It was written as HTML. Keep editing it in the HTML tab, or start a design with blocks — that replaces the current HTML.'}
        />
        <div className="flex flex-wrap gap-2">
          {design && <Button type="button" variant="secondary" onClick={() => onStartDesign(design)}>Restore the last design</Button>}
          <Button type="button" variant="secondary" onClick={() => onStartDesign(null)}>Start a new design</Button>
        </div>
      </div>
    )
  }

  const blocks = design.blocks
  const current = blocks.find((b) => b.id === selected) ?? null
  const setBlocks = (next: DesignBlock[]) => onChange({ ...design, blocks: next })
  const setSettings = (patch: Partial<DesignSettings>) => onChange({ ...design, settings: { ...design.settings, ...patch } })
  const move = (index: number, delta: number) => {
    const next = [...blocks]
    const [b] = next.splice(index, 1)
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, b)
    setBlocks(next)
  }
  const add = (type: DesignBlockType) => {
    const block = newBlock(type)
    const at = current ? blocks.indexOf(current) + 1 : blocks.length
    setBlocks([...blocks.slice(0, at), block, ...blocks.slice(at)])
    setSelected(block.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-design-editor="">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" size="sm" leadingIcon={<Plus />}>Add block</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {BLOCK_TYPES.map((b) => <DropdownMenuItem key={b.type} icon={b.icon} onSelect={() => add(b.type)}>{b.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" size="sm" variant={showSettings ? 'secondary' : 'ghost'} onClick={() => setShowSettings((v) => !v)} aria-pressed={showSettings}>Colours &amp; width</Button>
        <span className="ml-auto text-2xs text-fg-muted">Changes update the HTML</span>
      </div>
      {showSettings && (
        <div className="grid grid-cols-2 gap-2 border-b border-border-subtle bg-subtle px-3 py-2.5" data-design-settings="">
          <ColorField label="Accent (buttons, links)" value={design.settings.accent} onChange={(v) => setSettings({ accent: v })} />
          <ColorField label="Button text" value={design.settings.accentText} onChange={(v) => setSettings({ accentText: v })} />
          <ColorField label="Page background" value={design.settings.background} onChange={(v) => setSettings({ background: v })} />
          <ColorField label="Content background" value={design.settings.content} onChange={(v) => setSettings({ content: v })} />
          <ColorField label="Text" value={design.settings.text} onChange={(v) => setSettings({ text: v })} />
          <ColorField label="Muted text" value={design.settings.muted} onChange={(v) => setSettings({ muted: v })} />
          <label className="col-span-2 flex items-center gap-2 text-xs text-fg">
            <span>Content width</span>
            <input type="range" min={480} max={720} step={20} value={design.settings.width} onChange={(e) => setSettings({ width: Number(e.target.value) })} aria-label="Content width" className="flex-1" />
            <span className="num w-12 text-right text-fg-muted">{design.settings.width}px</span>
          </label>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <ol className="min-h-0 space-y-1 overflow-y-auto border-r border-border-subtle p-2" aria-label="Blocks">
          {blocks.length === 0 && <li className="p-3 text-xs text-fg-muted">No blocks yet — add a header, heading, text and a button to start.</li>}
          {blocks.map((block, index) => (
            <li key={block.id}>
              <div
                role="button"
                tabIndex={0}
                aria-current={block.id === selected ? 'true' : undefined}
                onClick={() => setSelected(block.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(block.id) } }}
                className={cn('group flex items-center gap-1 rounded-md border px-2 py-1.5 text-left', block.id === selected ? 'border-primary bg-primary-wash' : 'border-border-subtle hover:bg-muted')}
                data-block={block.type}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-fg">{labelOf(block.type)}</span>
                  <span className="block truncate text-2xs text-fg-muted">{summary(block)}</span>
                </span>
                <IconButton size="sm" label="Move up" icon={<ArrowUp />} disabled={index === 0} onClick={(e) => { e.stopPropagation(); move(index, -1) }} />
                <IconButton size="sm" label="Move down" icon={<ArrowDown />} disabled={index === blocks.length - 1} onClick={(e) => { e.stopPropagation(); move(index, 1) }} />
                <IconButton size="sm" label="Duplicate" icon={<Copy />} onClick={(e) => { e.stopPropagation(); const copy = { ...block, id: newBlockId() }; setBlocks([...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)]); setSelected(copy.id) }} />
                <IconButton size="sm" variant="danger-ghost" label="Delete block" icon={<Trash2 />} onClick={(e) => { e.stopPropagation(); setBlocks(blocks.filter((b) => b.id !== block.id)); if (selected === block.id) setSelected(null) }} />
              </div>
            </li>
          ))}
        </ol>
        <div className="min-h-0 overflow-y-auto p-3" data-block-inspector="">
          {current
            ? <><p className="mb-2 text-xs font-semibold text-fg">{labelOf(current.type)}</p><BlockInspector key={current.id} block={current} onChange={(b) => setBlocks(blocks.map((x) => (x.id === b.id ? b : x)))} onFocusTarget={onFocusTarget} /></>
            : <p className="text-xs text-fg-muted">Select a block to edit it.</p>}
        </div>
      </div>
    </div>
  )
}
