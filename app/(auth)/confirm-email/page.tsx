import { Suspense } from "react"
import { pageMetadata } from "@/lib/page-title"
import { ConfirmEmailForm } from "./confirm-email-form"

export const metadata = pageMetadata("Confirm your email")

export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmailForm />
    </Suspense>
  )
}
