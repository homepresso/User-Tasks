'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  GOOGLE_FONT_CATEGORIES, GOOGLE_FONT_CATEGORY_LABELS, findGoogleFont, googleFontHref, googleFontStack, googleFonts,
  type GoogleFont, type GoogleFontCategory,
} from '@/lib/fonts/google'
import { FontLinks } from './font-links'

/**
 * Font picker: the caller's own choices (theme default, web-safe / InfoPath
 * stacks, system stacks, an uploaded font) and every Google Fonts family in
 * the bundled catalogue — searchable, filtered by category, each name drawn
 * in its own face (loaded only as it scrolls into view, from this origin's
 * /fonts/g/… route). With remote font fetching off on the instance
 * (air-gapped: FONTS_REMOTE=off) only the families already stored are
 * offered (GET /fonts/status).
 *
 * Values are opaque strings; a Google family is `google:<Family>` unless the
 * caller maps it (googleValue / googleFamilyOf).
 */

export interface FontPickerOption {
  value: string
  label: string
  /** CSS font-family for the preview (the option's own stack). */
  stack?: string
  hint?: string
}

export interface FontStatus { remote: boolean; stored: string[] }

let statusPromise: Promise<FontStatus> | null = null
/** GET /fonts/status once per page load (remote fetching on, families stored). */
export function loadFontStatus(): Promise<FontStatus> {
  statusPromise ??= fetch('/fonts/status', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : { remote: true, stored: [] }))
    .then((j: Partial<FontStatus>) => ({ remote: j.remote !== false, stored: Array.isArray(j.stored) ? j.stored.filter((s): s is string => typeof s === 'string') : [] }))
    .catch(() => ({ remote: true, stored: [] }))
  return statusPromise
}

const PAGE = 40
const defaultGoogleValue = (family: string) => `google:${family}`
const defaultGoogleFamilyOf = (value: string | undefined) => (value?.startsWith('google:') ? value.slice(7) : null)

export function FontPicker({
  value, onChange, options, emptyLabel, googleValue = defaultGoogleValue, googleFamilyOf = defaultGoogleFamilyOf,
  categories = GOOGLE_FONT_CATEGORIES, preferredCategory, id, className, size = 'md', 'aria-label': ariaLabel, sample,
}: {
  value: string | undefined
  onChange: (value: string | undefined) => void
  /** Choices listed before the Google families. */
  options: FontPickerOption[]
  /** Label of the "no font" choice (e.g. "Theme default"); omit when a value is required. */
  emptyLabel?: string
  googleValue?: (family: string) => string
  googleFamilyOf?: (value: string | undefined) => string | null
  /** Categories offered (default: all five). */
  categories?: readonly GoogleFontCategory[]
  /** Category shown first when the picker opens (the slot's natural one). */
  preferredCategory?: GoogleFontCategory
  id?: string
  className?: string
  size?: 'sm' | 'md'
  'aria-label'?: string
  /** Text shown in each face next to the family name (wide panels only). */
  sample?: string
}) {
  const [open, setOpen] = useState(false)
  const currentFamily = googleFamilyOf(value)
  const currentFont = currentFamily ? findGoogleFont(currentFamily) : undefined
  const currentOption = options.find((o) => o.value === value)
  const label = currentFont?.family ?? currentOption?.label ?? (value ? value : emptyLabel ?? 'Choose a font')
  const stack = currentFont ? googleFontStack(currentFont) : currentOption?.stack
  const currentHref = currentFont ? googleFontHref(currentFont) : null
  return (
    <>
      {currentHref && <FontLinks hrefs={[currentHref]} />}
      <Popover
        open={open}
        onOpenChange={setOpen}
        width={340}
        aria-label={ariaLabel ?? 'Choose a font'}
        trigger={(p) => (
          <button
            type="button"
            id={id}
            {...p}
            aria-label={ariaLabel ? `${ariaLabel}: ${label}` : undefined}
            data-font-picker
            data-font-value={value ?? ''}
            className={cn(
              'flex w-full items-center gap-1 rounded-md border border-border bg-(--theme-input-bg,transparent) text-left text-fg',
              size === 'sm' ? 'h-7 px-1.5 text-xs' : 'h-9 px-2.5 text-sm',
              className,
            )}
          >
            <span className="min-w-0 flex-1 truncate" style={stack ? { fontFamily: stack } : undefined}>{label}</span>
            <ChevronDown size={size === 'sm' ? 12 : 14} className="shrink-0 text-fg-muted" aria-hidden />
          </button>
        )}
      >
        {(close) => (
          <FontPickerPanel
            value={value}
            options={options}
            emptyLabel={emptyLabel}
            googleValue={googleValue}
            currentFamily={currentFont?.family ?? null}
            categories={categories}
            preferredCategory={preferredCategory}
            sample={sample}
            onPick={(v) => { onChange(v); close() }}
          />
        )}
      </Popover>
    </>
  )
}

