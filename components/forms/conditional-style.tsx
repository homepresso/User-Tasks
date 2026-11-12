'use client'

import { createContext, useContext, useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Star, CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NO_ROW_STYLE, STYLE_TONE_NAMES, styleAttributes, type ConditionalStyle, type RowStyleResult, type StyleTone } from '@/lib/forms/conditional-style'
import { listRowStyles, type ListFieldConfig } from '@/lib/forms/list-field'
import type { TextStyleProps } from '@/lib/forms/text-style'
import { useRuleUser } from './use-rule-user'

/**
 * Conditional styling in the renderer (lib/forms/conditional-style.ts;
 * drawn by app/conditional-style.css): a styled box for a field, the tone
 * icon (the non-colour cue, with a spoken name) and List row styles judged
 * per row.
 */

const ICONS: Record<StyleTone, typeof Info> = {
  danger: OctagonAlert, warning: AlertTriangle, success: CheckCircle2, info: Info, accent: Star, neutral: CircleDot,
}

/** The tone's icon, in the tone's colour, announced by name ("Warning"). */
export function ToneIcon({ tone, size = 14, className }: { tone: StyleTone; size?: number; className?: string }) {
  const Icon = ICONS[tone]
  return (
    <span role="img" aria-label={STYLE_TONE_NAMES[tone]} className={cn('inline-flex shrink-0 items-center', className)} data-cs-tone={tone} data-cs-glyph={tone}>
      <Icon size={size} aria-hidden />
    </span>
  )
}

/** A field's box with its style (nothing extra when unstyled); the icon sits beside the label. */
export function StyledBox({ style, children, className }: { style: ConditionalStyle | null | undefined; children: React.ReactNode; className?: string }) {
  if (!style) return <>{children}</>
  return (
    <div {...styleAttributes(style)} data-cs-box="" className={cn('min-w-0', className)}>
      {style.icon
        ? <div className="flex items-start gap-1.5"><ToneIcon tone={style.tone ?? 'neutral'} className="mt-0.5" /><div className="min-w-0 flex-1">{children}</div></div>
        : children}
    </div>
  )
}

/* ── List row styles ─────────────────────────────────────────────────── */

/** What List row styles read besides the row: the form's values and the person (for `user.*`). */
const RowStyleContext = createContext<{ form: Record<string, unknown>; user: Record<string, unknown> | null | undefined } | null>(null)

/** Provides the form's values (and the person, when a List's row styles read `user.*`) to the Lists inside. */
export function RowStyleScope({ config, form, children }: { config: ListFieldConfig | undefined; form: Record<string, unknown> | null | undefined; children: React.ReactNode }) {
  const needsUser = Boolean(config && JSON.stringify([config.row_styles ?? [], config.cell_rules ?? []]).includes('user'))
  return needsUser ? <ScopeWithUser form={form}>{children}</ScopeWithUser> : <Scope form={form} user={undefined} own={false}>{children}</Scope>
}

function ScopeWithUser({ form, children }: { form: Record<string, unknown> | null | undefined; children: React.ReactNode }) {
  const user = useRuleUser(true) as Record<string, unknown> | null
  return <Scope form={form} user={user} own>{children}</Scope>
}

function Scope({ form, user, own, children }: { form: Record<string, unknown> | null | undefined; user: Record<string, unknown> | null | undefined; own: boolean; children: React.ReactNode }) {
  const parent = useContext(RowStyleContext)
  const value = useMemo(() => ({ form: form ?? parent?.form ?? {}, user: own ? user : parent?.user }), [form, parent, own, user])
  return <RowStyleContext.Provider value={value}>{children}</RowStyleContext.Provider>
}

/** Each row's styles (index → the row's and its cells'), judged with the form's values, the person and the parent row. */
export function useRowStyles(config: ListFieldConfig | undefined, rows: Array<Record<string, unknown>>, parent?: Record<string, unknown> | null): (index: number) => RowStyleResult {
  const ctx = useContext(RowStyleContext)
  const list = useMemo(() => {
    if (!config?.row_styles?.length && !config?.cell_rules?.length) return null
    return rows.map((row) => listRowStyles(config, row, { form: ctx?.form ?? {}, user: ctx?.user, parent: parent ?? null }))
  }, [config, rows, ctx, parent])
  return (index) => list?.[index] ?? NO_ROW_STYLE
}

/** A row's / cell's style attributes (spread on the tr / li / td / dd). */
export function rowStyleAttrs(style: ConditionalStyle | null | undefined): TextStyleProps {
  return styleAttributes(style)
}
