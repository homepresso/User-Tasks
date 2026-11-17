import { Building2, Cloud, FolderTree, Globe, KeyRound, Network, Puzzle, Share2, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normaliseTeamOrigin, TEAM_ORIGIN_DESCRIPTIONS, TEAM_ORIGIN_LABELS, type TeamOrigin } from '@/lib/teams/origin'

const ICONS: Record<TeamOrigin, typeof Users> = {
  internal: Users,
  active_directory: Building2,
  ldap: FolderTree,
  entra: Cloud,
  okta: KeyRound,
  google: Globe,
  scim: Network,
  sharepoint: Share2,
  extension: Puzzle,
}

/**
 * Where a team comes from, as a small text badge (lib/teams/origin.ts):
 * "Internal", "Active Directory", "Entra ID", "SharePoint" … The text is the
 * information (never colour alone); the icon is decorative, the title adds
 * how the team is kept ("Synced from Microsoft Entra ID").
 */
export function TeamOriginBadge({ origin, label, className, compact = false }: {
  origin: string | null | undefined
  /** Overrides the badge text, e.g. a source label. */
  label?: string | null
  className?: string
  /** Icon-sized padding for dense rows. */
  compact?: boolean
}) {
  const value = normaliseTeamOrigin(origin)
  const Icon = ICONS[value]
  const text = label || TEAM_ORIGIN_LABELS[value]
  return (
    <span
      data-team-origin={value}
      title={TEAM_ORIGIN_DESCRIPTIONS[value]}
      className={cn(
        'inline-flex h-5 w-fit max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-2xs font-medium',
        value === 'internal' ? 'border-border bg-panel text-fg-muted' : 'border-transparent bg-muted text-fg',
        compact && 'h-4 px-1',
        className,
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  )
}
