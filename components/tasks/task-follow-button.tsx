"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { Bell } from "lucide-react"
import { setTaskFollowed } from "@/app/actions/task-follows"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Tooltip } from "@/components/ui/tooltip"
import { serverRead } from "@/lib/server-read"
import { cn } from "@/lib/utils"

/**
 * Follow a task (Task tracker → Following). The bell on every tracker row
 * and on the task page: aria-pressed, optimistic, rolled back (with the
 * error in its tooltip) when the server refuses. Mirrors Home's run follow
 * (the same Bell icon).
 */

/** Every task-follow query: ['task-follows', 'ids' | 'list' | 'count', …]. */
export const TASK_FOLLOWS_KEY = ["task-follows"] as const

export const FOLLOW_LABEL = "Follow"
export const FOLLOWING_LABEL = "Following — click to unfollow"

/**
 * Which of these tasks I follow — one read per page of rows (no per-row
 * reads). Returns null until loaded.
 */
export function useFollowedTaskIds(ids: string[], enabled = true): Set<string> | null {
  const key = useMemo(() => Array.from(new Set(ids)).sort(), [ids])
  const { data } = useQuery({
    queryKey: [...TASK_FOLLOWS_KEY, "ids", key],
    queryFn: async () => {
      const result = await serverRead("tasks.followedIds", { ids: key })
      if (result.error) throw new Error(result.error.message)
      return result.data ?? []
    },
    enabled: enabled && key.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  })
  return useMemo(() => (key.length === 0 ? new Set<string>() : data ? new Set(data) : null), [data, key.length])
}

/** Put one task's follow state into every cached ids list (so other rows / pages agree). */
function patchIdCaches(queryClient: QueryClient, taskId: string, following: boolean) {
  queryClient.setQueriesData<string[]>({ queryKey: [...TASK_FOLLOWS_KEY, "ids"] }, (old) => {
    if (!old) return old
    const has = old.includes(taskId)
    if (following && !has) return [...old, taskId]
    if (!following && has) return old.filter((id) => id !== taskId)
    return old
  })
}

type SaveResult = { ok: true; data: { task_id: string; following: boolean } } | { ok: false; error: string }

/**
 * One optimistic toggle: show `next` at once, save, then commit the
 * server's answer — or roll back and report the error. Pure, so it is
 * testable without a DOM.
 */
export async function performFollowToggle(next: boolean, steps: {
  save: (follow: boolean) => Promise<SaveResult>
  show: (following: boolean | null) => void
  done: (outcome: { following: boolean } | { error: string }) => void
}): Promise<boolean | null> {
  steps.show(next)
  let result: SaveResult
  try {
    result = await steps.save(next)
  } catch {
    result = { ok: false, error: next ? "Could not follow the task." : "Could not unfollow the task." }
  }
  if (!result.ok) {
    steps.show(null) // roll back to the server's state
    steps.done({ error: result.error })
    return null
  }
  steps.show(result.data.following)
  steps.done({ following: result.data.following })
  return result.data.following
}

/** The toggle with optimistic state; `following` is the server's answer (undefined while loading). */
export function useTaskFollowToggle(taskId: string, following: boolean | undefined) {
  const queryClient = useQueryClient()
  // The optimistic value and the server answer it was made against: once a
  // fresh answer arrives (the ids cache is patched on success), it wins.
  const [optimistic, setOptimistic] = useState<{ value: boolean; base: boolean | undefined } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = optimistic && optimistic.base === following ? optimistic.value : (following ?? false)

  async function toggle() {
    if (busy) return
    setBusy(true)
    setError(null)
    await performFollowToggle(!current, {
      save: (follow) => setTaskFollowed(taskId, follow),
      show: (value) => setOptimistic(value === null ? null : { value, base: following }),
      done: (outcome) => {
        if ("error" in outcome) setError(outcome.error)
        else patchIdCaches(queryClient, taskId, outcome.following)
      },
    })
    setBusy(false)
    // The Following list and its count; the tracker lists refresh their bells from the ids cache.
    void queryClient.invalidateQueries({ queryKey: TASK_FOLLOWS_KEY })
  }

  return { following: current, busy, error, toggle, loaded: following !== undefined }
}

/** Bell icon button for a tracker row. Clicking it never expands / opens the row. */
export function TaskFollowButton({ taskId, following, className }: { taskId: string; following: boolean | undefined; className?: string }) {
  const state = useTaskFollowToggle(taskId, following)
  const label = state.error ? `${state.error} Try again.` : state.following ? FOLLOWING_LABEL : FOLLOW_LABEL
  return (
    <IconButton
      size="sm"
      label={label}
      aria-pressed={state.following}
      data-task-follow={state.following ? "following" : "not-following"}
      disabled={!state.loaded && following === undefined}
      className={cn(state.following ? "text-primary" : "text-fg-subtle hover:text-fg", state.error && "text-danger", className)}
      icon={<Bell className={cn(state.following && "fill-current")} />}
      onClick={(e) => { e.stopPropagation(); void state.toggle() }}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}

/** Follow / Following button for the task page header (loads its own state). */
export function TaskFollowToggle({ taskId }: { taskId: string }) {
  const ids = useMemo(() => [taskId], [taskId])
  const followed = useFollowedTaskIds(ids)
  const state = useTaskFollowToggle(taskId, followed ? followed.has(taskId) : undefined)
  return (
    <span className="inline-flex items-center gap-1">
      <Tooltip content={state.following ? FOLLOWING_LABEL : "Follow this task in the Task tracker"}>
        <Button
          size="sm"
          variant="secondary"
          aria-pressed={state.following}
          disabled={!state.loaded}
          onClick={() => void state.toggle()}
          leadingIcon={<Bell className={cn(state.following && "fill-current text-primary")} />}
          data-task-follow={state.following ? "following" : "not-following"}
        >
          {state.following ? "Following" : "Follow"}
        </Button>
      </Tooltip>
      {state.error && <span role="alert" className="text-xs text-danger">{state.error}</span>}
    </span>
  )
}
