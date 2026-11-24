"use client"

import { TagList } from "@/components/ui/tag-chip"
import { cn } from "@/lib/utils"

/**
 * A task's tags in a list row or card: coloured chips (TagList — the
 * workspace's tag colours), at most `max` with "+N". Shared by every task
 * list (My tasks, Home, the Task tracker, My team, the queue, search, phone
 * cards) so they all show tags the same way.
 */
export function TaskTags({ tags, max = 2, className }: { tags?: readonly string[] | null; max?: number; className?: string }) {
  if (!tags?.length) return null
  return <TagList tags={tags} max={max} size="xs" maxWidthClass="max-w-[8rem]" className={cn("shrink-0 flex-nowrap", className)} />
}
