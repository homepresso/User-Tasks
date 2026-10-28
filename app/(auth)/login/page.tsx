import { Suspense } from "react"
import { getLoginOptions } from "@/app/actions/auth"
import type { LoginOptions } from "@/lib/providers/auth/types"
import { LoginForm } from "./login-form"

// Sign-in options are runtime config (auth provider, SSO IdPs), not build-time.
export const dynamic = "force-dynamic"

const FALLBACK: LoginOptions = { provider: "supabase", password: true, sso: [] }

export default async function LoginPage() {
  const options = await getLoginOptions().catch((error) => {
    console.error("[auth] login options unavailable:", (error as Error).message)
    return FALLBACK
  })
  return (
    <Suspense>
      <LoginForm options={options} />
    </Suspense>
  )
}
