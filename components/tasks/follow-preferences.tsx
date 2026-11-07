"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Switch } from "@/components/ui/switch"
import { serverQuery } from "@/lib/server-read"
import { setHomePreferences } from "@/app/actions/home"

/**
 * The person's follow preferences (users.preferences, lib/services/home):
 * "Follow processes I start" (auto_follow_runs) and "Follow processes I act
 * on" (auto_follow_acted_runs — completing or responding to a workflow task
 * follows its run, so its later steps show in Task tracker → Following).
 * Both default on. Settings → Preferences shows both; the tracker's
 * Following tab has the "act on" one as a quick toggle.
 */
export const FOLLOW_PREFERENCES_KEY = ["home", "preferences"] as const

type Key = "auto_follow_runs" | "auto_follow_acted_runs"
const LABELS: Record<Key, string> = {
  auto_follow_runs: "Follow processes I start",
  auto_follow_acted_runs: "Follow processes I act on",
}

export function FollowPreferenceSwitch({ name, size = "sm", label }: { name: Key; size?: "sm" | "md"; label?: React.ReactNode }) {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: FOLLOW_PREFERENCES_KEY, queryFn: () => serverQuery("home.preferences"), staleTime: 60_000 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!data) return null
  const checked = data[name] !== false
  return (
    <span className="inline-flex items-center gap-2">
      <Switch size={size} checked={checked} disabled={saving} data-follow-preference={name}
        label={label ?? <span className="whitespace-nowrap text-xs text-fg-muted">{LABELS[name]}</span>}
        onCheckedChange={async (next) => {
          setSaving(true)
          setError(null)
          const result = await setHomePreferences({ [name]: next })
          if (!result.ok) setError(result.error)
          await queryClient.invalidateQueries({ queryKey: [...FOLLOW_PREFERENCES_KEY] })
          setSaving(false)
        }} />
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  )
}
