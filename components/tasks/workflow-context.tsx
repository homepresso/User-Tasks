import { Network, RefreshCw, User, Zap } from 'lucide-react'
import { Card } from '@/components/ui/card'

interface WorkflowContextProps {
  workflowSource: {
    engine_type: string
    display_name: string
  } | null
  stepId: string | null
  position: string | null
}

const engineIcons: Record<string, React.ReactNode> = {
  nintex: <RefreshCw />,
  power_automate: <Zap />,
  manual: <User />,
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
    <Card variant="inset" padding="md" className="flex items-center gap-3" data-workflow-context>
      <span className="inline-flex text-fg-muted [&>svg]:size-5" aria-hidden>
        {engineIcons[workflowSource.engine_type] ?? <Network />}
      </span>
      <div className="flex-1">
        <p className="text-xs font-medium text-fg-muted">
          Workflow
        </p>
        <p className="text-sm font-semibold text-fg">
          {workflowSource.display_name}
        </p>
      </div>
      {stepId && (
        <div className="text-right">
          <p className="text-xs text-fg-muted">Step</p>
          <p className="text-sm font-medium text-fg">{stepLabel ?? stepId}</p>
        </div>
      )}
      {stepNumber && totalSteps && (
        <div className="flex gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-6 rounded-full ${i < stepNumber ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
