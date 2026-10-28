'use client'

import { useState, useMemo } from 'react'
import { X, Search, Copy, Check, ChevronDown, ChevronRight, Sparkles, Type, Calendar, Calculator, GitBranch, ArrowUpDown, ListTree, Regex, Database, Paperclip } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { FUNCTION_CATALOG, FUNCTION_CATEGORIES } from '@/lib/expression-functions'
import { useActiveInput } from './active-input'

const categoryIcons: Record<string, any> = {
  Type, Calendar, Calculator, GitBranch, ArrowUpDown, ListTree, Regex, Database, Paperclip,
}

interface ExpressionsPanelProps {
  open: boolean
  onClose: () => void
  className?: string
}

export function ExpressionsPanel({ open, onClose, className }: ExpressionsPanelProps) {
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
      className={className ?? 'absolute top-14 right-3 z-30 w-[min(24rem,calc(100vw-2rem))] max-h-[480px] flex flex-col rounded-xl shadow-xl border overflow-hidden'}
      style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0"
        style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} style={{ color: 'var(--theme-primary-text)' }} />
          <span className="text-xs font-semibold">Expressions</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            {FUNCTION_CATALOG.length} functions
          </span>
        </div>
        <button onClick={onClose} className="p-0.5 rounded hover:opacity-70">
          <X size={14} style={{ color: 'var(--theme-muted-text)' }} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search functions..."
            className="!text-xs !pl-7 !h-8"
          />
        </div>
      </div>

      {/* Usage hint */}
      <div className="px-3 py-1.5 shrink-0 text-[9px] leading-relaxed" style={{ color: 'var(--theme-muted-text)', borderBottom: '1px solid var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
        Use in any field: <code className="font-mono px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-primary-text)' }}>{'{{=FUNCTION(args)}}'}</code>
        &nbsp;· Nestable · Variables work inside args
      </div>

      {/* Category list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: 'var(--theme-muted-text)' }}>
            No functions matching &ldquo;{search}&rdquo;
          </p>
        ) : (
          filtered.map(cat => {
            const isExpanded = search.length > 0 || expandedCategory === cat.id
            const Icon = categoryIcons[cat.icon] ?? Sparkles
            return (
              <div key={cat.id}>
                <button
                  onClick={() => setExpandedCategory(isExpanded && !search ? null : cat.id)}
                  className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:opacity-80 transition-colors"
                  style={{ backgroundColor: isExpanded ? 'var(--theme-surface)' : 'transparent' }}
                >
                  {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  <Icon size={12} style={{ color: cat.color }} />
                  <span className="text-[11px] font-semibold flex-1">{cat.label}</span>
                  <span className="text-[9px] px-1 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
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
                            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors hover:opacity-80 group"
                            style={{ backgroundColor: isCopied ? 'var(--theme-primary-light)' : 'transparent' }}
                            onClick={() => setExpandedFn(isFnExpanded ? null : fn.name)}
                            draggable
                            onDragStart={e => {
                              e.dataTransfer.setData('text/plain', expressionSnippet(fn))
                              e.dataTransfer.effectAllowed = 'copy'
                            }}
                          >
                            <code className="text-[10px] font-mono font-semibold shrink-0" style={{ color: cat.color }}>
                              {fn.name}
                            </code>
                            <span className="text-[10px] flex-1 truncate" style={{ color: 'var(--theme-muted-text)' }}>
                              {fn.description}
                            </span>
                            <button
                              onClick={e => { e.stopPropagation(); copyExpression(fn) }}
                              title="Insert into the focused field (or copy)"
                              className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{ color: isCopied ? '#22C55E' : 'var(--theme-muted-text)' }}
                            >
                              {isCopied ? <Check size={10} /> : <Copy size={10} />}
                            </button>
                          </div>

                          {isFnExpanded && (
                            <div className="ml-2 px-2 py-1.5 mb-1 rounded-lg text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)' }}>
                              {/* Signature */}
                              <div className="font-mono" style={{ color: 'var(--theme-card-text)' }}>
                                <span style={{ color: cat.color }}>{fn.name}</span>
                                <span style={{ color: 'var(--theme-muted-text)' }}>(</span>
                                {fn.args.map((a, i) => (
                                  <span key={a.name}>
                                    {i > 0 && <span style={{ color: 'var(--theme-muted-text)' }}>, </span>}
                                    <span style={{ color: 'var(--theme-card-text)' }}>{a.name}</span>
                                    <span style={{ color: 'var(--theme-muted-text)' }}>:{a.type}</span>
                                    {a.optional && <span style={{ color: 'var(--theme-muted-text)' }}>?</span>}
                                  </span>
                                ))}
                                <span style={{ color: 'var(--theme-muted-text)' }}>)</span>
                                <span style={{ color: 'var(--theme-muted-text)' }}> → {fn.returnType}</span>
                              </div>
                              {/* Example */}
                              <div className="font-mono" style={{ color: 'var(--theme-muted-text)' }}>
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
      <div className="px-3 py-1.5 shrink-0" style={{ borderTop: '1px solid var(--theme-surface-border)' }}>
        <p className="text-[9px] italic" style={{ color: 'var(--theme-muted-text)' }}>
          Click to expand · Copy or drag into any input field
        </p>
      </div>
    </div>
  )
}
