'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Save, WandSparkles } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { useWorkspaceTheme } from '@/components/providers/theme-provider'
import {
  autoFixFormTheme, blockingFormThemeIssues, formThemeContrast, overridesFromPreset, FORM_THEME_FONTS,
  type FormThemeColors, type FormThemeOverrides, type FormThemeRef,
} from '@/lib/forms/form-theme'
import { isValidColor } from '@/lib/theme/colors'
import { THEME_TEMPLATES } from '@/lib/theme/presets'
import type { ThemeMode } from '@/lib/theme/schema'

/**
 * Mini-theme editor: inherit the workspace theme, pick a saved Form theme,
 * or set a few overrides (start from a built-in preset). Contrast is checked
 * against the workspace palette for both modes; failing pairs are listed
 * with an auto-fix, and the renderer raises them anyway so text is never
 * illegible.
 */

export interface SavedFormTheme { id: string; name: string; overrides: FormThemeOverrides }

const inputClass = 'h-8 w-full rounded-md border px-2 text-xs outline-none focus-visible:ring-2'
const inputStyle: React.CSSProperties = {
  borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)',
  ['--tw-ring-color' as string]: 'var(--theme-primary)',
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>{children}</label>
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
        <input type="color" aria-label={`${label} picker`} value={hex} onChange={(e) => onChange(e.target.value)} className="h-8 w-8 shrink-0 cursor-pointer rounded border p-0.5" style={{ borderColor: 'var(--theme-surface-border)' }} />
        <input
          id={id}
          className={`${inputClass} font-mono`}
          style={{ ...inputStyle, ...(draft && !isValidColor(draft) ? { borderColor: 'var(--status-blocked)' } : {}) }}
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

