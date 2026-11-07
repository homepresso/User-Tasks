'use client'

import { useEffect, useState } from 'react'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Radio } from '@/components/ui/checkbox'
import { SettingsSaveBar } from './settings-section'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { serverRead } from '@/lib/server-read'
import { setFormAccessibilitySettings } from '@/app/actions/workspace-settings'
import { DEFAULT_FORM_ACCESSIBILITY, type FormAccessibilityMode, type FormAccessibilitySettings } from '@/lib/forms/accessibility/settings'

/**
 * Settings → Forms: the accessibility check run when a form is saved
 * (designer footer; reusable forms and form pages also on the server when
 * the mode is "block").
 */

const MODES: Array<{ value: FormAccessibilityMode; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'Forms save whatever their score.' },
  { value: 'warn', label: 'Warn', hint: 'The designer warns below the minimum score; the author can save anyway.' },
  { value: 'block', label: 'Block', hint: 'Forms below the minimum score cannot be saved or published (designer, API, MCP, CLI).' },
]

export function FormAccessibilityCard({ readOnly }: { readOnly: boolean }) {
  const [settings, setSettings] = useState<FormAccessibilitySettings | null>(null)
  const [draft, setDraft] = useState<FormAccessibilitySettings>(DEFAULT_FORM_ACCESSIBILITY)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const guard = useSubmitGuard()

  useEffect(() => {
    let active = true
    serverRead('forms.accessibilitySettings').then(({ data }) => {
      if (!active) return
      const value = data ?? DEFAULT_FORM_ACCESSIBILITY
      setSettings(value)
      setDraft(value)
    })
    return () => { active = false }
  }, [])

  const dirty = settings !== null && (draft.mode !== settings.mode || draft.min_score !== settings.min_score)
  const scoreValid = Number.isInteger(draft.min_score) && draft.min_score >= 0 && draft.min_score <= 100

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!scoreValid) return
    void guard.run(async () => {
      setNotice(null)
      const result = await setFormAccessibilitySettings(draft)
      if ('error' in result) { setNotice({ tone: 'error', message: result.error }); return }
      setSettings(result.settings)
      setDraft(result.settings)
      setNotice({ tone: 'success', message: 'Saved.' })
    })
  }

  if (!settings) return <p className="text-sm text-fg-muted">Loading…</p>

  return (
    <form onSubmit={save} className="space-y-4" aria-label="Form accessibility check">
      <fieldset disabled={readOnly} className="space-y-2">
        <legend className="mb-1.5 text-ui font-medium text-fg">When a form is saved</legend>
        {MODES.map((m) => (
          <Radio
            key={m.value}
            name="form-a11y-mode"
            value={m.value}
            checked={draft.mode === m.value}
            onChange={() => setDraft({ ...draft, mode: m.value })}
            label={<span className="font-medium">{m.label}</span>}
            description={m.hint}
            className="flex"
          />
        ))}
      </fieldset>
      <Field label="Minimum score" description="The designer's Accessibility tab scores each form against WCAG 2.2 AA from 0 to 100; 100 means no findings.">
        <Input
          id="form-a11y-min" type="number" min={0} max={100} step={1} inputMode="numeric" disabled={readOnly || draft.mode === 'off'}
          value={Number.isFinite(draft.min_score) ? draft.min_score : ''}
          onChange={(e) => setDraft({ ...draft, min_score: e.target.value === '' ? NaN : Number(e.target.value) })}
          aria-invalid={!scoreValid || undefined}
          className="num w-28"
        />
      </Field>
      {notice?.tone === 'success' && <p role="status" className="text-xs text-success">{notice.message}</p>}
      {!readOnly && (
        <SettingsSaveBar
          dirty={dirty && scoreValid}
          saving={guard.pending}
          error={notice?.tone === 'error' ? notice.message : null}
          onDiscard={() => { setDraft(settings); setNotice(null) }}
          saveLabel="Save accessibility check"
          saveTestId="form-a11y-save"
        />
      )}
    </form>
  )
}
