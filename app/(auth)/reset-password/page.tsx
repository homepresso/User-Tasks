import { Suspense } from "react"
import { pageMetadata } from "@/lib/page-title"
import { ResetPasswordForm } from "./reset-password-form"

export const metadata = pageMetadata("Set a new password")

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
