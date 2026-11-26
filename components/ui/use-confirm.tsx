'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from './confirm-dialog'

export interface ConfirmOptions {
  title: string
  description: string
  /** The verb on the confirm button ("Delete", "Revoke key"). */
  confirmLabel?: string
  cancelLabel?: string
  /** Danger styling: deleting, revoking, discarding. */
  destructive?: boolean
}

/**
 * The themed, accessible replacement for window.confirm():
 *
 *   const [confirm, confirmDialog] = useConfirm()
 *   if (!(await confirm({ title: 'Delete this key?', description: '…', confirmLabel: 'Delete', destructive: true }))) return
 *   …
 *   return <>{…}{confirmDialog}</>
 *
 * Resolves true on confirm, false on cancel / Esc / outside click. A second
 * call while one is open cancels the first.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const settle = useCallback((ok: boolean) => {
    const r = resolver.current
    resolver.current = null
    setOptions(null)
    r?.(ok)
  }, [])

  const confirm = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false)
    setOptions(next)
    return new Promise<boolean>((resolve) => { resolver.current = resolve })
  }, [])

  const dialog = (
    <ConfirmDialog
      open={!!options}
      onOpenChange={(open) => { if (!open) settle(false) }}
      title={options?.title ?? ''}
      description={options?.description ?? ''}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      destructive={options?.destructive}
      onConfirm={() => settle(true)}
    />
  )
  return [confirm, dialog]
}
