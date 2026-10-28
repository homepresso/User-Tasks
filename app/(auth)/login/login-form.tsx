"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowRight, KeyRound, LogIn, Shield, CheckCircle2 } from "lucide-react"
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
export function LoginForm({ options }: { options: LoginOptions }) {
  const searchParams = useSearchParams()
  const redirectTo = sanitizeRedirect(searchParams.get("redirect"))
  const orgParam = searchParams.get("org") ?? ""
  const inviteToken = searchParams.get("invite") ?? ""

  const [tenant, setTenant] = useState(orgParam)
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

    setStep("Signing in...")
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

  return (
    <div>
      {inviteToken && (
        <div className="mb-6 rounded-lg border p-3" style={{ backgroundColor: 'rgba(23,21,15,0.10)', borderColor: 'rgba(23,21,15,0.30)' }}>
          <p className="text-sm font-medium" style={{ color: '#7C623E' }}>
            You've been invited to join <strong>{orgParam}</strong>
          </p>
        </div>
      )}

      <div className="mb-8">
        <h2 className="text-2xl font-bold" style={{ color: '#1B1916' }}>Sign in</h2>
        <p className="text-sm mt-1" style={{ color: '#7E623A' }}>
          Enter your organisation, email and password. New users with an invitation will be set up automatically.
        </p>
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-rose-400/25 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="mb-6 rounded-xl border p-6 text-center space-y-4" style={{ backgroundColor: '#F1EDE3', borderColor: 'rgba(67,62,60,0.09)' }}>
          <div className="relative mx-auto w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-[#1B1916]/10" />
            <div className="absolute inset-0 rounded-full border-2 border-t-[#17150F] animate-spin" style={{ animationDuration: '0.8s' }} />
          </div>
          <p className="text-sm font-medium" style={{ color: '#1B1916' }}>{step}</p>
          <div className="flex justify-center gap-8 pt-1">
            {[
              { icon: LogIn, label: 'Authenticate', active: step === 'Signing in...' || step === 'Signing you in...' },
              { icon: Shield, label: 'Verify', active: step === 'Verifying access...' || step === 'Checking invitation...' || step === 'Setting up your workspace...' || step === 'Creating your account...' },
              { icon: CheckCircle2, label: 'Ready', active: step === 'Welcome back!' || step === 'Welcome!' },
            ].map((s, i) => {
              const isPast = (i === 0 && s.label === 'Authenticate' && step !== 'Signing in...' && step !== '' && step !== 'Signing you in...') ||
                             (i === 1 && (step === 'Welcome back!' || step === 'Welcome!' || step === 'Signing you in...'))
              const isActive = s.active
              const color = isActive || isPast ? '#17150F' : '#52708A'
              return (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <s.icon size={18} style={{ color, transition: 'color 0.3s' }} />
                  <span className="text-[10px] font-medium" style={{ color, transition: 'color 0.3s' }}>{s.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Form — hidden during loading */}
      {!loading && (
        <>
          {showPassword ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="tenant" className="mb-1.5 block text-sm font-medium" style={{ color: '#6B5331' }}>Organisation</label>
              <Input id="tenant" value={tenant} onChange={e => setTenant(e.target.value)} placeholder="your-organisation" required
                readOnly={!!orgParam} className={`h-11 text-base ${orgParam ? 'bg-gray-50' : ''}`} />
              <p className="text-[11px] mt-1" style={{ color: '#7E623A' }}>The organisation name provided by your administrator.</p>
            </div>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium" style={{ color: '#6B5331' }}>Email address</label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required className="h-11 text-base" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="text-sm font-medium" style={{ color: '#6B5331' }}>Password</label>
                <Link href="/forgot-password" className="text-xs" style={{ color: '#17150F' }}>Forgot password?</Link>
              </div>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required className="h-11 text-base" />
            </div>
            <Button type="submit" className="w-full h-11 text-sm font-medium mt-2">
              Sign in <ArrowRight size={15} className="ml-1.5" />
            </Button>
          </form>
          ) : (
            <div>
              <label htmlFor="tenant" className="mb-1.5 block text-sm font-medium" style={{ color: '#6B5331' }}>Organisation <span className="font-normal">(optional)</span></label>
              <Input id="tenant" value={tenant} onChange={e => setTenant(e.target.value)} placeholder="your-organisation"
                readOnly={!!orgParam} className={`h-11 text-base ${orgParam ? 'bg-gray-50' : ''}`} />
            </div>
          )}

          {ssoOptions.length > 0 && (
          <>
          {showPassword && (
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1" style={{ backgroundColor: 'rgba(67,62,60,0.09)' }} />
            <span className="text-xs" style={{ color: '#7E623A' }}>or continue with</span>
            <div className="h-px flex-1" style={{ backgroundColor: 'rgba(67,62,60,0.09)' }} />
          </div>
          )}

          <div className={`${ssoOptions.length > 1 ? "grid grid-cols-2 gap-2" : ""} ${showPassword ? "" : "mt-6"}`}>
            {ssoOptions.map((option) => (
              <Button key={option.id} variant="outline" className="w-full h-11" onClick={() => handleSso(option)}>
                <SsoIcon kind={option.kind} />
                {option.name}
              </Button>
            ))}
          </div>
          </>
          )}

          {showPassword && (
          <p className="mt-8 text-center text-xs" style={{ color: '#7E623A' }}>
            New here? Just enter your details above. If you have an invitation, your account will be created automatically.
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
      <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    )
  }
  if (kind === "microsoft") {
    return (
      <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
        <path d="M2 2h9.5v9.5H2z" fill="#F25022" />
        <path d="M12.5 2H22v9.5h-9.5z" fill="#7FBA00" />
        <path d="M2 12.5h9.5V22H2z" fill="#00A4EF" />
        <path d="M12.5 12.5H22V22h-9.5z" fill="#FFB900" />
      </svg>
    )
  }
  return <KeyRound className="h-4 w-4 mr-2" />
}
