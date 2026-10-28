import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(date))
}

export function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function formatRelativeDate(date: string | Date): string {
  const d = new Date(date)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Escape user input for PostgREST .ilike/.or filter patterns. Strips the
 * structural characters that break .or() parsing (commas/parens → 500s) and
 * escapes LIKE wildcards so "50%" matches literally.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[,()]/g, ' ').replace(/[\\%_]/g, '\\$&')
}

/**
 * Build a PostgREST .or() filter matching `term` against several columns,
 * with the term safely escaped. `.or(ilikeOrFilter(['title','number'], q))`
 */
export function ilikeOrFilter(columns: string[], term: string): string {
  const pattern = `%${escapeLikePattern(term.trim())}%`
  return columns.map((c) => `${c}.ilike.${pattern}`).join(',')
}