export function ThemeEditor({ value, onChange, savedThemes, canSaveTheme, onSaveTheme, idPrefix = 'te' }: {
  value: FormThemeRef
  onChange: (next: FormThemeRef) => void
  savedThemes: SavedFormTheme[]
  canSaveTheme: boolean
  /** Save the current overrides as a reusable Form theme; resolves to its id (or an error message). */
  onSaveTheme?: (name: string, overrides: FormThemeOverrides) => Promise<{ id: string } | { error: string }>
  idPrefix?: string
}) {
  const { theme } = useWorkspaceTheme()
  const [mode, setMode] = useState<ThemeMode>('light')
  const [saveName, setSaveName] = useState('')
  const [saveState, setSaveState] = useState<{ busy: boolean; error?: string; saved?: boolean }>({ busy: false })
  const overrides: FormThemeOverrides = value.source === 'custom' ? value.overrides
    : value.source === 'saved' ? (savedThemes.find((t) => t.id === value.theme_id)?.overrides ?? {}) : {}
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
            className="h-8 rounded border text-[10px] font-medium disabled:opacity-40"
            style={value.source === source
              ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }
              : { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {value.source === 'workspace' && (
        <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>The form uses the workspace theme (light and dark) as it is.</p>
      )}

      {value.source === 'saved' && (
        <div>
          <Label>Saved form theme</Label>
          <AutocompleteSelect
            value={value.theme_id}
            options={savedThemes.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(id) => id && onChange({ source: 'saved', theme_id: id })}
          />
          <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Edits to the saved theme apply to new tasks. Choose Custom to start a copy.</p>
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
            <span className="mr-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Colours for</span>
            {(['light', 'dark'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className="h-6 rounded border px-2 text-[10px] font-medium capitalize"
                style={mode === m ? { backgroundColor: 'var(--theme-primary-light)', borderColor: 'var(--theme-primary)', color: 'var(--theme-card-text)' } : { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
                {m} mode
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2">
            <ColorInput id={`${idPrefix}-accent-${mode}`} label="Accent (buttons, focus, selection)" value={colors.accent} onChange={(v) => setColors({ accent: v })} />
            <ColorInput id={`${idPrefix}-bg-${mode}`} label="Background" value={colors.background} onChange={(v) => setColors({ background: v })} />
            <ColorInput id={`${idPrefix}-text-${mode}`} label="Text" value={colors.text} onChange={(v) => setColors({ text: v })} />
            <details className="rounded border px-2 py-1" style={{ borderColor: 'var(--theme-surface-border)' }} open={Boolean(colors.page || colors.input || colors.border || colors.button)}>
              <summary className="cursor-pointer text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Page, inputs, borders and buttons</summary>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <ColorInput id={`${idPrefix}-page-${mode}`} label="Page background (behind the form)" value={colors.page} onChange={(v) => setColors({ page: v, ...(v ? {} : { page_to: undefined }) })} />
                {colors.page && <ColorInput id={`${idPrefix}-pageto-${mode}`} label="Page gradient to (optional)" value={colors.page_to} onChange={(v) => setColors({ page_to: v })} />}
                <ColorInput id={`${idPrefix}-input-${mode}`} label="Input background (default: the background)" value={colors.input} onChange={(v) => setColors({ input: v })} />
                <ColorInput id={`${idPrefix}-border-${mode}`} label="Borders (default: from the text)" value={colors.border} onChange={(v) => setColors({ border: v })} />
                <ColorInput id={`${idPrefix}-button-${mode}`} label="Primary buttons (default: the accent)" value={colors.button} onChange={(v) => setColors({ button: v })} />
              </div>
              <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Text on every colour is kept legible (contrast raised where needed).</p>
            </details>
          </div>
          {mode === 'dark' && !overrides.colors?.dark && (
            <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>No dark colours: dark mode keeps the workspace&apos;s dark palette with the light accent (made legible).</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${idPrefix}-radius`}>Corner radius ({overrides.radius ?? '—'}px)</Label>
              <input id={`${idPrefix}-radius`} type="range" min={0} max={24} value={overrides.radius ?? 8} onChange={(e) => setOverrides({ ...overrides, radius: Number(e.target.value) })} className="w-full" style={{ accentColor: 'var(--theme-primary)' }} />
            </div>
            <div>
              <Label>Font</Label>
              <AutocompleteSelect
                value={fontValue}
                placeholder="Workspace font"
                clearable
                options={FORM_THEME_FONTS}
                onChange={(v) => {
                  if (!v) { const { font: _f, ...rest } = overrides; setOverrides(rest); return }
                  const [source, ...family] = v.split(':')
                  setOverrides({ ...overrides, font: { source: source as 'google', family: family.join(':') } })
                }}
              />
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

          <fieldset className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <legend className="pr-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Header</legend>
            <label className="flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={overrides.header?.enabled === true} style={{ accentColor: 'var(--theme-primary)' }}
                onChange={(e) => setOverrides({ ...overrides, header: { ...overrides.header, enabled: e.target.checked } })} />
              Show a header above the form
            </label>
            {overrides.header?.enabled && (
              <>
                <div>
                  <Label htmlFor={`${idPrefix}-htitle`}>Title</Label>
                  <input id={`${idPrefix}-htitle`} className={inputClass} style={inputStyle} maxLength={120} value={overrides.header.title ?? ''} onChange={(e) => setOverrides({ ...overrides, header: { ...overrides.header!, title: e.target.value.replace(/[<>{}]/g, '') || undefined } })} />
                </div>
                <div>
                  <Label htmlFor={`${idPrefix}-hsub`}>Subtitle</Label>
                  <input id={`${idPrefix}-hsub`} className={inputClass} style={inputStyle} maxLength={300} value={overrides.header.subtitle ?? ''} onChange={(e) => setOverrides({ ...overrides, header: { ...overrides.header!, subtitle: e.target.value.replace(/[<>{}]/g, '') || undefined } })} />
                </div>
                <ColorInput id={`${idPrefix}-banner`} label="Banner colour (text colour is picked for it)" value={overrides.header.banner_color} onChange={(v) => setOverrides({ ...overrides, header: { ...overrides.header!, banner_color: v } })} />
                <label className="flex items-center gap-1.5 text-[11px]">
                  <input type="checkbox" disabled={!logo} checked={Boolean(overrides.header.logo_url)} style={{ accentColor: 'var(--theme-primary)' }}
                    onChange={(e) => setOverrides({ ...overrides, header: { ...overrides.header!, logo_url: e.target.checked ? logo : undefined } })} />
                  Show the workspace logo{!logo && ' (upload one in Settings → Theme)'}
                </label>
              </>
            )}
          </fieldset>
        </>
      )}

      {value.source !== 'workspace' && (
        <div className="space-y-1.5 rounded-lg border p-2" style={{ borderColor: issues.length ? 'var(--theme-warning)' : 'var(--theme-surface-border)' }} aria-live="polite">
          {issues.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--theme-card-text)' }}><Check size={12} style={{ color: 'var(--theme-success)' }} /> Text is legible in light and dark mode.</p>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--theme-card-text)' }}>
                <AlertTriangle size={12} style={{ color: 'var(--theme-warning)' }} /> Low contrast — the form raises these colours when drawn:
              </p>
              <ul className="space-y-0.5 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                {issues.map((issue, i) => (
                  <li key={i}>{issue.mode}: {issue.pair} {issue.ratio}:1 (needs {issue.required}:1){issue.blocking ? ' — must be fixed to save' : ''}</li>
                ))}
              </ul>
              {editable && (
                <button type="button" onClick={() => setOverrides(autoFixFormTheme(overrides, theme.colors))} className="flex items-center gap-1 text-[10px] font-medium" style={{ color: 'var(--theme-primary-text)' }}>
                  <WandSparkles size={11} /> Auto-fix colours
                </button>
              )}
            </>
          )}
          {blocking.length > 0 && <p className="text-[10px]" style={{ color: 'var(--status-blocked)' }}>{blocking.join('; ')}</p>}
        </div>
      )}

      {editable && canSaveTheme && onSaveTheme && (
        <div className="flex items-end gap-1 border-t pt-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div className="flex-1">
            <Label htmlFor={`${idPrefix}-savename`}>Save as a reusable form theme</Label>
            <input id={`${idPrefix}-savename`} className={inputClass} style={inputStyle} placeholder="Theme name" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          </div>
          <button
            type="button"
            disabled={!saveName.trim() || saveState.busy || blocking.length > 0}
            onClick={async () => {
              setSaveState({ busy: true })
              const result = await onSaveTheme(saveName.trim(), overrides)
              if ('error' in result) setSaveState({ busy: false, error: result.error })
              else { setSaveState({ busy: false, saved: true }); setSaveName(''); onChange({ source: 'saved', theme_id: result.id }) }
            }}
            className="flex h-8 items-center gap-1 rounded-md border px-2 text-[10px] font-medium disabled:opacity-40"
            style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
          >
            <Save size={11} /> {saveState.busy ? 'Saving…' : 'Save theme'}
          </button>
        </div>
      )}
      {saveState.error && <p className="text-[10px]" style={{ color: 'var(--status-blocked)' }}>{saveState.error}</p>}
    </div>
  )
}
