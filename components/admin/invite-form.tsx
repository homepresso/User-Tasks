'use client'

import { useState } from 'react'
import { createInvitation } from '@/app/actions/invitations'
import { useQueryClient } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
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
      {/* Labelled controls (not placeholder-only); wraps on narrow screens. */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Email address" className="min-w-[14rem] flex-1">
          <Input id="invite-email" name="email" type="email" required placeholder="colleague@company.com" autoComplete="off" />
        </Field>
        <Field label="Role" className="min-w-[12rem]">
          <Select id="invite-role" name="role" defaultValue="viewer">
            <option value="viewer">Viewer — read-only access</option>
            <option value="member">Member — create and complete tasks</option>
            <option value="manager">Manager — manage team tasks and workflows</option>
            <option value="admin">Admin — full access except billing</option>
          </Select>
        </Field>
        <SubmitButton pending={sending} pendingLabel="Sending…">
          <Send size={14} className="mr-1" aria-hidden="true" />
          Send invitation
        </SubmitButton>
      </div>

      {/* Announced: the result of sending is otherwise silent for screen reader users. */}
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-danger">{error}</p>
        )}
        {success && (
          <p className="text-sm text-success">
            Invitation sent. They&apos;ll receive an email to join.
          </p>
        )}
      </div>
    </form>
  )
}
