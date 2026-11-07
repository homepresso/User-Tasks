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
      <p className="text-xs text-fg-muted">
        This trigger starts the workflow when the event occurs. Use the filters below to narrow which tasks activate this workflow. Task data is available in downstream nodes as <code className="font-mono text-2xs text-fg">{'{{task.field}}'}</code>.
      </p>

      {/* Priority filter */}
      <div onPointerDown={(e) => e.stopPropagation()}>
        <label className="mb-1.5 block text-xs font-medium text-fg">
          Priority filter
          <span className="ml-1.5 font-normal text-fg-muted">Optional</span>
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
              aria-pressed={priorityFilter.includes(p)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                priorityFilter.includes(p)
                  ? 'border-primary bg-primary-wash text-primary-text'
                  : 'border-border text-fg-muted hover:bg-subtle hover:text-fg'
              )}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        {priorityFilter.length === 0 && (
          <p className="mt-1.5 text-xs text-fg-muted">
            No filter — triggers for all priorities
          </p>
        )}
      </div>
    </div>
  )
}
