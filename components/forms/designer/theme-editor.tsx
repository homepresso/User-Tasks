'use client'

import { useMemo, useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { AlertTriangle, Check, Save, WandSparkles } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { useWorkspaceTheme } from '@/components/providers/theme-provider'
import {
  autoFixFormTheme, blockingFormThemeIssues, formThemeContrast, overridesFromPreset, FORM_THEME_FONTS,
  FORM_APPEARANCES, FORM_BUTTON_SHAPES, FORM_FIELD_STYLES, FORM_SHADOW_LEVELS,
  type FormThemeColors, type FormThemeOverrides, type FormThemeRef,
} from '@/lib/forms/form-theme'
import { FORM_WIDTHS, FORM_WIDTH_LABELS, FORM_WIDTH_PCT, clampFormWidthPct, normalizeFormWidth } from '@/lib/forms/form-width'
import { isValidColor } from '@/lib/theme/colors'
import { THEME_TEMPLATES } from '@/lib/theme/presets'
import type { ThemeMode } from '@/lib/theme/schema'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'

/**
 * Mini-theme editor: inherit the workspace theme, pick a saved Form theme,
 * or set a few overrides (start from a built-in preset). Contrast is checked
 * against the workspace palette for both modes; failing pairs are listed
 * with an auto-fix, and the renderer raises them anyway so text is never
 * illegible.
 */

const SHAPE_LABELS: Record<(typeof FORM_BUTTON_SHAPES)[number], string> = { square: 'Square', rounded: 'Rounded', pill: 'Pill' }
const SHADOW_LABELS: Record<(typeof FORM_SHADOW_LEVELS)[number], string> = { none: 'None', subtle: 'Subtle', medium: 'Medium', strong: 'Strong' }
const FIELD_LABELS: Record<(typeof FORM_FIELD_STYLES)[number], string> = { outlined: 'Outlined', filled: 'Filled', underline: 'Underline' }
const APPEARANCE_LABELS: Record<(typeof FORM_APPEARANCES)[number], string> = { workspace: 'Follow the workspace', system: 'Viewer\'s light / dark', light: 'Always light', dark: 'Always dark' }

export interface SavedFormTheme { id: string; name: string; overrides: FormThemeOverrides }


/** The custom width's number box: typed freely, clamped to 40–100 on Enter / leaving the box. */
function PctInput({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (raw: string) => void }) {
  const [text, setText] = useState(String(value))
  return (
    <input type="number" min={FORM_WIDTH_PCT.min} max={FORM_WIDTH_PCT.max} step={1} value={text} disabled={disabled}
      aria-label="Form width percent" className="h-7 w-16 rounded border px-1.5 text-xs border-border bg-input text-fg"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim()) onCommit(text); setText(String(text.trim() ? clampFormWidthPct(text) : value)) }}
      onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { e.preventDefault(); onCommit(text); setText(String(clampFormWidthPct(text))) } }}
      data-form-width-pct-input />
  )
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function ColorInput({ label, value, onChange, id }: { label: string; value: string | undefined; onChange: (value: string | undefined) => void; id: string }) {
  const [draft, setDraft] = useState(value ?? '')
  const [prev, setPrev] = useState(value)
  if (prev !== value) { setPrev(value); setDraft(value ?? '') }
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <input type="color" aria-label={`${label} picker`} value={hex} onChange={(e) => onChange(e.target.value)} className="h-8 w-8 shrink-0 cursor-pointer rounded border p-0.5 border-border" />
        <input
          id={id}
          className={`${inputClass} font-mono`}
          placeholder="inherit"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            if (!e.target.value.trim()) onChange(undefined)
            else if (isValidColor(e.target.value.trim())) onChange(e.target.value.trim())
          }}
        />
      </div>
    </div>
  )
}

