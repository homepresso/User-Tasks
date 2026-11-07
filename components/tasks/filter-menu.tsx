"use client"

import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CountBadge } from "@/components/ui/badge"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * FilterButton (§5.2): "Status ▾" with a count of the chosen values, opening
 * a checkbox menu. Replaces the inline chip rows on the task trackers.
 */
export function FilterMenu({ label, options, selected, onChange }: {
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" trailingIcon={<ChevronDown />} aria-label={selected.length ? `${label}: ${selected.length} selected` : label}>
          {label}
          {selected.length > 0 && <CountBadge count={selected.length} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o.value} checked={selected.includes(o.value)}
            onCheckedChange={() => toggle(o.value)} onSelect={(e) => e.preventDefault()}>
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>Clear</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
