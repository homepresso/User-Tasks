'use client'

import { forwardRef, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/button'

export interface SubmitButtonProps extends ButtonProps {
  /** Extra busy signal (e.g. `useSubmitGuard().pending`) for non-form or onClick submits. */
  pending?: boolean
  /** Label while busy. When omitted, `children` stays as is. */
  pendingLabel?: ReactNode
}

/**
 * Submit button that disables itself while its form's action is running.
 * React 19 renders state set inside a form action only when it ends, so a
 * `disabled={saving}` flag never applies mid-action; `useFormStatus().pending`
 * does. Outside a form (or with `type="button"`) pass `pending` instead.
 * Busy = Button `loading` (spinner, aria-busy, width kept).
 */
export const SubmitButton = forwardRef<HTMLButtonElement, SubmitButtonProps>(
  ({ pending, pendingLabel, children, type = 'submit', loading, ...props }, ref) => {
    const status = useFormStatus()
    const busy = Boolean(pending) || status.pending || Boolean(loading)
    return (
      <Button ref={ref} type={type} loading={busy} {...props}>
        {busy && pendingLabel !== undefined ? pendingLabel : children}
      </Button>
    )
  },
)
SubmitButton.displayName = 'SubmitButton'
