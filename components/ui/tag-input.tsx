"use client"

import { useContext, useEffect, useId, useMemo, useRef, useState } from "react"
import { QueryClientContext, useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { TagChip } from "@/components/ui/tag-chip"
import { serverQuery } from "@/lib/server-read"
import { cleanTagName, tagKey, TAG_NAME_MAX } from "@/lib/tags/palette"
import { TAG_SUGGEST_QUERY_KEY } from "@/hooks/use-tag-styles"
import type { TagSuggestion } from "@/lib/services/tags"

/**
 * The one tag input: chips (each removable) plus a text box with
 * autocomplete from the workspace's tags — registry and tags in use,
 * ranked by match then usage, case-insensitive, each with its colour and
 * count (server read tags.suggest, cached per search). Arrow keys move,
 * Enter / comma / Tab add, Backspace in an empty box removes the last tag,
 * Escape closes. Typing an existing tag in another case adds the existing
 * spelling; "Create “xyz”" appears only when the person may add new tags
 * (the workspace allows it, or they hold tags.manage).
 *
 * Controlled (`value` / `onChange`), or immediate (`onAdd` / `onRemove`,
 * e.g. saving each change through the object's update).
 */

export interface TagInputProps {
  value: readonly string[]
  onChange?: (next: string[]) => void
  onAdd?: (tag: string) => void | Promise<void>
  onRemove?: (tag: string) => void | Promise<void>
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  /** Max tags (default 30). */
  max?: number
  className?: string
  "aria-label"?: string
  id?: string
  /** Show the suggestions in the flow under the box instead of floating (inside dialogs and other scroll containers that would clip them). */
  listInline?: boolean
}

/** Debounced value. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

type SuggestResult = { suggestions: TagSuggestion[]; exact: TagSuggestion | null; can_create: boolean } | undefined

/** Cached server suggestions for what was typed. */
function useServerSuggestions(q: string, enabled: boolean): SuggestResult {
  const { data } = useQuery({
    queryKey: [...TAG_SUGGEST_QUERY_KEY, q],
    queryFn: () => serverQuery("tags.suggest", { q: q || undefined, limit: 8 }),
    staleTime: 60_000,
    enabled,
    placeholderData: (prev) => prev,
  })
  return data as SuggestResult
}

/** No QueryClient (tests, public pages): no suggestions, free typing. */
function useNoSuggestions(): SuggestResult { return undefined }

export function TagInput(props: TagInputProps) {
  // Whether a QueryClient exists never changes for a mounted input, so each instance keeps one hook.
  const client = useContext(QueryClientContext)
  return <TagInputBase {...props} useSuggestions={client ? useServerSuggestions : useNoSuggestions} />
}

function TagInputBase({ value, onChange, onAdd, onRemove, placeholder = "Add a tag…", disabled = false, autoFocus = false, max = 30, className, id, listInline = false, useSuggestions, ...aria }: TagInputProps & { useSuggestions: (q: string, enabled: boolean) => SuggestResult }) {
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActiveIndex] = useState(0)
  // Whether the person picked the highlighted option (arrows / mouse) rather than it being the default first one.
  const [picked, setPicked] = useState(false)
  const setActive = (next: number | ((i: number) => number)) => { setPicked(true); setActiveIndex(next) }
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const q = useDebounced(cleanTagName(text), 150)
  const data = useSuggestions(q, open && !disabled)
  const applied = useMemo(() => new Set(value.map(tagKey)), [value])
  const typed = cleanTagName(text).slice(0, TAG_NAME_MAX)
  const typedKey = tagKey(typed)
  const suggestions = (data?.suggestions ?? []).filter((s) => !applied.has(s.key))
  const exact = data?.exact && tagKey(data.exact.name) === typedKey ? data.exact : suggestions.find((s) => s.key === typedKey) ?? null
  const canCreate = data?.can_create ?? true
  const showCreate = Boolean(typedKey) && !exact && !applied.has(typedKey) && canCreate
  const options: Array<{ kind: "tag"; tag: TagSuggestion } | { kind: "create"; name: string }> = [
    ...suggestions.map((tag) => ({ kind: "tag" as const, tag })),
    ...(showCreate ? [{ kind: "create" as const, name: typed }] : []),
  ]
  const full = value.length >= max
  useEffect(() => { setActiveIndex(0); setPicked(false) }, [q])

  async function add(name: string) {
    const clean = cleanTagName(name).slice(0, TAG_NAME_MAX)
    const key = tagKey(clean)
    if (!key || applied.has(key) || full) { setText(""); return }
    setBusy(true)
    try {
      if (onAdd) await onAdd(clean)
      onChange?.([...value, clean])
      setText("")
    } catch {
      // The caller showed the error; keep the text so it can be retried.
    } finally { setBusy(false) }
  }

  async function remove(name: string) {
    setBusy(true)
    try {
      if (onRemove) await onRemove(name)
      onChange?.(value.filter((t) => tagKey(t) !== tagKey(name)))
    } catch {
      // The caller showed the error.
    } finally { setBusy(false) }
  }

  /** Enter / comma: the highlighted option, else the existing spelling of what was typed, else a new tag (when allowed). */
  function commit() {
    const option = open ? options[active] : undefined
    // Suggestions arrive after a short debounce: typing then Enter at once must not
    // add a stale suggestion that doesn't match the text (unless it was picked).
    const matches = !option || option.kind === "create" || !typedKey || picked || option.tag.key.includes(typedKey)
    if (option && matches) return void add(option.kind === "tag" ? option.tag.name : option.name)
    if (exact) return void add(exact.name)
    if (typedKey && canCreate) return void add(typed)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0))) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === "Enter" || e.key === ",") { if (text.trim() || (open && options.length)) { e.preventDefault(); commit() } }
    else if (e.key === "Tab" && text.trim() && open && options.length) { e.preventDefault(); commit() }
    else if (e.key === "Escape") { if (open) { e.stopPropagation(); setOpen(false) } }
    else if (e.key === "Backspace" && !text && value.length) { void remove(value[value.length - 1]) }
  }

  const activeId = open && options[active] ? `${listId}-${active}` : undefined
  return (
    <div className={cn("relative", className)} data-tag-input>
      <div className={cn("flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-input-border bg-input px-1.5 py-1 focus-within:border-focus",
        disabled && "opacity-60")} onClick={() => inputRef.current?.focus()}>
        {value.map((t) => (
          <TagChip key={t} name={t} size="sm" onRemove={disabled ? undefined : () => void remove(t)} />
        ))}
        <input
          ref={inputRef}
          id={id}
          value={text}
          disabled={disabled || busy || full}
          autoFocus={autoFocus}
          placeholder={full ? `At most ${max} tags` : value.length ? "" : placeholder}
          maxLength={TAG_NAME_MAX + 1}
          onChange={(e) => { const v = e.target.value; if (v.endsWith(",")) { setText(v.slice(0, -1)); return } setText(v); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={aria["aria-label"] ?? "Add a tag"}
          className="min-w-[6rem] flex-1 bg-transparent px-1 text-ui text-fg outline-none placeholder:text-fg-subtle"
          data-tag-input-text
        />
      </div>
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className={cn("mt-1 max-h-64 w-full min-w-[14rem] overflow-y-auto rounded-md border border-border bg-elevated p-1", listInline ? "relative" : "absolute left-0 top-full z-50 shadow-elev-2")} data-tag-suggestions>
          {options.map((o, i) => (
            <li key={o.kind === "tag" ? o.tag.key : `create:${o.name}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); void add(o.kind === "tag" ? o.tag.name : o.name) }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs", i === active && "bg-subtle")}
              data-tag-option={o.kind === "tag" ? o.tag.key : "create"}>
              {o.kind === "tag" ? (
                <>
                  <TagChip name={o.tag.name} size="xs" color={o.tag.color} description={null} />
                  {o.tag.description && <span className="min-w-0 truncate text-fg-muted">{o.tag.description}</span>}
                  <span className="num ml-auto shrink-0 text-fg-subtle">{o.tag.total}</span>
                </>
              ) : (
                <><Plus className="size-3.5 text-primary-text" aria-hidden /> Create <TagChip name={o.name} size="xs" description={null} /></>
              )}
            </li>
          ))}
        </ul>
      )}
      {typedKey && !canCreate && !exact && !suggestions.length && open && (
        <p className="mt-1 text-2xs text-fg-muted" role="status">Only existing tags can be added in this workspace.</p>
      )}
    </div>
  )
}

/** A comma-separated text field's value as tags and back (forms that store tags as text). */
export function parseTagText(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(",")) {
    const t = cleanTagName(part)
    if (t && !out.some((o) => tagKey(o) === tagKey(t))) out.push(t)
  }
  return out
}
