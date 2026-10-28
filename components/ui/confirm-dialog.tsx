'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<void>
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 shadow-xl dialog-content"
          style={{ backgroundColor: 'var(--theme-card-bg)' }}
        >
          <Dialog.Title className="text-lg font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--theme-card-text)' }}>
            <AlertTriangle size={16} style={{ color: destructive ? 'var(--theme-danger, #DC2626)' : 'var(--theme-warning, #F59E0B)' }} />
            {title}
          </Dialog.Title>
          <p className="text-sm mb-4" style={{ color: 'var(--theme-muted-text)' }}>
            {description}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button
              size="sm"
              onClick={() => void onConfirm()}
              disabled={busy}
              className={destructive ? '!bg-red-600 hover:!bg-red-700 !text-white' : undefined}
            >
              {busy ? 'Working...' : confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
