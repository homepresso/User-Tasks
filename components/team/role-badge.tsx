import { cn } from '@/lib/utils'

// Role tints ride the theme-aware --status-* / --theme-* variables so they
// adapt to dark canvases (Noir) without dark: branches.
const roleConfig: Record<string, { label: string; style?: React.CSSProperties; className?: string }> = {
  owner: { label: 'Owner', style: { backgroundColor: 'var(--status-info-bg)', color: 'var(--status-info)' } },
  admin: { label: 'Admin', style: { backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-card-text)' } },
  manager: { label: 'Manager', style: { backgroundColor: 'var(--theme-accent-light)', color: 'var(--status-info)' } },
  member: { label: 'Member', style: { backgroundColor: 'var(--status-todo-bg)', color: 'var(--theme-muted-text)' } },
  viewer: { label: 'Viewer', style: { backgroundColor: 'var(--status-todo-bg)', color: 'var(--theme-muted-text)' } },
  lead: { label: 'Lead', style: { backgroundColor: 'var(--status-progress-bg)', color: 'var(--status-progress)' } },
}

export function RoleBadge({ role }: { role: string }) {
  const config = roleConfig[role] ?? roleConfig.member
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', config.className)}
      style={config.style}
    >
      {config.label}
    </span>
  )
}
