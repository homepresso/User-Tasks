import { cn } from "@/lib/utils"

/**
 * Unread tasks (lib/tasks/unread.ts): a small accent dot before the title of
 * a task I haven't opened since it became mine — the title is set bold
 * (`unreadTitleClass`). The dot is the theme's accent as text colour, which
 * each theme derives to AA on cards in light and dark, so it clears the 3:1
 * a non-text indicator needs. Screen readers hear "Unread" before the title.
 */
export function UnreadDot({ unread, className }: { unread: boolean | null | undefined; className?: string }) {
  if (!unread) return null
  return (
    <>
      <span aria-hidden="true" data-unread-dot className={cn("inline-block size-2 shrink-0 rounded-full bg-accent-text", className)} />
      <span className="sr-only">Unread: </span>
    </>
  )
}

/** The title's weight: semibold while unread (the regular weight stays the list's own). */
export function unreadTitleClass(unread: boolean | null | undefined): string | false {
  return !!unread && "font-semibold"
}
