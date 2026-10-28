'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, ArrowRight, Search, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BrowseItem {
  schema: string
  name: string
  type: string // 'table' | 'view' | 'procedure' | 'function'
  columns?: any[]
  parameters?: any[]
}

interface WizardStep2Props {
  integration: any
  selectedItems: BrowseItem[]
  onSelectionChange: (items: BrowseItem[]) => void
  onBack: () => void
  onNext: () => void
}

export function WizardStep2Browse({
  integration, selectedItems, onSelectionChange, onBack, onNext,
}: WizardStep2Props) {
  const [items, setItems] = useState<BrowseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    loadItems()
  }, [])

  async function loadItems() {
    setLoading(true)

    if (integration.type === 'database') {
      try {
        const [tablesResp, procsResp] = await Promise.all([
          fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'tables', integrationId: integration.id }),
          }),
          fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'procedures', integrationId: integration.id }),
          }),
        ])
        const tablesData = await tablesResp.json()
        const procsData = await procsResp.json()
        const allItems: BrowseItem[] = [
          ...(tablesData.tables ?? []),
          ...(procsData.procedures ?? []),
        ]
        setItems(allItems)
      } catch { /* ignore */ }
    }
    // For REST APIs, we could list existing endpoints
    // For now just show a message

    setLoading(false)
  }

  async function loadDetails(item: BrowseItem) {
    if (item.type === 'table' || item.type === 'view') {
      const resp = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'describe',
          integrationId: integration.id,
          schema: item.schema,
          table: item.name,
        }),
      })
      const data = await resp.json()
      // Also fetch primary key info
      let primaryKey: string[] = []
      let identityColumn: string | null = null
      try {
        const pkResp = await fetch('/api/integrations/discover', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integration_id: integration.id, action: 'primary_key', schema: item.schema, name: item.name }),
        })
        const pkData = await pkResp.json()
        primaryKey = pkData.primary_key ?? []
        identityColumn = pkData.identity_column ?? null
      } catch { /* PK discovery optional */ }
      return { ...item, columns: data.columns ?? [], primary_key: primaryKey, identity_column: identityColumn }
    } else {
      const resp = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'describe_procedure',
          integrationId: integration.id,
          schema: item.schema,
          procedureName: item.name,
        }),
      })
      const data = await resp.json()
      return { ...item, parameters: data.parameters ?? [] }
    }
  }

  function isSelected(item: BrowseItem) {
    return selectedItems.some(s => s.schema === item.schema && s.name === item.name)
  }

  async function toggleItem(item: BrowseItem) {
    if (isSelected(item)) {
      onSelectionChange(selectedItems.filter(s => !(s.schema === item.schema && s.name === item.name)))
    } else {
      // Load details before adding
      const detailed = await loadDetails(item)
      onSelectionChange([...selectedItems, detailed])
    }
  }

  const typeIcons: Record<string, string> = {
    table: '\u{1F4CB}',
    view: '\u{1F441}',
    procedure: '\u2699\uFE0F',
    function: '\u0192',
  }

  const types = [...new Set(items.map(i => i.type))]

  const filtered = items.filter(i => {
    if (filter !== 'all' && i.type !== filter) return false
    if (search && !`${i.schema}.${i.name}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">Select Objects</h3>
            <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              Choose tables, views, and procedures to create references from.
              {selectedItems.length > 0 && (
                <span className="font-medium" style={{ color: 'var(--theme-primary-text)' }}>
                  {' '}{selectedItems.length} selected
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter objects..."
              className="pl-8 !text-xs"
            />
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setFilter('all')}
              className="px-2 py-1 rounded text-[10px] font-medium transition-colors"
              style={{
                backgroundColor: filter === 'all' ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                color: filter === 'all' ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
              }}
            >All</button>
            {types.map(t => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className="px-2 py-1 rounded text-[10px] font-medium transition-colors"
                style={{
                  backgroundColor: filter === t ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                  color: filter === t ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                }}
              >{typeIcons[t]} {t}s</button>
            ))}
          </div>
        </div>

        {/* Item list */}
        {loading ? (
          <div className="space-y-2 py-4">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="animate-pulse h-10 rounded" style={{ backgroundColor: 'var(--theme-surface)' }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: 'var(--theme-muted-text)' }}>
            {items.length === 0 ? 'No objects found. Check your connection.' : 'No matches.'}
          </p>
        ) : (
          <div className="max-h-[400px] overflow-y-auto space-y-1">
            {filtered.map((item) => {
              const key = `${item.schema}.${item.name}`
              const selected = isSelected(item)
              return (
                <button
                  key={key}
                  onClick={() => toggleItem(item)}
                  className={cn(
                    'flex items-center gap-3 w-full text-left rounded-lg px-3 py-2.5 text-sm transition-all',
                  )}
                  style={{
                    backgroundColor: selected ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                    border: selected ? '1.5px solid var(--theme-primary)' : '1px solid transparent',
                  }}
                >
                  <span className="text-base">{typeIcons[item.type] ?? '\u{1F4C4}'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {item.schema !== 'dbo' && item.schema !== 'public' && (
                        <span style={{ color: 'var(--theme-muted-text)' }}>{item.schema}.</span>
                      )}
                      {item.name}
                    </p>
                    <p className="text-[10px] capitalize" style={{ color: 'var(--theme-muted-text)' }}>{item.type}</p>
                  </div>
                  {selected && (
                    <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--theme-primary)' }}>
                      <Check size={12} className="text-white" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft size={14} className="mr-1" /> Back
        </Button>
        <Button onClick={onNext} disabled={selectedItems.length === 0}>
          Next: Create References ({selectedItems.length}) <ArrowRight size={14} className="ml-1" />
        </Button>
      </div>
    </div>
  )
}
