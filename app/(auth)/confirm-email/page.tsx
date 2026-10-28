"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { verifyEmailAction } from "@/app/actions/auth"

/**
 * Built-in auth: the confirmation link opens this page and the user confirms
 * with a button (a POST), so link scanners that prefetch email links can't
 * use up the one-time token.
 */
function ConfirmEmail() {
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
    <Card className="text-center">
      <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-[#1B1916]">Confirm your email</h2>
      <p className="mb-6 text-sm text-gray-500">Confirm this address to finish setting up your account and sign in.</p>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div>
      )}
      <Button className="w-full" disabled={loading || !token} onClick={confirm}>
        {loading ? "Confirming..." : "Confirm email"}
      </Button>
      <p className="mt-6 text-sm text-gray-500">
        <Link href="/login" className="text-[#17150F] hover:text-[#8A6D45]">Back to sign in</Link>
      </p>
    </Card>
  )
}

export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmail />
    </Suspense>
  )
}
