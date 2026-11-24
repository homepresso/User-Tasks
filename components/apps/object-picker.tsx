"use client"

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Check, ChevronDown, Search, X } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { FloatingLayer } from "@/components/ui/floating-layer"
import { Spinner } from "@/components/ui/spinner"
import { serverQuery } from "@/lib/server-read"
import type { PickerItem, PickerKind, PickerResult } from "@/lib/services/app-search"
import { cn } from "@/lib/utils"

/**
 * ObjectPicker — the app builder's searchable async picker (combobox) for
 * workflows, forms, data tables (+ columns / views), reports, users, teams,
 * roles, agents, API references and app pages. Search runs server-side
 * (ui-read apps.search, lib/services/app-search.ts) with paging ("Load
 * more" / scrolling to the end), so long lists never load at once; each
 * option shows a name and a second line (status, owner, row count, team
 * size, email + avatar). Lists only what the person using it may see.
 *
 *  - `tokens`: fixed choices listed first (e.g. "Me (whoever is viewing)",
 *    "My teams", "From page filter: …"), matched by the search too.
 *  - `multiple`: chips for the chosen values; Backspace in the empty search
 *    removes the last one.
 *  - Keyboard: ArrowUp / ArrowDown, Home / End, Enter to choose, Escape to
 *    close; the input is a combobox with aria-activedescendant.
 */

export interface PickerToken { value: string; label: string; hint?: string }

const PAGE = 20

interface BaseProps {
  app: string
  kind: PickerKind
  /** column / view: their data table. */
  table?: string | null
  mode?: "design" | "filter"
  tokens?: PickerToken[]
  placeholder?: string
  id?: string
  label?: string
  disabled?: boolean
  size?: "sm" | "md"
  className?: string
  /** Show a "None" / "Any" choice that clears the value. */
  clearLabel?: string
}

type SingleProps = BaseProps & { multiple?: false; value: string | null | undefined; onChange: (value: string | null, item?: PickerItem | PickerToken) => void }
type MultiProps = BaseProps & { multiple: true; value: string[]; onChange: (value: string[]) => void; max?: number }

function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/** Labels for chosen ids (one cached read per kind + ids). */
export function usePickerLabels(app: string, kind: PickerKind, ids: string[], opts: { table?: string | null; mode?: "design" | "filter" } = {}) {
  const key = [...ids].sort().join(",")
  return useQuery({
    queryKey: ["apps", "picker-labels", app, kind, opts.table ?? null, opts.mode ?? "design", key],
    enabled: ids.length > 0,
    queryFn: async () => (await serverQuery("apps.search", { app, kind, ids, table: opts.table ?? null, mode: opts.mode ?? "design" })) as PickerResult,
    staleTime: 60_000,
  })
}

