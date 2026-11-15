'use client'

import { useState, useTransition } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { allowPrivateHost } from '@/app/actions/infrastructure'

/**
 * A test was refused by the egress guard (a private, loopback or link-local
 * address not on the allowlist): one click adds the suggested entry to the
 * private-network allowlist (instance.egress_private_allow), so the admin
 * isn't sent to the command line. Instance admins only (the action
 * re-checks); cloud metadata endpoints never get this button.
 */
export function AllowHostButton({ entry, onAllowed }: { entry: string; onAllowed?: (message: string) => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  if (done) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button
        size="sm"
        variant="secondary"
        leadingIcon={<ShieldCheck />}
        disabled={pending}
        onClick={() => start(async () => {
          setError(null)
          const res = await allowPrivateHost(entry)
          if (!res.ok) { setError(res.error); return }
          setDone(true)
          onAllowed?.(`${entry} added to the private network allowlist. Run the test again.`)
        })}
      >
        Allow {entry}
      </Button>
      <span className="text-fg-muted">Adds it to the private network allowlist (Settings → Infrastructure → Network access).</span>
      {error && <span role="alert" className="text-danger">{error}</span>}
    </div>
  )
}
