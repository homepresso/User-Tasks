'use client'

/**
 * "Ask Agent to fix" on a failed run (run history → the process view): the
 * same failure context as the test runner (lib/assistants/failure, secrets
 * masked) goes to the Agent, which explains the cause and may propose a
 * DRAFT workflow fix behind a confirmation card. It never retries the run and
 * never changes data (the context's rules say so, and the Agent has no retry
 * tool). Shown only when the Agent is on, the person has building help and
 * can edit the workflow.
 */
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { askAgentToFix, useAgentState } from '@/components/assistants/agent-store'
import { canAskAgentToFix, failureAttachment, runFailureInput, RUN_FIX_PROMPT, type FailureInput } from '@/lib/assistants/failure'
import { usePermissions } from '@/lib/permissions-context'

/* eslint-disable @typescript-eslint/no-explicit-any -- run payloads are JSON */

export function RunAskAgentFix({ run, workflow, logs }: { run: any; workflow: any; logs?: FailureInput['logs'] }) {
  const agent = useAgentState()
  const { can } = usePermissions()
  const input = runFailureInput(run, workflow, logs ?? [])
  if (!input || !canAskAgentToFix(agent.availability, can('workflows.edit' as never))) return null
  return (
    <Button size="sm" variant="secondary" leadingIcon={<Sparkles />} data-testid="run-ask-agent-fix"
      onClick={() => askAgentToFix(failureAttachment(input), null, RUN_FIX_PROMPT)}>
      Ask Agent to fix
    </Button>
  )
}
