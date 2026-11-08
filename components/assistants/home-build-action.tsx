'use client'

import Link from 'next/link'
import { ClipboardPen, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AssistantAvailability } from '@/lib/assistants/types'
import { openAgentForProcess, useAgentState } from './agent-store'

/**
 * Home's build quick action: "Build from a process with Agent" when the Agent
 * is available to this person and they can build (it opens the Agent with
 * the attach control focused and process starter prompts); otherwise the
 * form wizard's "Build a form" exactly as before (forms.wizard).
 */
export function homeBuildAction(availability: AssistantAvailability | null | undefined, canWizard: boolean): 'agent' | 'wizard' | null {
  if (availability?.agent && availability.designer) return 'agent'
  return canWizard ? 'wizard' : null
}

export function HomeBuildActionView({ action }: { action: 'agent' | 'wizard' | null }) {
  if (action === 'agent') {
    return (
      <Button type="button" variant="secondary" size="sm" leadingIcon={<Sparkles />} onClick={openAgentForProcess} data-home-build-agent>
        Build from a process with Agent
      </Button>
    )
  }
  if (action === 'wizard') {
    return (
      <Button asChild variant="secondary" size="sm" leadingIcon={<ClipboardPen />}>
        <Link href="/forms/wizard/new" data-home-build-form>Build a form</Link>
      </Button>
    )
  }
  return null
}

export function HomeBuildAction({ canWizard }: { canWizard: boolean }) {
  const { availability } = useAgentState()
  return <HomeBuildActionView action={homeBuildAction(availability, canWizard)} />
}
