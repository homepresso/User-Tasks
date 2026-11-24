"use client"

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { serverQuery } from "@/lib/server-read"
import { resolveTagColor, tagKey, type TagColorToken } from "@/lib/tags/palette"
import type { TagStyle, TagStyles } from "@/lib/services/tags"

/** React Query key prefix of the workspace's tag styles (invalidate after any tag write). */
export const TAG_STYLES_QUERY_KEY = ["tag-styles"] as const
/** React Query key prefix of Settings → Tags (tags in use with counts). */
export const TAG_LIST_QUERY_KEY = ["tags", "list"] as const
/** React Query key prefix of tag autocomplete results. */
export const TAG_SUGGEST_QUERY_KEY = ["tags", "suggest"] as const
/** React Query key prefix of the Settings → Tags detail panel. */
export const TAG_OBJECTS_QUERY_KEY = ["tags", "objects"] as const

export interface ResolvedTagStyle {
  color: TagColorToken
  /** The colour chosen for the tag; null = automatic. */
  chosen: TagColorToken | null
  description: string | null
}

export interface TagStyleLookup {
  styles: ReadonlyMap<string, TagStyle>
  autoColor: boolean
  loaded: boolean
  resolve: (name: string) => ResolvedTagStyle
}

export function tagStyleLookup(data: TagStyles | null | undefined): TagStyleLookup {
  const styles = new Map<string, TagStyle>()
  for (const s of data?.styles ?? []) styles.set(s.key, s)
  const autoColor = data?.settings?.auto_color ?? true
  return {
    styles,
    autoColor,
    loaded: data != null,
    resolve: (name: string) => {
      const style = styles.get(tagKey(name))
      return { color: resolveTagColor(name, style?.color ?? null, autoColor), chosen: style?.color ?? null, description: style?.description ?? null }
    },
  }
}

/** No provider (public pages, tests): every tag gets its automatic colour. */
const TagStylesContext = createContext<TagStyleLookup>(tagStyleLookup(null))

/**
 * Loads the workspace's tag styles once (cached 5 minutes, per workspace;
 * every tag write invalidates TAG_STYLES_QUERY_KEY) for every TagChip under
 * it. Mounted by the dashboard shell.
 */
export function TagStylesProvider({ tenantId, children }: { tenantId: string | null | undefined; children: ReactNode }) {
  const { data } = useQuery({
    queryKey: [...TAG_STYLES_QUERY_KEY, tenantId ?? "home"],
    queryFn: () => serverQuery("tags.styles"),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  })
  const value = useMemo(() => tagStyleLookup(data as TagStyles | undefined), [data])
  return <TagStylesContext value={value}>{children}</TagStylesContext>
}

/** Test / preview seam: give chips fixed styles. */
export function StaticTagStylesProvider({ styles, children }: { styles: TagStyles | null; children: ReactNode }) {
  const value = useMemo(() => tagStyleLookup(styles), [styles])
  return <TagStylesContext value={value}>{children}</TagStylesContext>
}

export function useTagStyles(): TagStyleLookup {
  return useContext(TagStylesContext)
}

/** Invalidate the cached styles and Settings → Tags after a change. */
export function useInvalidateTagStyles(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: TAG_STYLES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: TAG_LIST_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: TAG_SUGGEST_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: TAG_OBJECTS_QUERY_KEY }),
    ])
  }, [queryClient])
}
