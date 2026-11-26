/**
 * Tab wrapping for hand-rolled modal surfaces (the app panel stack) that are
 * not Radix dialogs: Tab from the last focusable goes to the first, Shift+Tab
 * from the first (or from the container itself) goes to the last, so focus
 * never walks out into the page behind the backdrop.
 */

export const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', 'audio[controls]', 'video[controls]',
  '[contenteditable]:not([contenteditable="false"])', '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Where Tab should go instead of the browser default, or null to let the
 * browser move focus (it stays inside the container).
 */
export function wrapTarget<T>(focusables: readonly T[], active: T | null, shift: boolean, container?: T): T | null {
  if (!focusables.length) return container ?? null
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const idx = active == null ? -1 : focusables.indexOf(active)
  // Shift+Tab from the first control, the container itself or outside: the last control.
  if (shift) return idx <= 0 ? last : null
  // Tab from the last control, the container itself or outside: the first control.
  return idx === -1 || idx === focusables.length - 1 ? first : null
}

function visible(el: HTMLElement): boolean {
  if (el.closest('[inert],[hidden],[aria-hidden="true"]')) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 || r.height > 0
}

/** onKeyDown for the container: keeps Tab / Shift+Tab inside it. */
export function trapTabKey(container: HTMLElement, e: { key: string; shiftKey: boolean; defaultPrevented?: boolean; preventDefault: () => void }) {
  if (e.key !== 'Tab' || e.defaultPrevented) return
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible)
  const active = container.ownerDocument.activeElement as HTMLElement | null
  const target = wrapTarget(focusables, active, e.shiftKey, container)
  if (!target) return
  e.preventDefault()
  target.focus()
}
