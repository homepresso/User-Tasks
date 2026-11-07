'use client'

import { useState, useMemo } from 'react'
import { X, Search, Copy, Check, ChevronDown, ChevronRight, Sparkles, Type, Calendar, Calculator, GitBranch, ArrowUpDown, ListTree, Regex, Database, Paperclip } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { FUNCTION_CATALOG, FUNCTION_CATEGORIES } from '@/lib/expression-functions'
import { useActiveInput } from './active-input'

const categoryIcons: Record<string, any> = {
  Type, Calendar, Calculator, GitBranch, ArrowUpDown, ListTree, Regex, Database, Paperclip,
}

interface ExpressionsPanelProps {
  open: boolean
  onClose: () => void
  className?: string
  /**
   * Fill the parent (e.g. an inspector tab) instead of floating over the
   * canvas: no absolute positioning, no frame and no close button.
   */
  embedded?: boolean
}

export function ExpressionsPanel({ open, onClose, className, embedded = false }: ExpressionsPanelProps) {
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<string | null>('text')
  const [expandedFn, setExpandedFn] = useState<string | null>(null)
  const { insertIntoActive } = useActiveInput()

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return FUNCTION_CATEGORIES.map(cat => ({
      ...cat,
      functions: FUNCTION_CATALOG
        .filter(fn => fn.category === cat.id)
        .filter(fn => !q || fn.name.toLowerCase().includes(q) || fn.description.toLowerCase().includes(q)),
    })).filter(cat => cat.functions.length > 0)
  }, [search])

  // Insert quoted placeholder args ("text", "length") rather than bare identifiers —
  // bare names silently evaluate against scope (or to 0/""), which reads as data
  // corruption when the user forgets to replace them. Quoted placeholders render
  // as literal text the user can see and swap.
  function expressionSnippet(fn: typeof FUNCTION_CATALOG[0]) {
    const argStr = fn.args.map(a => a.type.endsWith('...') ? '"…"' : `"${a.name}"`).join(', ')
    return `{{=${fn.name}(${argStr})}}`
  }

  function copyExpression(fn: typeof FUNCTION_CATALOG[0]) {
    const expr = expressionSnippet(fn)
    // Insert into the focused field if there is one; otherwise fall back to clipboard.
    if (!insertIntoActive(expr)) navigator.clipboard.writeText(expr)
    setCopied(fn.name)
    setTimeout(() => setCopied(null), 1500)
  }

  if (!open) return null

  return (
    <div
      className={embedded
        ? cn('flex h-full min-h-0 flex-col text-fg', className)
        : className ?? 'absolute top-14 right-3 z-30 w-[min(24rem,calc(100vw-2rem))] max-h-[480px] flex flex-col rounded-lg border border-border bg-elevated text-fg shadow-elev-2 overflow-hidden'}
      data-embedded={embedded ? '' : undefined}
    >
      {/* Header */}
      <div className={cn('flex items-center justify-between gap-2 px-3 shrink-0 border-b border-border-subtle', embedded ? 'py-2' : 'py-1.5')}>
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles size={16} className="shrink-0 text-primary-text" aria-hidden="true" />
          <span className="text-ui font-semibold">Expressions</span>
          <span className="num text-2xs font-medium px-1.5 py-0.5 rounded-full bg-subtle text-fg-muted">
            {FUNCTION_CATALOG.length} functions
          </span>
        </div>
        {!embedded && (
          <IconButton type="button" size="sm" onClick={onClose} label="Close expressions" icon={<X />} />
        )}
      </div>

      {/* Search */}
      <div className="px-3 py-2 shrink-0 border-b border-border-subtle">
        <Input
          size="sm"
          leading={<Search />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search functions…"
          aria-label="Search functions"
        />
      </div>

      {/* Usage hint */}
      <div className="px-3 py-1.5 shrink-0 text-xs text-fg-muted border-b border-border-subtle bg-subtle">
        Use in any field: <code className="font-mono text-2xs px-1 py-0.5 rounded-sm bg-panel text-primary-text">{'{{=FUNCTION(args)}}'}</code>
        &nbsp;· Nestable · Variables work inside args
      </div>

      {/* Category list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {filtered.length === 0 ? (
          <p className="text-xs text-fg-muted text-center py-4">
            No functions matching &ldquo;{search}&rdquo;
          </p>
        ) : (
          filtered.map(cat => {
            const isExpanded = search.length > 0 || expandedCategory === cat.id
            const Icon = categoryIcons[cat.icon] ?? Sparkles
            return (
              <div key={cat.id}>
                <button
                  type="button"
                  onClick={() => setExpandedCategory(isExpanded && !search ? null : cat.id)}
                  aria-expanded={isExpanded}
                  className={cn('flex items-center gap-2 w-full h-8 text-left px-2 rounded-md text-ui font-medium text-fg transition-colors hover:bg-subtle', isExpanded && 'bg-subtle')}
                >
                  {isExpanded ? <ChevronDown size={12} className="shrink-0 text-fg-muted" aria-hidden="true" /> : <ChevronRight size={12} className="shrink-0 text-fg-muted" aria-hidden="true" />}
                  <Icon size={14} className="shrink-0" style={{ color: cat.color }} aria-hidden="true" />
                  <span className="flex-1 truncate">{cat.label}</span>
                  <span className="num text-2xs font-medium min-w-[18px] text-center px-1 py-0.5 rounded-full bg-muted text-fg-muted">
                    {cat.functions.length}
                  </span>
                </button>

                {isExpanded && (
                  <div className="ml-2 mt-0.5 space-y-0.5">
                    {cat.functions.map(fn => {
                      const isFnExpanded = expandedFn === fn.name
                      const isCopied = copied === fn.name
                      return (
                        <div key={fn.name}>
                          <div
                            className={cn('flex items-center gap-1.5 pl-2 pr-0.5 min-h-7 rounded-md cursor-pointer text-ui transition-colors group', isCopied ? 'bg-primary-wash' : 'hover:bg-subtle')}
                            onClick={() => setExpandedFn(isFnExpanded ? null : fn.name)}
                            draggable
                            onDragStart={e => {
                              e.dataTransfer.setData('text/plain', expressionSnippet(fn))
                              e.dataTransfer.effectAllowed = 'copy'
                            }}
                          >
                            <code className="text-2xs font-mono font-semibold shrink-0" style={{ color: cat.color }}>
                              {fn.name}
                            </code>
                            <span className="text-xs text-fg-muted flex-1 truncate">
                              {fn.description}
                            </span>
                            <IconButton
                              type="button"
                              size="sm"
                              onClick={e => { e.stopPropagation(); copyExpression(fn) }}
                              label="Insert into the focused field (or copy)"
                              tooltipSide="left"
                              className={cn('size-6 min-h-0 min-w-0 transition-opacity', isCopied ? 'opacity-100 text-success hover:text-success' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100')}
                              icon={isCopied ? <Check /> : <Copy />}
                            />
                          </div>

                          {isFnExpanded && (
                            <div className="ml-2 px-2 py-1.5 mb-1 rounded-md text-2xs space-y-1 bg-subtle">
                              {/* Signature */}
                              <div className="font-mono text-fg">
                                <span style={{ color: cat.color }}>{fn.name}</span>
                                <span className="text-fg-muted">(</span>
                                {fn.args.map((a, i) => (
                                  <span key={a.name}>
                                    {i > 0 && <span className="text-fg-muted">, </span>}
                                    <span className="text-fg">{a.name}</span>
                                    <span className="text-fg-muted">:{a.type}</span>
                                    {a.optional && <span className="text-fg-muted">?</span>}
                                  </span>
                                ))}
                                <span className="text-fg-muted">)</span>
                                <span className="text-fg-muted"> → {fn.returnType}</span>
                              </div>
                              {/* Example */}
                              <div className="font-mono text-fg-muted">
                                {fn.example}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 shrink-0 border-t border-border-subtle">
        <p className="text-2xs text-fg-muted">
          Click to expand · Copy or drag into any input field
        </p>
      </div>
    </div>
  )
}
