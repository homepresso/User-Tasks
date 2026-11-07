'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { signOutAndRedirect } from '@/lib/auth-client'

/** Sign out (everywhere the shared session reaches) and sign in again, back to this address. */
export function SwitchAccountButton({ loginHref }: { loginHref: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={() => { setBusy(true); void signOutAndRedirect(loginHref) }}>
      Use another account
    </Button>
  )
}
