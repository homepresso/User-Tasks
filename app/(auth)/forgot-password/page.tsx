import { pageMetadata } from "@/lib/page-title"
import { ForgotPasswordForm } from "./forgot-password-form"

export const metadata = pageMetadata("Reset your password")

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />
}
