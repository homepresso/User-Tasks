"use client"

import { useEffect, useState } from "react"

/**
 * Phone breakpoint — anything below Tailwind's `md` (768px) is treated
 * as mobile. Keep in sync with the `md:` classes used by the dashboard
 * shell (sidebar / drawer / bottom tab bar).
 */
const MOBILE_BREAKPOINT = 768

/**
 * SSR-safe mobile detection. Returns `false` on the server and during the
 * first client render (so hydration matches), then reflects the live
 * `(max-width: 767px)` media query and updates on resize/rotation.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
