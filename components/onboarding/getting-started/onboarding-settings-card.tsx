'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Rocket } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { setOnboardingSettings } from '@/app/actions/workspace-settings'
import type { OnboardingState } from '@/lib/services/onboarding'
import { ONBOARDING_QUERY_KEY, useOnboarding } from './onboarding-provider'

/**
 * Settings → General → Getting started guide: whether people who join get
 * the short member checklist (on by default; settings.edit, saved as soon
 * as it's switched), and a way to open the guide again.
 */
export function OnboardingSettingsCard({ readOnly }: { readOnly: boolean }) {
  const { state, openGuide } = useOnboarding()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!state) return null
  const on = state.settings.show_to_members
  const change = async (next: boolean) => {
    setSaving(true); setError(null)
    const result = await setOnboardingSettings({ show_to_members: next })
    setSaving(false)
    if ('error' in result) { setError(result.error); return }
    queryClient.setQueryData<OnboardingState | null>(ONBOARDING_QUERY_KEY, (prev) => prev ? { ...prev, settings: result.settings } : prev)
  }
  return (
    <div className="space-y-3" data-onboarding-settings>
      <Switch
        checked={on}
        disabled={readOnly || saving}
        onCheckedChange={(next) => void change(next)}
        label={<span className="text-ui text-fg">Show the getting-started guide to new members <span className="block text-xs text-fg-muted">For their first 30 days: find their tasks, fill in a form, meet the Agent and set their preferences. Each person can save it for later or turn it off.</span></span>}
        data-onboarding-show-members
      />
      <Button variant="secondary" size="sm" leadingIcon={<Rocket />} onClick={() => openGuide()}>Open the guide</Button>
      {error && <InlineNotice tone="error" message={error} />}
    </div>
  )
}
