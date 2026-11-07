import { Badge, type Tone } from '@/components/ui/badge'

// Role tones come from the semantic badge set, so they follow the theme in
// light and dark. Brand marks the people who run the workspace.
const roleConfig: Record<string, { label: string; tone: Tone }> = {
  owner: { label: 'Owner', tone: 'brand' },
  admin: { label: 'Admin', tone: 'brand' },
  manager: { label: 'Manager', tone: 'info' },
  member: { label: 'Member', tone: 'neutral' },
  viewer: { label: 'Viewer', tone: 'neutral' },
  lead: { label: 'Lead', tone: 'info' },
}

export function RoleBadge({ role }: { role: string }) {
  const config = roleConfig[role] ?? roleConfig.member
  return <Badge tone={config.tone} data-role={role}>{config.label}</Badge>
}
