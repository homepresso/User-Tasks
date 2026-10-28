import { Network } from 'lucide-react'

interface WorkflowContextProps {
  workflowSource: {
    engine_type: string
    display_name: string
  } | null
  stepId: string | null
  position: string | null
}

const engineIcons: Record<string, string> = {
  nintex: '\u{1F504}',
  power_automate: '\u26A1',
  manual: '\u{1F464}',
}

export function WorkflowContext({ workflowSource, stepId, position }: WorkflowContextProps) {
  if (!workflowSource) return null

  // Parse position like "step_4_review" or "4/7"
  let stepNumber: number | null = null
  let totalSteps: number | null = null
  const stepLabel = position

  if (position) {
    const slashMatch = position.match(/^(\d+)\/(\d+)$/)
    if (slashMatch) {
      stepNumber = Number(slashMatch[1])
      totalSteps = Number(slashMatch[2])
    }
  }

  return (
    <div
      className="flex items-center gap-3 rounded-lg px-4 py-3 mb-4"
      style={{
        backgroundColor: 'var(--theme-surface)',
        border: '1px solid var(--theme-surface-border)',
      }}
    >
      <span className="text-lg">
        {engineIcons[workflowSource.engine_type] ?? <Network size={18} />}
      </span>
      <div className="flex-1">
        <p className="text-xs font-medium" style={{ color: 'var(--theme-muted-text)' }}>
          Workflow
        </p>
        <p className="text-sm font-semibold">
          {workflowSource.display_name}
        </p>
      </div>
      {stepId && (
        <div className="text-right">
          <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>Step</p>
          <p className="text-sm font-medium">{stepLabel ?? stepId}</p>
        </div>
      )}
      {stepNumber && totalSteps && (
        <div className="flex gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className="h-2 w-6 rounded-full"
              style={{
                backgroundColor: i < stepNumber
                  ? 'var(--theme-primary)'
                  : 'var(--theme-surface-border)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
