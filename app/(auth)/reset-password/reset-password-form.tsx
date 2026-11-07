"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { resetPasswordAction } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { InlineNotice } from "@/components/ui/inline-notice"
import { AuthHeading } from "../auth-heading"

/**
 * New password, set server side: for the recovery session Supabase's reset
 * link created (/auth/callback), or with the one-time `?token=` from the
 * built-in reset email. Either way the user ends up signed in.
 */
export function ResetPasswordForm() {
  const token = useSearchParams().get("token")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError("Passwords do not match")
      return
    }

    setLoading(true)
    setError(null)

    const result = await resetPasswordAction({ password, token })

    if (!result.ok) {
      setError(result.error)
      setLoading(false)
    } else {
      window.location.assign("/home")
    }
  }

  return (
    <div>
      <AuthHeading title="Set a new password" />
      {error && <InlineNotice tone="danger" className="mb-4" message={error} />}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="New password" description="At least 6 characters.">
          <Input id="password" type="password" size="lg" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <Input id="confirm" type="password" size="lg" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat your password" required minLength={6} autoComplete="new-password" />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Update password
        </Button>
      </form>
    </div>
  )
}
