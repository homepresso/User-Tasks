import { MailCheck } from "lucide-react"
import { pageMetadata } from "@/lib/page-title"
import { AuthHeading } from "../auth-heading"
import { BackToSignIn } from "../forgot-password/forgot-password-form"

export const metadata = pageMetadata("Check your email")

export default function CheckEmailPage() {
  return (
    <div>
      <div className="mb-4 inline-flex size-10 items-center justify-center rounded-lg border border-border bg-subtle text-fg-muted">
        <MailCheck className="size-5" aria-hidden />
      </div>
      <AuthHeading
        title="Check your email"
        description="We sent you a confirmation link. Open it to activate your account."
      />
      <BackToSignIn />
    </div>
  )
}
