"use client"

import { useParams, useSearchParams } from "next/navigation"
import { AppPageView } from "./app-page-view"
import { AppPageClient } from "./app-page-client"

/** The page segment of an app address: /apps/<slug>/<page> ([page]) or /embed/apps/<slug>/<page> ([[...page]]); none = the app's first page. */
export function pageSlugFromParams(params: Record<string, string | string[] | undefined> | null): string | null {
  const raw = params?.page
  const value = Array.isArray(raw) ? raw[0] : raw
  return value || null
}

/**
 * The app's view as rendered by its LAYOUT (app/(dashboard)/apps/[slug]/layout.tsx,
 * app/embed/apps/[slug]/layout.tsx), not by each page: moving between the app's pages
 * re-renders it with the new page (read from the address) instead of mounting a new
 * one, so the app's header and navigation stay on screen and only the content area
 * changes. The page routes themselves render nothing.
 */
export function AppShellRoute({ appSlug, embed = false }: { appSlug: string; embed?: boolean }) {
  const pageSlug = pageSlugFromParams(useParams())
  const search = useSearchParams()
  if (embed) return <AppPageClient appSlug={appSlug} pageSlug={pageSlug} embed menu={search.get("menu") !== "0"} />
  return <AppPageView appSlug={appSlug} pageSlug={pageSlug} />
}
