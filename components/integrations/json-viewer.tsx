'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'

/**
 * Read-only JSON viewer for test responses and request previews: mono 12px
 * with line numbers in an inset well, collapsible, with a copy button.
 */
export function JsonViewer({
  value,
  title = 'Response',
  meta,
  defaultOpen = true,
  maxHeightClass = 'max-h-80',
  className,
}: {
  value: unknown
  title?: string
  /** Shown after the title (status code, timing). */
  meta?: React.ReactNode
  defaultOpen?: boolean
  maxHeightClass?: string
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => {
    if (typeof value === 'string') return value
    try { return JSON.stringify(value, null, 2) ?? '' } catch { return String(value) }
  }, [value])
  const lines = text.split('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className={cn('overflow-hidden rounded-md border border-border-subtle bg-subtle', className)}>
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-fg"
        >
          {open ? <ChevronDown className="size-3.5 text-fg-muted" aria-hidden="true" /> : <ChevronRight className="size-3.5 text-fg-muted" aria-hidden="true" />}
          {title}
          {meta != null && <span className="ml-1 inline-flex items-center gap-1.5 font-normal text-fg-muted">{meta}</span>}
          <span className="num ml-auto font-normal text-fg-muted">{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
        </button>
        <IconButton size="sm" label={copied ? 'Copied' : 'Copy'} icon={copied ? <Check /> : <Copy />} onClick={() => void copy()} />
      </div>
      {open && (
        <div className={cn('overflow-auto border-t border-border-subtle font-mono text-xs leading-5', maxHeightClass)}>
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td className="num w-px select-none whitespace-nowrap border-r border-border-subtle px-2 text-right align-top text-fg-subtle" aria-hidden="true">{i + 1}</td>
                  <td className="whitespace-pre px-3 text-fg">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
