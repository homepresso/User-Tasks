"use client"

import { Switch } from "@/components/ui/switch"
import { FilterMenu } from "@/components/tasks/filter-menu"

/**
 * The task lists' status controls (lib/tasks/status-filter): the Status
 * menu (open statuses; none picked = all of them) and one "Show completed"
 * switch for the closed ones. A list that already switches between Open /
 * Completed / All (My tasks) leaves the switch out (no onShowCompletedChange):
 * one control for the same thing, not two.
 */
export function StatusFilterControls({ options, selected, onSelectedChange, showCompleted, onShowCompletedChange }: {
  /** The list's open statuses. */
  options: ReadonlyArray<{ value: string; label: string }>
  selected: string[]
  onSelectedChange: (next: string[]) => void
  showCompleted?: boolean
  onShowCompletedChange?: (next: boolean) => void
}) {
  return (
    <>
      <FilterMenu label="Status" options={options} selected={selected} onChange={onSelectedChange} />
      {onShowCompletedChange && <Switch size="sm" checked={!!showCompleted} onCheckedChange={onShowCompletedChange} data-show-completed
        label={<span className="whitespace-nowrap text-xs text-fg-muted">Show completed</span>} />}
    </>
  )
}
