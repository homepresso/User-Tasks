"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowRight, KeyRound } from "lucide-react"
import { Field } from "@/components/ui/field"
import { InlineNotice } from "@/components/ui/inline-notice"
import { BusyBar } from "@/components/ui/busy-bar"
import { PERMISSION_PAYLOAD_VERSION } from "@/lib/permissions"
import { getMySession } from "@/app/actions/session"
import { signInAction, startSsoAction } from "@/app/actions/auth"
import type { LoginOptions, SsoOption } from "@/lib/providers/auth/types"
import { sanitizeRedirect } from "@/lib/safe-redirect"

/** Fixed messages for the `?error=` codes the auth routes redirect with (never reflected text). */
const ERROR_MESSAGES: Record<string, string> = {
  no_invite: "You don't have an invitation to this organisation. Ask an admin to invite you.",
  auth_callback_error: "Sign-in could not be completed. Please try again.",
  sso_failed: "Single sign-on failed. Please try again, or contact your administrator.",
  sso_unavailable: "That sign-in option is not available.",
  no_profile: "Your account has no profile here yet. Ask an admin to invite you.",
}

/**
 * Sign-in form. Every step runs server side (app/actions/auth.ts): the
 * server action signs in, or creates the invited account, and sets httpOnly
 * session cookies; the browser never sees a token. Sign-in options come from
 * the configured auth provider (names and buttons only).
 */
