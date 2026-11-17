'use client'

/**
 * The one entry point on an unbound table: "Get rows from…" with the
 * choices in plain words. Used by the form Data table control (rows) and by
 * column bindings (a dropdown's options).
 */

import { Cloud, Database, Keyboard, Sheet } from 'lucide-react'
import { cn } from '@/lib/utils'

export type RowsSourceChoice = 'table' | 'reference' | 'sharepoint' | 'typed'

const CHOICES: Record<RowsSourceChoice, { icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>; title: string; rows: string; options: string }> = {
  table: { icon: Database, title: 'A data table', rows: 'Rows stored in UserTasks (Data).', options: 'Choices from a table in Data.' },
  reference: { icon: Cloud, title: 'An API', rows: 'Rows from another system: a saved API, or paste its web address.', options: 'Choices from another system’s API.' },
  sharepoint: { icon: Sheet, title: 'A SharePoint list', rows: 'Items of a SharePoint list.', options: 'Choices from a SharePoint list.' },
  typed: { icon: Keyboard, title: 'Type them in', rows: 'People type the rows into the form (a List).', options: 'A fixed list you type.' },
}

export function GetRowsFrom({ kind, choices, onPick, title }: {
  kind: 'rows' | 'options'
  choices: RowsSourceChoice[]
  onPick: (choice: RowsSourceChoice) => void
  title?: string
}) {
  return (
    <div className="space-y-1.5" data-testid="get-rows-from">
      <p className="text-ui font-semibold text-fg">{title ?? (kind === 'rows' ? 'Get rows from…' : 'Get the choices from…')}</p>
      <div className="grid grid-cols-1 gap-1.5 @[22rem]:grid-cols-2">
        {choices.map((c) => {
          const meta = CHOICES[c]
          const Icon = meta.icon
          return (
            <button key={c} type="button" onClick={() => onPick(c)} data-rows-source={c}
              className={cn('flex min-w-0 items-start gap-2 rounded-md border border-border bg-panel p-2 text-left transition-colors hover:border-primary hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary')}>
              <Icon size={16} className="mt-0.5 shrink-0 text-primary-text" aria-hidden />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-fg">{meta.title}</span>
                <span className="block text-2xs text-fg-muted">{kind === 'rows' ? meta.rows : meta.options}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
