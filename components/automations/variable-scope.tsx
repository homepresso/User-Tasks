'use client'

import { createContext, useContext } from 'react'
import type { PickerScope } from '@/lib/variable-picker'

/**
 * The variables the nested VariableInputs offer, for where they are (a
 * rule's When, a Button's steps, a Data table's filter…). The form designer
 * sets one for its whole properties panel and narrower ones per rule /
 * button; an input reads the nearest. No provider: the workflow lists.
 */
const VariableScopeContext = createContext<PickerScope | null>(null)

export const VariableScopeProvider = VariableScopeContext.Provider

export function useVariableScope(): PickerScope | null {
  return useContext(VariableScopeContext)
}
