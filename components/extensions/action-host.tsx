'use client'

/**
 * One place that runs contributed actions for menus that close before an
 * action finishes (row menus, bulk bars): requestExtensionAction() posts a
 * request, the host (mounted once in the dashboard shell, inside the jobs
 * provider) asks for confirmation when the manifest says so, runs it and
 * reports the result as a toast.
 */

import { useEffect } from 'react'
import { useExtensionAction, type ExtensionActionRequest } from './use-extension-action'

const EVENT = 'usertasks:extension-action'

export function requestExtensionAction(request: ExtensionActionRequest): void {
  window.dispatchEvent(new CustomEvent<ExtensionActionRequest>(EVENT, { detail: request }))
}

export function ExtensionActionHost() {
  const { run, confirmDialog } = useExtensionAction()
  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<ExtensionActionRequest>).detail
      // A menu that is closing still holds focus: run after it has gone.
      if (detail) setTimeout(() => run(detail), 0)
    }
    window.addEventListener(EVENT, onRequest)
    return () => window.removeEventListener(EVENT, onRequest)
  }, [run])
  return confirmDialog
}