export function LoginForm({ options, defaultOrg = "", singleOrg = null, signupHref = null }: {
  options: LoginOptions
  defaultOrg?: string
  /** Self-hosted with one organisation: shown by name instead of the organisation field (which "Change" brings back). */
  singleOrg?: { slug: string; name: string } | null
  /** Cloud edition: the self-signup link (`/start`, carrying `?redirect=`). Null on self-hosted, where sign-in is invite-only. */
  signupHref?: string | null
}) {
  const searchParams = useSearchParams()
  const redirectTo = sanitizeRedirect(searchParams.get("redirect"))
  const orgParam = searchParams.get("org") ?? defaultOrg
  const inviteToken = searchParams.get("invite") ?? ""

  const [tenant, setTenant] = useState(orgParam)
  const [editOrg, setEditOrg] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(ERROR_MESSAGES[searchParams.get("error") ?? ""] ?? null)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!tenant.trim()) { setError("Organisation is required."); return }
    if (!email.trim() || !password) { setError("Email and password are required."); return }

    setLoading(true)
    const slug = tenant.trim().toLowerCase()

    setStep("Signing in…")
    const result = await signInAction({ org: slug, email, password, inviteToken: inviteToken || null, redirect: redirectTo })

    if (!result.ok) {
      setError(result.error)
      setLoading(false)
      setStep("")
      return
    }

    if (result.step === "confirm_email") {
      window.location.assign(result.redirect)
      return
    }

    setStep(result.step === "created" ? "Welcome!" : "Welcome back!")
    // Pre-warm the auth cache for an instant dashboard load. Profile, role
    // and permissions come from a server action, which needs the session
    // cookie the sign-in action just set.
    const mine = await getMySession().catch(() => null)
    if (mine?.ok && mine.data.profile) {
      try {
        sessionStorage.setItem('dashboard_auth_cache', JSON.stringify({
          userId: mine.data.profile.id,
          profile: mine.data.profile,
          userRole: mine.data.role,
          permissions: mine.data.permissions,
          permissionVersion: PERMISSION_PAYLOAD_VERSION,
        }))
      } catch {}
    }
    window.location.assign(result.redirect)
  }

  async function handleSso(option: SsoOption) {
    // The configured IdPs can carry their own organisation; Supabase's Google /
    // Microsoft sign-in needs one from the form, as before.
    if (options.provider === "supabase" && !tenant.trim()) { setError("Enter your organisation name first."); return }
    setError(null)
    const result = await startSsoAction({ provider: option.id, org: tenant.trim().toLowerCase() || null, redirect: redirectTo })
    if (!result.ok) { setError(result.error); return }
    window.location.assign(result.url)
  }

  const ssoOptions = options.sso
  const showPassword = options.password
  const orgFixed = !!singleOrg && !editOrg && !inviteToken && tenant === singleOrg.slug
  const orgField = orgFixed ? (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-panel px-4 py-3">
      <p className="min-w-0 text-sm text-fg-muted">
        Organisation <strong className="ml-1 font-semibold text-fg">{singleOrg.name}</strong>
      </p>
      <button type="button" className="shrink-0 text-xs font-medium text-primary-text hover:underline" onClick={() => setEditOrg(true)}>
        Change
      </button>
    </div>
  ) : (
    <Field
      label="Organisation"
      optional={!showPassword}
      description={showPassword ? "The organisation name provided by your administrator." : undefined}
    >
      <Input id="tenant" size="lg" value={tenant} onChange={e => setTenant(e.target.value)} placeholder="your-organisation"
        required={showPassword} readOnly={!!orgParam && !!inviteToken} autoComplete="organization" />
    </Field>
  )

  return (
    <div>
      {inviteToken && (
        <InlineNotice tone="info" className="mb-6" message={<>You&apos;ve been invited to join <strong>{orgParam}</strong>.</>} />
      )}

      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-fg">Sign in</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {orgFixed ? "Enter your email and password." : "Enter your organisation, email and password."} New users with an invitation are set up automatically.
        </p>
      </div>

      {error && <InlineNotice tone="danger" className="mb-5" message={error} />}

      {loading ? (
        <div className="space-y-3 rounded-lg border border-border bg-panel p-5" role="status" aria-live="polite">
          <p className="text-sm font-medium text-fg">{step || "Signing in…"}</p>
          <BusyBar />
        </div>
      ) : (
        <>
          {showPassword ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {orgField}
              <Field label="Email address">
                <Input id="email" type="email" size="lg" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" />
              </Field>
              <Field label="Password" labelAside={<Link href="/forgot-password" className="text-xs font-medium text-primary-text hover:underline">Forgot password?</Link>}>
                <Input id="password" type="password" size="lg" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required autoComplete="current-password" />
              </Field>
              <Button type="submit" size="lg" className="mt-2 w-full" trailingIcon={<ArrowRight />}>
                Sign in
              </Button>
            </form>
          ) : orgField}

          {ssoOptions.length > 0 && (
            <>
              {showPassword && (
                <div className="my-6 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border-subtle" />
                  <span className="text-xs text-fg-muted">or continue with</span>
                  <div className="h-px flex-1 bg-border-subtle" />
                </div>
              )}
              <div className={`space-y-2 ${showPassword ? "" : "mt-6"}`}>
                {ssoOptions.map((option) => (
                  <Button key={option.id} variant="secondary" size="lg" className="w-full" leadingIcon={<SsoIcon kind={option.kind} />} onClick={() => handleSso(option)}>
                    {option.name}
                  </Button>
                ))}
              </div>
            </>
          )}

          {signupHref ? (
            <div className="mt-8 space-y-2 border-t border-border-subtle pt-6 text-center" data-testid="login-signup">
              <p className="text-sm text-fg-muted">
                No account?{" "}
                <Link href={signupHref} className="font-semibold text-primary-text hover:underline">Create a free workspace</Link>
              </p>
              {showPassword && (
                <p className="text-xs text-fg-muted">Invited to an organisation? Enter your details above and your account is created automatically.</p>
              )}
            </div>
          ) : showPassword && (
            <p className="mt-8 text-center text-xs text-fg-muted">
              New here? Enter your details above. If you have an invitation, your account is created automatically.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function SsoIcon({ kind }: { kind: SsoOption["kind"] }) {
  if (kind === "google") {
    return (
      <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    )
  }
  if (kind === "microsoft") {
    return (
      <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 2h9.5v9.5H2z" fill="#F25022" />
        <path d="M12.5 2H22v9.5h-9.5z" fill="#7FBA00" />
        <path d="M2 12.5h9.5V22H2z" fill="#00A4EF" />
        <path d="M12.5 12.5H22V22h-9.5z" fill="#FFB900" />
      </svg>
    )
  }
  return <KeyRound className="size-4" aria-hidden />
}
