"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * AppPageView rendered in the browser only (the embed route is a server
 * page): its data comes from the persisted query cache, which the server
 * render can't see, so rendering it there would not match.
 */
export const AppPageClient = dynamic(() => import("./app-page-view").then((m) => m.AppPageView), {
  ssr: false,
  loading: () => <div className="space-y-3 p-3" aria-busy aria-label="Loading app"><Skeleton className="h-12 w-72" /><Skeleton className="h-64 w-full" /></div>,
})
