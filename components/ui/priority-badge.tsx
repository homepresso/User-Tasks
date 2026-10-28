type PriorityTone = {
  label: string
  bg: string
  text: string
  border: string
}

const priorityConfig: Record<string, PriorityTone> = {
  critical: {
    label: 'Critical',
    bg: 'color-mix(in srgb, var(--theme-danger) 12%, var(--theme-card-bg))',
    text: 'var(--theme-danger)',
    border: 'color-mix(in srgb, var(--theme-danger) 30%, var(--theme-surface-border))',
  },
  high: {
    label: 'High',
    bg: 'color-mix(in srgb, var(--theme-primary) 12%, var(--theme-card-bg))',
    text: 'var(--theme-primary-text)',
    border: 'color-mix(in srgb, var(--theme-primary) 30%, var(--theme-surface-border))',
  },
  medium: {
    label: 'Medium',
    bg: 'color-mix(in srgb, var(--theme-warning) 12%, var(--theme-card-bg))',
    text: 'var(--theme-warning)',
    border: 'color-mix(in srgb, var(--theme-warning) 34%, var(--theme-surface-border))',
  },
  low: {
    label: 'Low',
    bg: 'color-mix(in srgb, var(--theme-accent) 12%, var(--theme-card-bg))',
    text: 'var(--theme-accent-text)',
    border: 'color-mix(in srgb, var(--theme-accent) 28%, var(--theme-surface-border))',
  },
  none: {
    label: 'None',
    bg: 'var(--theme-surface)',
    text: 'var(--theme-muted-text)',
    border: 'var(--theme-surface-border)',
  },
}

interface PriorityBadgeProps {
  priority: string
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const config = priorityConfig[priority] ?? priorityConfig.none

  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: config.bg,
        color: config.text,
        borderColor: config.border,
      }}
    >
      {config.label}
    </span>
  )
}
