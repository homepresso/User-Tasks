'use client'

import { useEffect, useState } from 'react'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { serverRead } from '@/lib/server-read'
import { systemNameProblem, SYSTEM_NAME_MAX } from '@/lib/forms/system-name'

/**
 * Form Settings → System name: the friendly link name
 * (acme.usertasks.com/form/<system name>). Checked as you type (format) and
 * on the server (another form of the workspace has it). A rename keeps the
 * old name as a redirect, so shared links keep working.
 */
export function FormSystemNameField({ formId, formName, value, saved, onChange, onValidity }: {
  formId: string
  formName: string
  value: string
  /** The stored name (null = none yet). */
  saved: string | null
  onChange: (value: string) => void
  /** Whether the value can be saved (false while invalid or taken). */
  onValidity: (ok: boolean) => void
}) {
  const [check, setCheck] = useState<{ value: string; reason: string | null; redirects: boolean } | null>(null)
  const [link, setLink] = useState<{ workspace_url: string | null } | null>(null)
  const trimmed = value.trim().toLowerCase()
  const changed = trimmed !== (saved ?? '')
  const localProblem = trimmed ? systemNameProblem(trimmed) : null

  useEffect(() => {
    let active = true
    serverRead('forms.friendlyLink', { form_id: formId }).then(({ data }) => { if (active && data) setLink({ workspace_url: data.workspace_url }) })
    return () => { active = false }
  }, [formId])

  useEffect(() => {
    if (!changed || !trimmed || localProblem) return
    let active = true
    const timer = setTimeout(() => {
      serverRead('forms.systemNameCheck', { system_name: trimmed, form_id: formId }).then(({ data }) => {
        if (active && data) setCheck({ value: trimmed, reason: data.reason, redirects: Boolean(data.redirects_from_form) })
      })
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [trimmed, changed, localProblem, formId])

  const serverProblem = check && check.value === trimmed ? check.reason : null
  const error = changed ? (trimmed ? (localProblem ?? serverProblem) : 'Enter a system name.') : null
  const pending = changed && trimmed && !localProblem && check?.value !== trimmed
  useEffect(() => { onValidity(!error && !pending) }, [error, pending, onValidity])

  async function suggest() {
    const { data } = await serverRead('forms.systemNameSuggest', { name: formName, form_id: formId })
    if (data) onChange(data)
  }

  const base = link?.workspace_url ? link.workspace_url.replace(/^https?:\/\//, '') : null
  return (
    <div className="space-y-1.5" data-testid="form-system-name-section">
      <Field
        label="System name"
        error={error ?? undefined}
        labelAside={<Button type="button" size="sm" variant="link" onClick={() => void suggest()}>Suggest from name</Button>}
        description={
          changed && saved && !error
            ? <>Links to <span className="font-mono">/form/{saved}</span> keep working: they redirect to the new name.{check?.value === trimmed && check.redirects ? ' Another form’s old links use this name; they will open this form instead.' : ''}</>
            : `Used in the form’s friendly link. Lowercase letters, numbers and hyphens, 3–${SYSTEM_NAME_MAX} characters.`
        }
      >
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          maxLength={SYSTEM_NAME_MAX + 10}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          data-testid="form-system-name"
        />
      </Field>
      <p className="text-xs text-fg-muted" data-testid="form-system-name-preview">
        {base
          ? <>Friendly link: <span className="font-mono text-fg">{base}/form/{trimmed || '…'}</span></>
          : <>Friendly links need a workspace address (Settings → General). Until then the form opens at <span className="font-mono">/form/{trimmed || '…'}</span> for signed-in members.</>}
      </p>
    </div>
  )
}
