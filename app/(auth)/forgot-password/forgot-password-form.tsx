"use client"

import { useState } from "react"
import Link from "next/link"
import { requestPasswordResetAction } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { InlineNotice } from "@/components/ui/inline-notice"
import { AuthHeading } from "../auth-heading"

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Server side: the auth provider sends the reset link (Supabase Auth's
    // email, or the app's own with built-in auth).
    const result = await requestPasswordResetAction(email)

    if (!result.ok) {
      setError(result.error)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div>
        <AuthHeading title="Check your email" description={<>We sent a password reset link to <strong className="font-medium text-fg">{email}</strong>.</>} />
        <BackToSignIn />
      </div>
    )
  }

  return (
    <div>
      <AuthHeading title="Reset your password" description="Enter your email and we'll send you a reset link." />
      {error && <InlineNotice tone="danger" className="mb-4" message={error} />}
      <form onSubmit={handleReset} className="space-y-4">
        <Field label="Email">
          <Input id="email" type="email" size="lg" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Send reset link
        </Button>
      </form>
      <BackToSignIn />
    </div>
  )
}

export function BackToSignIn() {
  return (
    <p className="mt-6 text-center text-sm">
      <Link href="/login" className="font-medium text-primary-text hover:underline">Back to sign in</Link>
    </p>
  )
}