export function ThemeEditor({ value, onChange, savedThemes, canSaveTheme, onSaveTheme, idPrefix = 'te', formHeaderOn = false }: {
  value: FormThemeRef
  onChange: (next: FormThemeRef) => void
  savedThemes: SavedFormTheme[]
  canSaveTheme: boolean
  /** Save the current overrides as a reusable Form theme; resolves to its id (or an error message). */
  onSaveTheme?: (name: string, overrides: FormThemeOverrides) => Promise<{ id: string } | { error: string }>
  idPrefix?: string
  /** The form's own header is on (Buttons & header): it is drawn in place of this one. */
  formHeaderOn?: boolean
}) {
  const { theme } = useWorkspaceTheme()
  const [mode, setMode] = useState<ThemeMode>('light')
  const [saveName, setSaveName] = useState('')
  // Synchronous guard: two clicks in one frame would save the theme twice.
  const saveGuard = useSubmitGuard()
  const [saveState, setSaveState] = useState<{ busy: boolean; error?: string; saved?: boolean }>({ busy: false })
  const overrides: FormThemeOverrides = useMemo(() => (value.source === 'custom' ? value.overrides
    : value.source === 'saved' ? (savedThemes.find((t) => t.id === value.theme_id)?.overrides ?? {}) : {}), [value, savedThemes])
  const editable = value.source === 'custom'
  const setOverrides = (next: FormThemeOverrides) => onChange({ source: 'custom', overrides: next })
  const colors: FormThemeColors = overrides.colors?.[mode] ?? {}
  const setColors = (patch: Partial<FormThemeColors>) => {
    const nextColors = { ...colors, ...patch }
    for (const k of Object.keys(nextColors) as Array<keyof FormThemeColors>) if (!nextColors[k]) delete nextColors[k]
    setOverrides({ ...overrides, colors: { ...overrides.colors, [mode]: nextColors } })
  }
  const issues = useMemo(() => (['light', 'dark'] as const).flatMap((m) => formThemeContrast(overrides, theme.colors[m], m).map((i) => ({ ...i, mode: m }))), [overrides, theme])
  const blocking = blockingFormThemeIssues(overrides)
  const fontValue = overrides.font ? `${overrides.font.source}:${overrides.font.family}` : ''
  const headingFontValue = overrides.heading_font ? `${overrides.heading_font.source}:${overrides.heading_font.family}` : ''
  /** Set or clear (empty / the default) one optional key. */
  const setKey = <K extends keyof FormThemeOverrides>(key: K, v: FormThemeOverrides[K] | '' | undefined, unset?: FormThemeOverrides[K]) => {
    const next = { ...overrides }
    if (v === '' || v === undefined || v === unset) delete next[key]
    else next[key] = v as FormThemeOverrides[K]
    setOverrides(next)
  }
  const logo = theme.branding.logoLight ?? theme.branding.logoDark

  return (
    <div className="space-y-3 text-xs">
      <div role="radiogroup" aria-label="Form theme" className="grid grid-cols-3 gap-1">
        {([['workspace', 'Workspace'], ['custom', 'Custom'], ['saved', 'Saved theme']] as const).map(([source, label]) => (
          <button
            key={source}
            type="button"
            role="radio"
            aria-checked={value.source === source}
            disabled={source === 'saved' && savedThemes.length === 0}
            onClick={() => {
              if (source === 'workspace') onChange({ source: 'workspace' })
              else if (source === 'custom') onChange({ source: 'custom', overrides: value.source === 'saved' ? overrides : (value.source === 'custom' ? value.overrides : {}) })
              else if (savedThemes[0]) onChange({ source: 'saved', theme_id: savedThemes[0].id })
            }}
            className={cn('h-8 rounded border text-2xs font-medium disabled:opacity-40', value.source === source ? 'border-primary' : 'border-border', value.source === source ? 'bg-primary-wash' : '', value.source === source ? 'text-primary-text' : 'text-fg')}
          >
            {label}
          </button>
        ))}
      </div>

      {value.source === 'workspace' && (
        <p className="text-2xs text-fg-muted">The form uses the workspace theme (light and dark) as it is. Choosing a form width below switches to Custom (colours unchanged).</p>
      )}

      {/* Form width (lib/forms/form-width.ts): stored on the theme as form_width. */}
      <div data-form-width-setting>
        <Label>Form width</Label>
        <div role="radiogroup" aria-label="Form width" className="grid grid-cols-5 gap-1">
          {FORM_WIDTHS.map((w) => {
            const current = normalizeFormWidth(overrides.form_width)
            return (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={current === w}
                disabled={value.source === 'saved'}
                data-form-width={w}
                onClick={() => {
                  const base: FormThemeOverrides = value.source === 'custom' ? value.overrides : {}
                  const next: FormThemeOverrides = { ...base }
                  if (w === 'normal') delete next.form_width
                  else next.form_width = w
                  if (w === 'custom') next.form_width_pct = clampFormWidthPct(base.form_width_pct)
                  else delete next.form_width_pct
                  setOverrides(next)
                }}
                className={cn('h-7 rounded border text-2xs font-medium disabled:opacity-40', current === w ? 'bg-primary-wash' : '', current === w ? 'border-primary' : 'border-border', current === w ? 'text-fg' : 'text-fg')}
              >
                {FORM_WIDTH_LABELS[w]}
              </button>
            )
          })}
        </div>
        {normalizeFormWidth(overrides.form_width) === 'custom' && (() => {
          const pct = clampFormWidthPct(overrides.form_width_pct)
          const setPct = (raw: string) => { if (raw.trim() && value.source === 'custom') setOverrides({ ...value.overrides, form_width: 'custom', form_width_pct: clampFormWidthPct(raw) }) }
          return (
            <div className="mt-2 flex items-center gap-2" data-form-width-pct-control>
              <input type="range" min={FORM_WIDTH_PCT.min} max={FORM_WIDTH_PCT.max} step={1} value={pct} disabled={!editable}
                aria-label="Form width, percent of the available width" className="flex-1 accent-primary"
                onChange={(e) => setPct(e.target.value)} data-form-width-pct-slider />
              <PctInput key={pct} value={pct} disabled={!editable} onCommit={setPct} />
              <span aria-hidden>%</span>
            </div>
          )
        })()}
        <p className="mt-1 text-2xs text-fg-muted">How wide the form card may grow. Normal keeps each page&apos;s usual width; Wide suits Data tables with many columns; Custom % takes a share of the available width (never under 320px, always full width on phones).</p>
      </div>

      {value.source === 'saved' && (
        <div>
          <Label>Saved form theme</Label>
          <AutocompleteSelect
            value={value.theme_id}
            options={savedThemes.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(id) => id && onChange({ source: 'saved', theme_id: id })}
          />
          <p className="mt-1 text-2xs text-fg-muted">Edits to the saved theme apply to new tasks. Choose Custom to start a copy.</p>
        </div>
      )}

      {editable && (
        <>
          <div>
            <Label>Start from a preset</Label>
            <AutocompleteSelect
              value={overrides.base_preset ?? ''}
              placeholder="Choose a preset…"
              options={THEME_TEMPLATES.map((t) => ({ value: t.id, label: t.name, hint: t.category }))}
              onChange={(id) => {
                const preset = id ? overridesFromPreset(id) : null
                if (preset) setOverrides({ ...overrides, ...preset })
              }}
            />
          </div>

          <div className="flex items-center gap-1" role="radiogroup" aria-label="Colours for">
            <span className="mr-1 text-2xs text-fg-muted">Colours for</span>
            {(['light', 'dark'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={cn('h-6 rounded border px-2 text-2xs font-medium text-fg', mode === m ? 'border-primary bg-primary-wash' : 'border-border')}>
                {m === 'light' ? 'Light mode' : 'Dark mode'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2">
            <ColorInput id={`${idPrefix}-accent-${mode}`} label="Accent (buttons, focus, selection)" value={colors.accent} onChange={(v) => setColors({ accent: v })} />
            <ColorInput id={`${idPrefix}-bg-${mode}`} label="Background" value={colors.background} onChange={(v) => setColors({ background: v })} />
            <ColorInput id={`${idPrefix}-text-${mode}`} label="Text" value={colors.text} onChange={(v) => setColors({ text: v })} />
            <details className="rounded border px-2 py-1 border-border" open={Boolean(colors.page || colors.input || colors.border || colors.button)}>
              <summary className="cursor-pointer text-2xs font-medium text-fg-muted">Page, inputs, borders and buttons</summary>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <ColorInput id={`${idPrefix}-page-${mode}`} label="Page background (behind the form)" value={colors.page} onChange={(v) => setColors({ page: v, ...(v ? {} : { page_to: undefined }) })} />
                {colors.page && <ColorInput id={`${idPrefix}-pageto-${mode}`} label="Page gradient to (optional)" value={colors.page_to} onChange={(v) => setColors({ page_to: v })} />}
                <ColorInput id={`${idPrefix}-input-${mode}`} label="Input background (default: the background)" value={colors.input} onChange={(v) => setColors({ input: v })} />
                <ColorInput id={`${idPrefix}-border-${mode}`} label="Borders (default: from the text)" value={colors.border} onChange={(v) => setColors({ border: v })} />
                <ColorInput id={`${idPrefix}-button-${mode}`} label="Primary buttons (default: the accent)" value={colors.button} onChange={(v) => setColors({ button: v })} />
              </div>
              <p className="mt-1 text-2xs text-fg-muted">Text on every colour is kept legible (contrast raised where needed).</p>
            </details>
          </div>
          {mode === 'dark' && !overrides.colors?.dark && (
            <p className="text-2xs text-fg-muted">No dark colours: dark mode keeps the workspace&apos;s dark palette with the light accent (made legible).</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${idPrefix}-radius`}>Corner radius ({overrides.radius ?? '—'}px)</Label>
              <input id={`${idPrefix}-radius`} type="range" min={0} max={24} value={overrides.radius ?? 8} onChange={(e) => setOverrides({ ...overrides, radius: Number(e.target.value) })} className="w-full accent-primary" />
            </div>
            <div>
              <Label>Font</Label>
              <AutocompleteSelect
                value={fontValue}
                placeholder="Workspace font"
                clearable
                options={FORM_THEME_FONTS}
                onChange={(v) => {
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted from the rest
                  if (!v) { const { font: _f, ...rest } = overrides; setOverrides(rest); return }
                  const [source, ...family] = v.split(':')
                  setOverrides({ ...overrides, font: { source: source as 'google', family: family.join(':') } })
                }}
              />
            </div>
            <div>
              <Label>Heading font</Label>
              <AutocompleteSelect
                value={headingFontValue}
                placeholder="Same as the body"
                clearable
                options={FORM_THEME_FONTS}
                onChange={(v) => {
                  if (!v) { setKey('heading_font', undefined); return }
                  const [source, ...family] = v.split(':')
                  setOverrides({ ...overrides, heading_font: { source: source as 'google', family: family.join(':') } })
                }}
              />
            </div>
            <div>
              <Label>Button shape</Label>
              <AutocompleteSelect value={overrides.button_shape ?? ''} placeholder="Corner radius" clearable
                options={FORM_BUTTON_SHAPES.map((v) => ({ value: v, label: SHAPE_LABELS[v] }))}
                onChange={(v) => setKey('button_shape', v as FormThemeOverrides['button_shape'])} />
            </div>
            <div>
              <Label>Shadow</Label>
              <AutocompleteSelect value={overrides.shadow ?? ''} placeholder="Default" clearable
                options={FORM_SHADOW_LEVELS.map((v) => ({ value: v, label: SHADOW_LABELS[v] }))}
                onChange={(v) => setKey('shadow', v as FormThemeOverrides['shadow'])} />
            </div>
            <div>
              <Label>Field style</Label>
              <AutocompleteSelect value={overrides.field_style ?? 'outlined'}
                options={FORM_FIELD_STYLES.map((v) => ({ value: v, label: FIELD_LABELS[v] }))}
                onChange={(v) => setKey('field_style', v as FormThemeOverrides['field_style'], 'outlined')} />
            </div>
            <div>
              <Label>Appearance</Label>
              <AutocompleteSelect value={overrides.appearance ?? 'workspace'}
                options={FORM_APPEARANCES.map((v) => ({ value: v, label: APPEARANCE_LABELS[v] }))}
                onChange={(v) => setKey('appearance', v as FormThemeOverrides['appearance'], 'workspace')} />
            </div>
            <div>
              <Label>Density</Label>
              <AutocompleteSelect value={overrides.density ?? 'comfortable'} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} onChange={(v) => setOverrides({ ...overrides, density: (v || 'comfortable') as 'compact' })} />
            </div>
            <div>
              <Label>Buttons</Label>
              <AutocompleteSelect value={overrides.button_placement ?? 'right'} options={[{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }, { value: 'full', label: 'Full width' }]} onChange={(v) => setOverrides({ ...overrides, button_placement: (v || 'right') as 'right' })} />
            </div>
            <div>
              <Label>Labels</Label>
              <AutocompleteSelect value={overrides.label_position ?? 'top'} options={[{ value: 'top', label: 'Above the input' }, { value: 'left', label: 'Left of the input' }]} onChange={(v) => setOverrides({ ...overrides, label_position: (v || 'top') as 'top' })} />
            </div>
          </div>

          <fieldset className="space-y-2 border-t pt-3 border-border">
            <legend className="pr-2 text-2xs font-semibold text-fg-muted">Header</legend>
            <label className="flex items-center gap-1.5 text-2xs">
              <input className="accent-primary" type="checkbox" checked={overrides.header?.enabled === true}
                onChange={(e) => setOverrides({ ...overrides, header: { ...overrides.header, enabled: e.target.checked } })} />
              Show a header above the form
            </label>
            {formHeaderOn && (
              <p className="text-2xs text-fg-muted" data-theme-header-note>
                This form has its own header (Buttons &amp; header tab), drawn in place of this one. Set the title and subtitle there; these fill in only where it has none.
              </p>
            )}
            {overrides.header?.enabled && (
              <>
                <div>
                  <Label htmlFor={`${idPrefix}-htitle`}>Title</Label>
                  <input id={`${idPrefix}-htitle`} className={inputClass} maxLength={120} value={overrides.header.title ?? ''} onChange={(e) => setOverrides({ ...overrides, header: { ...overrides.header!, title: e.target.value.replace(/[<>{}]/g, '') || undefined } })} />
                </div>
                <div>
                  <Label htmlFor={`${idPrefix}-hsub`}>Subtitle</Label>
                  <input id={`${idPrefix}-hsub`} className={inputClass} maxLength={300} value={overrides.header.subtitle ?? ''} onChange={(e) => setOverrides({ ...overrides, header: { ...overrides.header!, subtitle: e.target.value.replace(/[<>{}]/g, '') || undefined } })} />
                </div>
                <ColorInput id={`${idPrefix}-banner`} label="Banner colour (text colour is picked for it)" value={overrides.header.banner_color} onChange={(v) => setOverrides({ ...overrides, header: { ...overrides.header!, banner_color: v } })} />
                <label className="flex items-center gap-1.5 text-2xs">
                  <input className="accent-primary" type="checkbox" disabled={!logo} checked={Boolean(overrides.header.logo_url)}
                    onChange={(e) => setOverrides({ ...overrides, header: { ...overrides.header!, logo_url: e.target.checked ? logo : undefined } })} />
                  Show the workspace logo{!logo && ' (upload one in Settings → Theme)'}
                </label>
              </>
            )}
          </fieldset>
        </>
      )}

      {value.source !== 'workspace' && (
        <div className={cn('space-y-1.5 rounded-lg border p-2', issues.length ? 'border-warning' : 'border-border')} aria-live="polite">
          {issues.length === 0 ? (
            <p className="flex items-center gap-1.5 text-2xs text-fg"><Check className="text-success" size={12} /> Text is legible in light and dark mode.</p>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-2xs font-medium text-fg">
                <AlertTriangle className="text-warning" size={12} /> Low contrast — the form raises these colours when drawn:
              </p>
              <ul className="space-y-0.5 text-2xs text-fg-muted">
                {issues.map((issue, i) => (
                  <li key={i}>{issue.mode}: {issue.pair} {issue.ratio}:1 (needs {issue.required}:1){issue.blocking ? ' — must be fixed to save' : ''}</li>
                ))}
              </ul>
              {editable && (
                <button type="button" onClick={() => setOverrides(autoFixFormTheme(overrides, theme.colors))} className="flex items-center gap-1 text-2xs font-medium text-primary-text">
                  <WandSparkles size={11} /> Auto-fix colours
                </button>
              )}
            </>
          )}
          {blocking.length > 0 && <p className="text-2xs text-danger">{blocking.join('; ')}</p>}
        </div>
      )}

      {editable && canSaveTheme && onSaveTheme && (
        <div className="flex items-end gap-1 border-t pt-3 border-border">
          <div className="flex-1">
            <Label htmlFor={`${idPrefix}-savename`}>Save as a reusable form theme</Label>
            <input id={`${idPrefix}-savename`} className={inputClass} placeholder="Theme name" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          </div>
          <button
            type="button"
            disabled={!saveName.trim() || saveState.busy || blocking.length > 0}
            onClick={() => saveGuard.run(async () => {
              setSaveState({ busy: true })
              const result = await onSaveTheme(saveName.trim(), overrides)
              if ('error' in result) setSaveState({ busy: false, error: result.error })
              else { setSaveState({ busy: false, saved: true }); setSaveName(''); onChange({ source: 'saved', theme_id: result.id }) }
            })}
            className="flex h-8 items-center gap-1 rounded-md border px-2 text-2xs font-medium disabled:opacity-40 border-border text-fg"
          >
            <Save size={11} /> {saveState.busy ? 'Saving…' : 'Save theme'}
          </button>
        </div>
      )}
      {saveState.error && <p className="text-2xs text-danger">{saveState.error}</p>}
    </div>
  )
}