function FontPickerPanel({ value, options, emptyLabel, googleValue, currentFamily, categories, preferredCategory, sample, onPick }: {
  value: string | undefined
  options: FontPickerOption[]
  emptyLabel?: string
  googleValue: (family: string) => string
  currentFamily: string | null
  categories: readonly GoogleFontCategory[]
  preferredCategory?: GoogleFontCategory
  sample?: string
  onPick: (value: string | undefined) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<GoogleFontCategory | 'all'>(preferredCategory && categories.includes(preferredCategory) ? preferredCategory : 'all')
  // The slot's category is only a starting point: typing searches every category until a chip is chosen.
  const [categoryChosen, setCategoryChosen] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [status, setStatus] = useState<FontStatus | null>(null)
  const [visible, setVisible] = useState<string[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { let live = true; loadFontStatus().then((s) => { if (live) setStatus(s) }); return () => { live = false } }, [])

  const q = query.trim().toLowerCase()
  const stored = useMemo(() => new Set(status?.stored ?? []), [status])
  const standard = options.filter((o) => !q || o.label.toLowerCase().includes(q))
  const google = useMemo(() => {
    const all = googleFonts().filter((f) => categories.includes(f.category))
    const offline = status && !status.remote
    return all.filter((f) => (category === 'all' || f.category === category)
      && (!q || f.family.toLowerCase().includes(q))
      // Offline: stored families only (bundled ones always render).
      && (!offline || stored.has(f.family) || Boolean(f.bundledVar)))
  }, [categories, category, q, status, stored])
  const shown = google.slice(0, limit)

  // Faces load as rows scroll into view (one stylesheet per family, from this origin).
  useEffect(() => {
    const root = listRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      const add = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.family).filter((f): f is string => Boolean(f))
      if (add.length) setVisible((prev) => { const next = new Set(prev); for (const f of add) next.add(f); return next.size === prev.length ? prev : [...next] })
    }, { root, rootMargin: '120px 0px' })
    for (const el of root.querySelectorAll('[data-family]')) io.observe(el)
    return () => io.disconnect()
  }, [shown.length, q, category])

  const hrefs = useMemo(() => visible.map((f) => googleFontHref(f)).filter((h): h is string => Boolean(h)), [visible])

  return (
    <div className="space-y-2" data-font-picker-panel>
      <FontLinks hrefs={hrefs} />
      <label className="flex items-center gap-1.5 rounded-md border border-border px-2">
        <Search size={13} className="text-fg-muted" aria-hidden />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); if (!categoryChosen) setCategory('all') }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (standard[0] && !shown[0]) onPick(standard[0].value)
            else if (shown[0]) onPick(googleValue(shown[0].family))
          }}
          placeholder="Search fonts"
          aria-label="Search fonts"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
          data-font-search
        />
      </label>
      <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-1">
        {(['all', ...categories] as const).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={category === c}
            onClick={() => { setCategory(c); setCategoryChosen(true); setLimit(PAGE) }}
            className={cn('rounded-full border px-2 py-0.5 text-2xs font-medium', category === c ? 'border-primary bg-(--theme-primary-light) text-primary-text' : 'border-border text-fg-muted')}
            data-font-category={c}>
            {c === 'all' ? 'All' : GOOGLE_FONT_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <div ref={listRef} role="listbox" aria-label="Fonts" className="max-h-72 overflow-y-auto pr-1">
        {emptyLabel && !q && (
          <Row selected={!value} label={emptyLabel} onPick={() => onPick(undefined)} data-font-option="" />
        )}
        {standard.length > 0 && (
          <>
            <p className="px-1.5 pt-1 pb-0.5 text-2xs font-semibold uppercase tracking-wide text-fg-muted">Standard fonts</p>
            {standard.map((o) => (
              <Row key={o.value} selected={o.value === value} label={o.label} hint={o.hint} stack={o.stack} onPick={() => onPick(o.value)} data-font-option={o.value} />
            ))}
          </>
        )}
        <p className="px-1.5 pt-2 pb-0.5 text-2xs font-semibold uppercase tracking-wide text-fg-muted">
          Google Fonts{google.length ? ` · ${google.length.toLocaleString()}` : ''}
        </p>
        {status && !status.remote && (
          <p className="px-1.5 pb-1 text-2xs text-fg-muted" data-font-offline>
            Downloading fonts is turned off on this instance: only fonts already stored here are listed.
          </p>
        )}
        {shown.map((f: GoogleFont) => (
          <Row key={f.family} family={f.family} selected={f.family === currentFamily} label={f.family} hint={GOOGLE_FONT_CATEGORY_LABELS[f.category]}
            stack={visible.includes(f.family) || f.bundledVar ? googleFontStack(f) : undefined} sample={sample}
            onPick={() => onPick(googleValue(f.family))} data-font-option={googleValue(f.family)} />
        ))}
        {google.length > shown.length && (
          <button type="button" className="mt-1 w-full rounded-md px-2 py-1 text-xs font-medium text-primary-text hover:bg-subtle" onClick={() => setLimit((n) => n + PAGE * 2)} data-font-more>
            Show more ({(google.length - shown.length).toLocaleString()} more)
          </button>
        )}
        {!google.length && !standard.length && <p className="px-1.5 py-2 text-xs text-fg-muted">No fonts match.</p>}
      </div>
      <p className="text-2xs text-fg-muted">Google Fonts are served from this site (open-source licences); visitors&apos; browsers never contact Google.</p>
    </div>
  )
}

function Row({ selected, label, hint, stack, family, sample, onPick, ...rest }: {
  selected: boolean
  label: string
  hint?: string
  stack?: string
  family?: string
  sample?: string
  onPick: () => void
  'data-font-option'?: string
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      data-family={family}
      className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-subtle', selected && 'bg-subtle')}
      {...rest}
    >
      <Check size={12} className={cn('shrink-0', selected ? 'text-primary-text' : 'invisible')} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm" style={stack ? { fontFamily: stack } : undefined}>
        {label}
        {sample && family && <span className="ml-2 text-xs text-fg-muted" aria-hidden>{sample}</span>}
      </span>
      {hint && <span className="shrink-0 text-2xs text-fg-muted">{hint}</span>}
    </button>
  )
}
