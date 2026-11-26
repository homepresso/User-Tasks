"use client"

/**
 * Home activity helpers without recharts: metric-cards (the top row of Home)
 * needs only these, and importing them from ./charts put recharts (with
 * redux toolkit, d3 parts) into Home's first load.
 */

import { CheckCircle2, CornerUpLeft, XCircle } from "lucide-react"
import { OUTCOME_RULES, type HomeTaskStats } from "@/lib/home/activity"
import { useSlotsDetailed, type Segment } from "./segmented-bar"

export function periodWords(days: number) {
  return `the last ${days} days`
}

export const APPROVAL_RULE = `Approval rate = approvals ÷ decisions. A decision is an outcome you chose: approve-like (${OUTCOME_RULES[1].matches}), reject-like (${OUTCOME_RULES[0].matches}), sent back (${OUTCOME_RULES[2].matches}), or any other label on a task that offered two or more outcomes. Plain completions (Done, Submitted…) are not decisions.`

/** My decisions as bar segments: approve / reject / send back, custom outcomes while they stay distinguishable, the rest folded into one grey part. */
export function useDecisionSegments(d: HomeTaskStats["decisions"]): Segment[] {
  // Custom outcomes get their own colour while one can be told apart from the
  // rest; the tail (and the SQL's own "Other decisions") folds into one grey part.
  const custom = d.groups.filter((g) => g.kind === "other" && g.label !== "Other decisions")
  const slots = useSlotsDetailed([
    { role: "success" }, { role: "danger" }, { role: "warning", semantic: false },
    ...custom.map((_, i) => ({ role: "series" as const, prefer: i + 2 })),
    { role: "neutral" },
  ])
  const firstFail = slots.slice(3, 3 + custom.length).findIndex((x) => !x.ok)
  const ownColour = firstFail === -1 ? custom.length : firstFail
  const segments: Segment[] = []
  let folded = 0
  for (const g of d.groups) {
    if (g.kind === "approve") segments.push({ key: "approve", label: g.label, value: g.count, color: slots[0].color, icon: <CheckCircle2 size={12} aria-hidden /> })
    else if (g.kind === "reject") segments.push({ key: "reject", label: g.label, value: g.count, color: slots[1].color, icon: <XCircle size={12} aria-hidden /> })
    else if (g.kind === "return") segments.push({ key: "return", label: g.label, value: g.count, color: slots[2].color, icon: <CornerUpLeft size={12} aria-hidden /> })
    else {
      const i = custom.indexOf(g)
      if (i >= 0 && i < ownColour) segments.push({ key: `other:${g.label}`, label: g.label, value: g.count, color: slots[3 + i].color })
      else folded += g.count
    }
  }
  if (folded) segments.push({ key: "other", label: "Other decisions", value: folded, color: slots[slots.length - 1].color })
  return segments
}
