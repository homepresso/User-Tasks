"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Heart, Star } from "lucide-react"
import { serverQuery } from "@/lib/server-read"
import { usePermissions } from "@/lib/permissions-context"
import { setFormFavorite } from "@/app/actions/home"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import type { FavoriteForm } from "@/lib/services/home"

/** React Query key of the signed-in person's favourite forms (Home, forms list, Forms menu, form page). */
export const FAVORITE_FORMS_QUERY_KEY = ["form-favorites"] as const

/** My favourite forms (that I can open), alphabetical; one cached query everywhere. */
export function useFavoriteForms(): { forms: FavoriteForm[]; loading: boolean; error: boolean; enabled: boolean } {
  const { can } = usePermissions()
  const enabled = can("forms.submit")
  const query = useQuery({
    queryKey: FAVORITE_FORMS_QUERY_KEY,
    queryFn: async () => ((await serverQuery("home.favoriteForms")) ?? []) as FavoriteForm[],
    enabled,
    staleTime: 60_000,
  })
  return { forms: query.data ?? [], loading: enabled && query.isPending, error: query.isError, enabled }
}

/**
 * The star toggle: filled when the form is a favourite. Optimistic; the
 * server checks the person can open the form. Hidden without forms.submit.
 */
export function FavoriteStar({ formId, name, description = null, size = 14, className, onError, icon = "star", children }: {
  /** star (lists, menus) or heart (the form's own top-right corner). */
  icon?: "star" | "heart"
  /** Shown after the icon (a visible label). */
  children?: React.ReactNode
  formId: string
  name: string
  description?: string | null
  size?: number
  className?: string
  onError?: (message: string) => void
}) {
  const { forms, enabled } = useFavoriteForms()
  const queryClient = useQueryClient()
  if (!enabled) return null
  const on = forms.some((f) => f.id === formId)
  const label = on ? `Remove ${name} from favourites` : `Add ${name} to favourites`

  async function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = !on
    const previous = queryClient.getQueryData<FavoriteForm[]>(FAVORITE_FORMS_QUERY_KEY) ?? []
    queryClient.setQueryData<FavoriteForm[]>(FAVORITE_FORMS_QUERY_KEY, next
      ? [...previous, { id: formId, name, description, favorited_at: new Date().toISOString() }].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))
      : previous.filter((f) => f.id !== formId))
    const result = await setFormFavorite(formId, next)
    if (!result.ok) {
      queryClient.setQueryData(FAVORITE_FORMS_QUERY_KEY, previous)
      onError?.(result.error)
    }
    void queryClient.invalidateQueries({ queryKey: FAVORITE_FORMS_QUERY_KEY })
  }

  return (
    <Tooltip content={on ? "Favourite — click to remove" : "Add to favourites"}>
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={label}
      data-favorite-icon={icon}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm p-1 transition-colors duration-[var(--ds-dur-fast)] hover:bg-muted",
        on ? (icon === "heart" ? "text-danger" : "text-warning") : "text-fg-muted hover:text-fg",
        className,
      )}
      data-favorite-star={formId}
      data-favorite={on ? "true" : "false"}
    >
      {icon === "heart" ? <Heart size={size} fill={on ? "currentColor" : "none"} aria-hidden /> : <Star size={size} fill={on ? "currentColor" : "none"} aria-hidden />}
      {children}
    </button>
    </Tooltip>
  )
}
