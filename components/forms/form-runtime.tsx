'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormButton } from '@/lib/forms/buttons'
import type { FormLayout } from '@/lib/forms/layout'
import type { TaskFieldDef } from '@/lib/task-field-schema'

/**
 * What in-form buttons (components/forms/field-button.tsx) reach beyond the
 * renderer: the surface's button bar — registered by FormButtonBar whether
 * it shows or not (application mode), so a Button's Submit / Save draft
 * presses the bar button and the surface's own pipeline runs — and errors
 * a Button's "Validate" shows. Provided by FormPagesProvider (every
 * surface), so the task screen, /f/ pages, start forms, the Run dialog, the
 * test runner and the designer preview behave the same.
 */

export interface RegisteredBar {
  buttons: FormButton[]
  onClick: (button: FormButton) => void
  disabled?: boolean
}

/** What the form's rules register (components/forms/form-rules-runtime.tsx): the bar asks them before submitting. */
export interface RegisteredRules {
  /** Run Before-submit rules; false = a rule blocked the submission (its messages are shown). */
  beforeSubmit: (buttonId: string) => Promise<boolean>
}

/** What the form's lazy parts register (components/forms/lazy-parts.tsx): a submit loads the parts it must check first. */
export interface RegisteredLazy {
  /** Load every shown, unloaded lazy part holding a required field (before a submit or a whole-form Validate). */
  loadForSubmit: () => void
  /** Load every lazy part (print). True when something was loaded (give it a moment to mount). */
  loadAll: () => boolean
}

export interface FormRuntime {
  layout: FormLayout | null | undefined
  fields: TaskFieldDef[]
  idPrefix: string
  /** The surface's bar (null: this surface has none, e.g. a read-only view). */
  bar: React.MutableRefObject<RegisteredBar | null>
  /** FormButtonBar / FormBarRegistration register themselves (null: unmounted). */
  registerBar: (bar: RegisteredBar | null) => void
  /** Errors from an in-form Validate (merged into what the renderer shows). */
  errors: Record<string, string>
  setErrors: (errors: Record<string, string>) => void
  clearError: (key: string) => void
  /** The form's rules (null: none on this surface — read-only views). */
  rules: React.MutableRefObject<RegisteredRules | null>
  /** The form's lazy parts (null: none, or a read-only view). */
  lazy: React.MutableRefObject<RegisteredLazy | null>
}

const RuntimeContext = createContext<FormRuntime | null>(null)

export function useFormRuntime(): FormRuntime | null {
  return useContext(RuntimeContext)
}

/** Register a surface's bar buttons (after every render: the latest handler wins; cleared on unmount). */
export function useRegisterBar(bar: RegisteredBar) {
  const register = useContext(RuntimeContext)?.registerBar
  useLayoutEffect(() => { register?.(bar) })
  useEffect(() => () => register?.(null), [register])
}

export function FormRuntimeProvider({ fields, layout, idPrefix, children }: {
  fields: TaskFieldDef[]
  layout: FormLayout | null | undefined
  idPrefix: string
  children: React.ReactNode
}) {
  const bar = useRef<RegisteredBar | null>(null)
  const [errors, setErrorsState] = useState<Record<string, string>>({})
  const setErrors = useCallback((next: Record<string, string>) => setErrorsState(next), [])
  const clearError = useCallback((key: string) => setErrorsState((prev) => {
    if (!prev[key]) return prev
    const out = { ...prev }
    delete out[key]
    return out
  }), [])
  const registerBar = useCallback((next: RegisteredBar | null) => { bar.current = next }, [])
  const rules = useRef<RegisteredRules | null>(null)
  const lazy = useRef<RegisteredLazy | null>(null)
  const value = useMemo<FormRuntime>(() => ({ layout, fields, idPrefix, bar, registerBar, errors, setErrors, clearError, rules, lazy }), [layout, fields, idPrefix, registerBar, errors, setErrors, clearError])
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}
