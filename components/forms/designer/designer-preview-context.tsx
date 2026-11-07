'use client'

import { createContext, useContext } from 'react'

/** The designer live preview's current values (dry runs of "for each changed row" rules use them). */
const PreviewValuesContext = createContext<Record<string, unknown> | null>(null)

export const DesignerPreviewValuesProvider = PreviewValuesContext.Provider

export function useDesignerPreviewValues(): Record<string, unknown> | null {
  return useContext(PreviewValuesContext)
}
