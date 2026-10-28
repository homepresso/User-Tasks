'use client'

import { cn } from '@/lib/utils'

interface TriggerFilterConfigProps {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
}

const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low']
const STATUS_OPTIONS = ['todo', 'in_progress', 'blocked', 'completed']

export function TriggerFilterConfig({ config, onUpdate }: TriggerFilterConfigProps) {
  const priorityFilter: string[] = config.priority_filter ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)' }}>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          This trigger starts the workflow when the event occurs. Use the filters below to narrow which tasks activate this workflow. Task data is available in downstream nodes as {'{{task.field}}'}.
        </p>
      </div>

      {/* Priority filter */}
      <div onPointerDown={(e) => e.stopPropagation()}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
          Priority Filter
          <span className="font-normal normal-case ml-1">(optional)</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITY_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                const next = priorityFilter.includes(p)
                  ? priorityFilter.filter((x: string) => x !== p)
                  : [...priorityFilter, p]
                onUpdate('priority_filter', next)
              }}
              className={cn(
                'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors',
                priorityFilter.includes(p)
                  ? 'bg-[color:var(--theme-accent-light)] text-[color:var(--theme-card-text)] dark:bg-[color:var(--theme-accent-light)] dark:text-[color:var(--theme-primary-text)]'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              )}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        {priorityFilter.length === 0 && (
          <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            No filter — triggers for all priorities
          </p>
        )}
      </div>
    </div>
  )
}
