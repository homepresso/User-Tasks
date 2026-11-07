'use client'

import { useCallback, useRef, useState } from 'react'
import { createSubmitGuard, type SubmitGuard } from '@/lib/submit-guard'

/**
 * React wrapper around `createSubmitGuard()`: `run(fn)` ignores calls while one
 * is in flight (checked synchronously, so a double click / double Enter can't
 * fire twice) and `pending` mirrors the in-flight state for the UI.
 *
 * Inside a `<form action={...}>`, React 19 only renders `pending` once the
 * action ends, so pair it with `SubmitButton` (which also reads
 * `useFormStatus().pending`) for the visual disabled state. The guard itself
 * works either way.
 */
export function useSubmitGuard() {
  const [pending, setPending] = useState(false)
  const guardRef = useRef<SubmitGuard | null>(null)
  if (guardRef.current === null) {
    guardRef.current = createSubmitGuard({ onPendingChange: setPending })
  }
  const run = useCallback(<T>(fn: () => T | Promise<T>) => guardRef.current!.run(fn), [])
  const reset = useCallback(() => guardRef.current!.reset(), [])
  return { pending, run, reset }
}
