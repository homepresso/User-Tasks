"use client"

import { useEffect } from "react"

/**
 * Public (signed-out) pages use the platform default light look. A client-side
 * navigation from the dashboard keeps the workspace theme on <html> (inline
 * colour variables and `data-theme-mode="dark"`, which turns on every `dark:`
 * class) — on the light auth layout that drew light text on light panels.
 * This clears them; full page loads are handled by the root bootstrap script.
 */
export function PublicThemeReset() {
  useEffect(() => {
    const root = document.documentElement
    for (const name of Array.from(root.style)) if (name.startsWith("--")) root.style.removeProperty(name)
    root.setAttribute("data-theme", "basecamp")
    root.setAttribute("data-theme-mode", "light")
  }, [])
  return null
}