export function ObjectPicker(props: SingleProps | MultiProps) {
  const { app, kind, table = null, mode = "design", tokens = [], placeholder, id, label, disabled, size = "sm", className, clearLabel } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const q = useDebounced(query.trim())
  const values = props.multiple ? props.value : props.value ? [props.value] : []
  const tokenValues = new Set(tokens.map((t) => t.value))
  const objectIds = values.filter((v) => !tokenValues.has(v))
  const labels = usePickerLabels(app, kind, objectIds, { table, mode })
  const nameOf = (value: string): string => tokens.find((t) => t.value === value)?.label
    ?? labels.data?.items.find((i) => i.id === value)?.name
    ?? (labels.isPending && objectIds.length ? "…" : "(not available)")

  const search = useInfiniteQuery({
    queryKey: ["apps", "picker", app, kind, table, mode, q],
    enabled: open,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => (await serverQuery("apps.search", { app, kind, q, offset: pageParam, limit: PAGE, table, mode })) as PickerResult,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 30_000,
  })
  const found = useMemo(() => search.data?.pages.flatMap((p) => p.items) ?? [], [search.data])
  const deniedPerm = search.data?.pages[0]?.denied
  const needle = query.trim().toLowerCase()
  const shownTokens = tokens.filter((t) => !needle || t.label.toLowerCase().includes(needle))
  type Option = { value: string; label: string; hint?: string | null; avatar?: string | null; clear?: boolean }
  const options: Option[] = [
    ...(clearLabel && !props.multiple && (!needle || clearLabel.toLowerCase().includes(needle)) ? [{ value: "", label: clearLabel, clear: true }] : []),
    ...shownTokens.map((t) => ({ value: t.value, label: t.label, hint: t.hint })),
    ...found.map((i) => ({ value: i.id, label: i.name, hint: i.hint, avatar: kind === "user" ? (i.avatar ?? null) : undefined })),
  ]

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])
  const setOpenAndReset = (next: boolean | ((o: boolean) => boolean)) => setOpen((o) => {
    const value = typeof next === "function" ? next(o) : next
    if (!value) setQuery("")
    return value
  })
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${highlight}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: "nearest" })
    if (highlight >= options.length - 2 && search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage()
  }, [highlight]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: Option) => {
    if (props.multiple) {
      if (o.clear) return
      const has = props.value.includes(o.value)
      const next = has ? props.value.filter((v) => v !== o.value) : [...props.value, o.value].slice(0, props.max ?? 50)
      props.onChange(next)
      setQuery("")
      return
    }
    const item = tokens.find((t) => t.value === o.value) ?? found.find((i) => i.id === o.value)
    props.onChange(o.clear ? null : o.value, item)
    setOpenAndReset(false)
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, options.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
    else if (e.key === "Home") { e.preventDefault(); setHighlight(0) }
    else if (e.key === "End") { e.preventDefault(); setHighlight(Math.max(0, options.length - 1)) }
    else if (e.key === "Enter") { e.preventDefault(); const o = options[highlight]; if (o) pick(o) }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpenAndReset(false) }
    else if (e.key === "Backspace" && !query && props.multiple && props.value.length) props.onChange(props.value.slice(0, -1))
  }

  const height = size === "md" ? "min-h-10 text-sm" : "min-h-8 text-xs"
  const triggerLabel: ReactNode = props.multiple
    ? (values.length ? null : <span className="text-fg-muted">{placeholder ?? "Search…"}</span>)
    : values.length ? <span className="truncate text-fg">{nameOf(values[0])}</span> : <span className="truncate text-fg-muted">{clearLabel && props.value === null ? clearLabel : placeholder ?? "Search…"}</span>

  return (
    <div ref={rootRef} className={cn("relative", className)} data-object-picker={kind}>
      <div className={cn("flex w-full items-center gap-1 rounded-md border border-border bg-panel px-1.5 py-0.5", height, disabled && "opacity-50")}>
        {props.multiple && values.map((v) => (
          <span key={v} className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-primary-wash py-0.5 pl-2 pr-0.5 text-2xs text-primary-text" data-picker-chip={v}>
            <span className="truncate">{nameOf(v)}</span>
            <button type="button" disabled={disabled} className="rounded-full p-0.5 hover:bg-subtle" aria-label={`Remove ${nameOf(v)}`}
              onClick={() => props.onChange(props.value.filter((x) => x !== v))}><X className="size-3" aria-hidden /></button>
          </span>
        ))}
        <button type="button" id={id} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={label ? `${label}: ${props.multiple ? `${values.length} chosen` : values.length ? nameOf(values[0]) : "none"}` : undefined}
          onClick={() => setOpenAndReset((o) => !o)} className="flex min-w-16 flex-1 items-center justify-between gap-1 px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] rounded-sm" data-picker-trigger>
          <span className="min-w-0 flex-1 truncate">{triggerLabel ?? <span className="text-fg-muted">Add…</span>}</span>
          <span className="flex shrink-0 items-center gap-1">
            {!props.multiple && clearLabel === undefined && values.length > 0 && !disabled && (
              <X className="size-3 text-fg-muted" aria-label="Clear" role="button" onClick={(e) => { e.stopPropagation(); props.onChange(null) }} />
            )}
            <ChevronDown className="size-3.5 text-fg-muted" aria-hidden />
          </span>
        </button>
      </div>
      <FloatingLayer anchorRef={rootRef} open={open} onDismiss={() => setOpenAndReset(false)} closeOnEscape minWidth={260} maxHeight={340}
        className="flex flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-lg">
        <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
          <Search className="size-3.5 text-fg-muted" aria-hidden />
          <input ref={inputRef} role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={options[highlight] ? `${listId}-${highlight}` : undefined}
            aria-label={`Search ${label ?? kind}`} value={query} onChange={(e) => { setQuery(e.target.value); setHighlight(0) }} onKeyDown={onKey}
            placeholder={`Search ${KIND_NOUN[kind]}…`} className="w-full bg-transparent text-xs text-fg outline-none" data-picker-search />
          {search.isFetching && <Spinner size="sm" />}
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-multiselectable={props.multiple || undefined} className="min-h-0 flex-1 overflow-y-auto py-1"
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24 && search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage()
          }}>
          {options.map((o, index) => {
            const selected = o.clear ? !values.length : values.includes(o.value)
            return (
              <div key={`${o.value}:${index}`} id={`${listId}-${index}`} data-index={index} role="option" aria-selected={selected}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHighlight(index)} onClick={() => pick(o)}
                className={cn("flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs text-fg", index === highlight && "bg-primary-wash")} data-picker-option={o.value}>
                {o.avatar !== undefined && <Avatar name={o.label} src={o.avatar} size="sm" />}
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", o.clear && "text-fg-muted")}>{o.label}</span>
                  {o.hint && <span className="block truncate text-2xs text-fg-muted">{o.hint}</span>}
                </span>
                {selected && <Check className="size-3.5 shrink-0 text-primary-text" aria-hidden />}
              </div>
            )
          })}
          {!options.length && !search.isFetching && (
            <p className="px-3 py-2 text-xs text-fg-muted" role="status">
              {deniedPerm ? `You can’t see ${KIND_NOUN[kind]} (needs ${deniedPerm}).` : needle ? "Nothing matches." : `No ${KIND_NOUN[kind]} yet.`}
            </p>
          )}
          {search.hasNextPage && (
            <button type="button" className="w-full px-3 py-1.5 text-left text-xs text-primary-text hover:underline" onMouseDown={(e) => e.preventDefault()}
              onClick={() => void search.fetchNextPage()} data-picker-more>{search.isFetchingNextPage ? "Loading…" : "Load more"}</button>
          )}
        </div>
      </FloatingLayer>
    </div>
  )
}

const KIND_NOUN: Record<PickerKind, string> = {
  workflow: "workflows", form: "forms", table: "data tables", report: "reports", team: "teams", user: "people", role: "roles",
  agent: "agents", reference: "API references", page: "pages", column: "columns", view: "views",
}
