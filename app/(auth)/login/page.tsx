import { Suspense } from "react"
import { getLoginOptions } from "@/app/actions/auth"
import type { LoginOptions } from "@/lib/providers/auth/types"
import { LoginForm } from "./login-form"
import { pageMetadata } from "@/lib/page-title"
import { notFound, permanentRedirect, redirect } from "next/navigation"
import { getHostWorkspace, loginUrlFor, originForSubdomain } from "@/lib/workspace-host"
import { sanitizeRedirect } from "@/lib/safe-redirect"
import { isCloud } from "@/lib/deployment"
import { signupHref } from "@/lib/signup-link"
import { redirectToSetupIfNeeded, singleOrganisation } from "@/lib/setup/server"
import { autoSsoPath } from "@/lib/providers/auth/sso/auto"
import { resolveAutoSso } from "@/lib/providers/auth/sso/auto-server"

export const metadata = pageMetadata("Sign in")

// Sign-in options are runtime config (auth provider, SSO IdPs), not build-time.
export const dynamic = "force-dynamic"

const FALLBACK: LoginOptions = { provider: "supabase", password: true, sso: [] }

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // On a workspace address: sign in where every auth flow lives (the apex,
  // when sessions are shared across subdomains), back to this address after.
  // A brand-new self-hosted install has nobody to sign in yet: /setup first.
  await redirectToSetupIfNeeded()
  const host = await getHostWorkspace()
  const query = await searchParams
  let defaultOrg = ""
  // A workspace's own sign-in page is for its members: no self-signup link there.
  const signup = isCloud() && host.kind !== "workspace" ? signupHref(query.redirect) : null
  if (host.kind === "unknown") notFound()
  if (host.kind === "moved") {
    const origin = originForSubdomain(host.subdomain)
    if (origin) permanentRedirect(`${origin}/login`)
  }
  if (host.kind === "workspace") {
    const back = sanitizeRedirect(typeof query.redirect === "string" ? query.redirect : null)
    const target = loginUrlFor(host.tenant, back)
    // Keep "show the page" (after signing out / ?local=1) across the hop to the apex.
    const keep = ["local", "signed_out"].filter((k) => query[k]).map((k) => `&${k}=1`).join("")
    if (/^https?:\/\//.test(target)) redirect(`${target}${keep}`)
    defaultOrg = host.tenant.slug
  }
  // SSO only (workspace or instance, lib/providers/auth/sso/auto.ts): straight
  // to the identity provider. The page still shows after an error, after
  // signing out, and with ?local=1 (the administrators' way in when the IdP
  // is down).
  if (!query.error && !query.local && !query.signed_out && !query.invite) {
    const orgHint = typeof query.org === "string" ? query.org : defaultOrg || null
    const auto = await resolveAutoSso({ org: orgHint, purpose: "login" })
    if (auto) {
      const back = sanitizeRedirect(typeof query.redirect === "string" ? query.redirect : null)
      redirect(autoSsoPath({ redirect: back, org: auto.org, purpose: "login" }))
    }
  }
  const [options, onlyOrg] = await Promise.all([
    getLoginOptions().catch((error) => {
      console.error("[auth] login options unavailable:", (error as Error).message)
      return FALLBACK
    }),
    // Self-hosted with one organisation: sign in to it without typing its slug.
    defaultOrg ? null : singleOrganisation(),
  ])
  return (
    <Suspense>
      <LoginForm options={options} defaultOrg={defaultOrg || onlyOrg?.slug || ""} singleOrg={onlyOrg} signupHref={signup} />
    </Suspense>
  )
}
