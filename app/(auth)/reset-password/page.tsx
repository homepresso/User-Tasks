"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { resetPasswordAction } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"

/**
 * New password, set server side: for the recovery session Supabase's reset
 * link created (/auth/callback), or with the one-time `?token=` from the
 * built-in reset email. Either way the user ends up signed in.
 */
function ResetPasswordForm() {
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
      window.location.assign("/tasks")
    }
  }

  return (
    <Card>
      <h2 className="mb-6 text-center text-lg font-semibold text-gray-900 dark:text-[#1B1916]">
        Set new password
      </h2>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="password"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            New password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            required
            minLength={6}
          />
        </div>

        <div>
          <label
            htmlFor="confirm"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Confirm password
          </label>
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your password"
            required
            minLength={6}
          />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Updating..." : "Update password"}
        </Button>
      </form>
    </Card>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
