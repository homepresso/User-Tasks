'use client'

/**
 * Extension UI state for the dashboard shell. The server layout computes it
 * for the signed-in person's workspace (lib/extensions/ui-server) and every
 * contributed surface — sidebar, mobile drawer, "+ New", ⌘K, user menu, row
 * actions, detail tabs, home widgets, settings nav, the designer palette —
 * resolves its entries from it with the person's permissions. In the public
 * build the state is empty and every hook returns nothing.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { usePermissions } from '@/lib/permissions-context'
import { EMPTY_EXTENSION_UI, permissionChecker, type ExtensionUiState, type GuardSubject } from '@/lib/extensions/ui'
import { extensionNodeCatalog, type ExtensionCatalogEntry } from '@/lib/extensions/nodes'
import { getExtensionUiStateAction } from '@/app/actions/extensions'

interface ExtensionsContextValue {
  state: ExtensionUiState
  refresh: () => Promise<void>
}

const ExtensionsContext = createContext<ExtensionsContextValue>({ state: EMPTY_EXTENSION_UI, refresh: async () => undefined })

export const EXTENSIONS_CHANGED_EVENT = 'usertasks:extensions-changed'

export function ExtensionsProvider({ initial, children }: { initial: ExtensionUiState; children: React.ReactNode }) {
  const [state, setState] = useState(initial)
  // A new server render (workspace switch, router.refresh) brings new state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt the server's fresher state
    setState(initial)
  }, [initial])
  const refresh = useCallback(async () => {
    const result = await getExtensionUiStateAction().catch(() => null)
    if (result?.ok) setState(result.data)
  }, [])
  useEffect(() => {
    const onChange = () => { void refresh() }
    window.addEventListener(EXTENSIONS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(EXTENSIONS_CHANGED_EVENT, onChange)
  }, [refresh])
  const value = useMemo(() => ({ state, refresh }), [state, refresh])
  return <ExtensionsContext value={value}>{children}</ExtensionsContext>
}

export function useExtensionUiState(): ExtensionsContextValue {
  return useContext(ExtensionsContext)
}

/** State + the signed-in person's guard subject: the input of every lib/extensions/ui resolver. */
export function useExtensionResolveContext(isManager?: boolean): { state: ExtensionUiState; subject: GuardSubject } {
  const { state } = useExtensionUiState()
  const { permissions } = usePermissions()
  return useMemo(() => ({ state, subject: { has: permissionChecker(permissions), isManager } }), [state, permissions, isManager])
}

/** Extension nodes and triggers of the extensions usable in this workspace (designer palette). */
export function useExtensionNodeCatalog(): ExtensionCatalogEntry[] {
  const { state } = useExtensionUiState()
  return useMemo(() => {
    if (!state.extensions.length) return []
    const allowed = new Map(state.extensions.map((e) => [e.id, new Set(e.features)]))
    return extensionNodeCatalog().filter((entry) => {
      const features = allowed.get(entry.extensionId)
      return Boolean(features) && (!entry.feature || features!.has(entry.feature))
    })
  }, [state])
}
