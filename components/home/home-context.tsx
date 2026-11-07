"use client"

import { createContext, useContext } from "react"
import type { HomeStatsPeriod } from "@/lib/home/activity"
import type { HomeWidgetId } from "@/lib/home/layout"
import type { HomeTab } from "./home-tabs"

/**
 * What Home's widgets share: the list's tab (the cards open it) and the My
 * activity period (one picker in the header scopes every chart widget).
 */
export interface HomeContextValue {
  tab: HomeTab
  setTab: (tab: HomeTab) => void
  /** Switch the task list to a tab and scroll it into view. */
  openTab: (tab: HomeTab) => void
  period: HomeStatsPeriod
  setPeriod: (period: HomeStatsPeriod) => void
  /** The browser's time zone (day buckets follow it). */
  timezone: string | undefined
  /** Is a compact widget (My decisions, On time, My submissions) showing its details? Always false in edit mode. */
  isExpanded: (id: HomeWidgetId) => boolean
  /** Expand or collapse a compact widget (remembered in this browser, per person). */
  toggleExpanded: (id: HomeWidgetId) => void
  /** A compact widget reports its content's natural height, so an expanded one grows to fit. */
  reportHeight: (id: HomeWidgetId, px: number) => void
}

export const HomeContext = createContext<HomeContextValue | null>(null)

export function useHome(): HomeContextValue {
  const value = useContext(HomeContext)
  if (!value) throw new Error("useHome outside HomeDashboard")
  return value
}
