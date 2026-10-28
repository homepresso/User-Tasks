'use client'

import { useState } from 'react'
import { createInvitation } from '@/app/actions/invitations'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Send } from 'lucide-react'

export function InviteForm() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [sending, setSending] = useState(false)
  const queryClient = useQueryClient()

  async function handleSubmit(formData: FormData) {
    setSending(true)
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
    } finally {
      setSending(false)
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
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
        >
          <option value="viewer">Viewer — read-only access</option>
          <option value="member">Member — create and complete tasks</option>
          <option value="manager">Manager — manage team tasks and workflows</option>
          <option value="admin">Admin — full access except billing</option>
        </select>
        <Button type="submit" disabled={sending}>
          <Send size={14} className="mr-1" />
          {sending ? 'Sending...' : 'Send Invitation'}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
      {success && (
        <p className="text-sm" style={{ color: 'var(--theme-success)' }}>
          Invitation sent! They'll receive an email to join.
        </p>
      )}
    </form>
  )
}
