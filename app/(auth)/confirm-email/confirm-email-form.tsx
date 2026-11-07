"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { InlineNotice } from "@/components/ui/inline-notice"
import { verifyEmailAction } from "@/app/actions/auth"
import { AuthHeading } from "../auth-heading"
import { BackToSignIn } from "../forgot-password/forgot-password-form"

/**
 * Built-in auth: the confirmation link opens this page and the user confirms
 * with a button (a POST), so link scanners that prefetch email links can't
 * use up the one-time token.
 */
export function ConfirmEmailForm() {
  const token = useSearchParams().get("token") ?? ""
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function confirm() {
    setLoading(true)
    setError(null)
    const result = await verifyEmailAction(token)
    if (result.ok) {
      window.location.assign(result.redirect)
      return
    }
    setError(result.error)
    setLoading(false)
  }

  return (
    <div>
      <AuthHeading title="Confirm your email" description="Confirm this address to finish setting up your account and sign in." />
      {error && <InlineNotice tone="danger" className="mb-4" message={error} />}
      <Button size="lg" className="w-full" loading={loading} disabled={!token} onClick={confirm}>
        Confirm email
      </Button>
      <BackToSignIn />
    </div>
  )
}
