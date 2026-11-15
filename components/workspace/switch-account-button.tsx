'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { signOutAndRedirect } from '@/lib/auth-client'

/** The sign-in page as it shows after signing out (never straight back to the IdP when the workspace is SSO only). */
function signedOutHref(href: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}signed_out=1`
}

/** Sign out (everywhere the shared session reaches) and sign in again, back to this address. */
export function SwitchAccountButton({ loginHref }: { loginHref: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={() => { setBusy(true); void signOutAndRedirect(signedOutHref(loginHref)) }}>
      Use another account
    </Button>
  )
}
