'use client'

import { useState } from 'react'
import { createInvitation } from '@/app/actions/invitations'
import { useQueryClient } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Send } from 'lucide-react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { SubmitButton } from '@/components/ui/submit-button'

export function InviteForm() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  // Synchronous guard: React 19 renders state set inside a form action only
  // when it ends, so `sending` alone can't stop a second submit.
  const { pending: sending, run } = useSubmitGuard()
  const queryClient = useQueryClient()

  async function handleSubmit(formData: FormData) {
    await run(() => sendInvite(formData))
  }

  async function sendInvite(formData: FormData) {
    setError(null)
    setSuccess(false)

    try {
      await createInvitation(formData)
      setSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
      setTimeout(() => setSuccess(false), 3000)
      // Reset form
      const form = document.getElementById('invite-form') as HTMLFormElement
      form?.reset()
    } catch (e: any) {
      setError(e.message ?? 'Failed to send invitation')
    }
  }

  return (
    <form id="invite-form" action={handleSubmit} className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <Input name="email" type="email" required placeholder="colleague@company.com" />
        </div>
        <select
          name="role"
          defaultValue="viewer"
          className="rounded-lg border px-3 py-2 text-sm bg-panel border-border text-fg"
        >
          <option value="viewer">Viewer — read-only access</option>
          <option value="member">Member — create and complete tasks</option>
          <option value="manager">Manager — manage team tasks and workflows</option>
          <option value="admin">Admin — full access except billing</option>
        </select>
        <SubmitButton pending={sending} pendingLabel="Sending...">
          <Send size={14} className="mr-1" />
          Send Invitation
        </SubmitButton>
      </div>

      {error && (
        <p className="text-sm text-danger">{error}</p>
      )}
      {success && (
        <p className="text-sm text-success">
          Invitation sent! They'll receive an email to join.
        </p>
      )}
    </form>
  )
}
