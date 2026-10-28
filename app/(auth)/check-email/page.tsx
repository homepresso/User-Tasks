import Link from "next/link"
import { Card } from "@/components/ui/card"

export default function CheckEmailPage() {
  return (
    <Card className="text-center">
      <div className="mb-4 text-4xl">📬</div>
      <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-[#1B1916]">
        Check your email
      </h2>
      <p className="mb-6 text-sm text-gray-500">
        We sent you a confirmation link. Click the link in the email to activate
        your account.
      </p>
      <Link
        href="/login"
        className="text-sm text-[#17150F] hover:text-[#7C623E]"
      >
        Back to sign in
      </Link>
    </Card>
  )
}
