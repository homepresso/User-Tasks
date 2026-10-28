"use client"

import { useState } from "react"
import Link from "next/link"
import { requestPasswordResetAction } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"

export default function ForgotPasswordPage() {
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
      <Card className="text-center">
        <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-[#1B1916]">
          Check your email
        </h2>
        <p className="mb-6 text-sm text-gray-500">
          We sent a password reset link to <strong>{email}</strong>
        </p>
        <Link href="/login" className="text-sm text-[#17150F] hover:text-[#7C623E]">
          Back to sign in
        </Link>
      </Card>
    )
  }

  return (
    <Card>
      <h2 className="mb-2 text-center text-lg font-semibold text-gray-900 dark:text-[#1B1916]">
        Reset your password
      </h2>
      <p className="mb-6 text-center text-sm text-gray-500">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleReset} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Email
          </label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Sending..." : "Send reset link"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        <Link href="/login" className="text-[#17150F] hover:text-[#7C623E]">
          Back to sign in
        </Link>
      </p>
    </Card>
  )
}
