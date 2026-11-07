import { cn } from '@/lib/utils'

const SIZE = { sm: 'size-6 text-2xs', md: 'size-7 text-xs', lg: 'size-8 text-ui' } as const

// Chart-palette hue per name (deterministic): 18% wash with the hue's text token.
const HUES = [
  'bg-[color-mix(in_srgb,var(--theme-chart-1)_18%,var(--theme-card-bg))] text-[color:var(--theme-chart-1-text)]',
  'bg-[color-mix(in_srgb,var(--theme-chart-2)_18%,var(--theme-card-bg))] text-[color:var(--theme-chart-2-text)]',
  'bg-[color-mix(in_srgb,var(--theme-chart-3)_18%,var(--theme-card-bg))] text-[color:var(--theme-chart-3-text)]',
  'bg-[color-mix(in_srgb,var(--theme-chart-4)_18%,var(--theme-card-bg))] text-[color:var(--theme-chart-4-text)]',
  'bg-[color-mix(in_srgb,var(--theme-chart-5)_18%,var(--theme-card-bg))] text-[color:var(--theme-chart-5-text)]',
  'bg-[color-mix(in_srgb,var(--theme-chart-6)_18%,var(--theme-card-bg))] text-[color:var(--theme-chart-6-text)]',
] as const

export function avatarHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % HUES.length
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
  /** 2px panel ring for stacked avatars. */
  ring?: boolean
}

/** Person avatar: image, or initials on a name-derived chart hue. 24 / 28 / 32px. */
export function Avatar({ name, src, size = 'md', ring = false, className, ...props }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none',
        SIZE[size],
        !src && HUES[avatarHue(name)],
        src && 'border border-border-subtle',
        ring && 'ring-2 ring-panel',
        className,
      )}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  )
}
