"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { InlineNotice } from "@/components/ui/inline-notice"
import { BusyBar } from "@/components/ui/busy-bar"
import { useSubmitGuard } from "@/hooks/use-submit-guard"
import { completeFirstRunSetup } from "@/app/actions/setup"
import type { SetupField } from "@/lib/setup/run"
import { AuthHeading } from "../auth-heading"

const BOOTSTRAP_COMMAND = "npm run bootstrap -- --email you@example.com --password '…' --org \"Acme Inc\""

/** Mirrors lib/setup/run suggestSlug (client-safe copy, no node imports). */
function slugFor(org: string): string {
  return org.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "")
}

type Values = { org: string; slug: string; fullName: string; email: string; password: string; confirmPassword: string; code: string }

/**
 * "Create your admin account": the first workspace and its owner, guarded by
 * the setup code from the server log. Every check runs server side
 * (app/actions/setup.ts); errors land on the field they belong to.
 */
export function SetupForm() {
  const [values, setValues] = useState<Values>({ org: "", slug: "", fullName: "", email: "", password: "", confirmPassword: "", code: "" })
  const [slugEdited, setSlugEdited] = useState(false)
  const [error, setError] = useState<{ message: string; field?: SetupField; done?: boolean } | null>(null)
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle")
  const guard = useSubmitGuard()
  const formRef = useRef<HTMLFormElement>(null)

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setValues((v) => ({ ...v, [key]: value, ...(key === "org" && !slugEdited ? { slug: slugFor(value) } : {}) }))
    if (error?.field === key) setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await guard.run(async () => {
      setError(null)
      if (values.password !== values.confirmPassword) {
        setError({ field: "confirmPassword", message: "The passwords don't match." })
        return
      }
      setPhase("working")
      try {
        const result = await completeFirstRunSetup(values)
        if (!result.ok) {
          setError({ message: result.error, field: result.field, done: result.done })
          setPhase("idle")
          if (result.field) requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>(`#setup-${result.field}`)?.focus())
          return
        }
        setPhase("done")
        // A full navigation: the action's response carried the session cookies.
        window.location.assign(result.redirect)
      } catch {
        setError({ message: "Something went wrong. Check the server log, then try again." })
        setPhase("idle")
      }
    })
  }

  const fieldError = (field: SetupField) => (error?.field === field ? error.message : undefined)

  if (phase !== "idle") {
    return (
      <div>
        <AuthHeading title="Create your admin account" />
        <div className="space-y-3 rounded-lg border border-border bg-panel p-5" role="status" aria-live="polite">
          <p className="text-sm font-medium text-fg">{phase === "done" ? "All set. Signing you in…" : "Creating your workspace…"}</p>
          <BusyBar />
        </div>
      </div>
    )
  }

  return (
    <div>
      <AuthHeading
        title="Create your admin account"
        description="This is a new UserTasks install. Set up your organisation and the first admin account. You'll be its owner and can invite your team next."
      />

      {error && !error.field && (
        <InlineNotice
          tone="danger"
          className="mb-5"
          message={error.done ? <>{error.message} <Link href="/login" className="font-semibold underline">Go to sign in</Link></> : error.message}
        />
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" noValidate aria-label="Create your admin account">
        <Field label="Organisation name" error={fieldError("org")}>
          <Input id="setup-org" size="lg" value={values.org} onChange={set("org")} placeholder="Acme Inc" required maxLength={120} autoComplete="organization" autoFocus />
        </Field>
        <Field
          label="Sign-in name"
          error={fieldError("slug")}
          description={<>Everyone enters this as the <strong>Organisation</strong> when they sign in. Lowercase letters, numbers and dashes.</>}
        >
          <Input
            id="setup-slug"
            size="lg"
            value={values.slug}
            onChange={(e) => { setSlugEdited(true); setValues((v) => ({ ...v, slug: e.target.value.toLowerCase() })); if (error?.field === "slug") setError(null) }}
            placeholder="acme-inc"
            required
            maxLength={50}
            autoCapitalize="none"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Field label="Your name" error={fieldError("fullName")}>
          <Input id="setup-fullName" size="lg" value={values.fullName} onChange={set("fullName")} placeholder="Ada Lovelace" required maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Email address" error={fieldError("email")}>
          <Input id="setup-email" type="email" size="lg" value={values.email} onChange={set("email")} placeholder="you@company.com" required autoComplete="email" />
        </Field>
        <Field label="Password" error={fieldError("password")} description="At least 8 characters.">
          <Input id="setup-password" type="password" size="lg" value={values.password} onChange={set("password")} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" error={fieldError("confirmPassword")}>
          <Input id="setup-confirmPassword" type="password" size="lg" value={values.confirmPassword} onChange={set("confirmPassword")} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field
          label="Setup code"
          error={fieldError("code")}
          description={<>Printed in the server log as <span className="font-mono">UserTasks setup code: XXXX-XXXX-XXXX</span>. Lost it? Run <span className="font-mono">usertasks-admin setup-code</span>.</>}
        >
          <Input
            id="setup-code"
            size="lg"
            value={values.code}
            onChange={set("code")}
            placeholder="ABCD-EFGH-JKLM"
            required
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono tracking-wider"
          />
        </Field>
        <Button type="submit" size="lg" className="mt-2 w-full" trailingIcon={<ArrowRight />} disabled={guard.pending}>
          Create admin account
        </Button>
      </form>

      <details className="mt-8 border-t border-border-subtle pt-6 text-sm text-fg-muted">
        <summary className="cursor-pointer font-medium text-fg">Prefer the command line?</summary>
        <p className="mt-2 text-xs">From the UserTasks folder on the server:</p>
        <pre className="mt-2 overflow-x-auto rounded-md border border-border-subtle bg-panel p-3 font-mono text-xs text-fg"><code>{BOOTSTRAP_COMMAND}</code></pre>
        <p className="mt-2 text-xs">
          In Docker: <span className="font-mono">docker compose exec app node admin.cjs bootstrap …</span>. See the{" "}
          <Link href="/docs/self-hosting/admin-account" className="font-medium text-primary-text hover:underline">self-hosting guide</Link>.
        </p>
      </details>
    </div>
  )
}
