/**
 * Keyboard activation for elements that are not native buttons (a dnd-kit
 * draggable gets role="button" + tabIndex 0 but no key handling) and for
 * buttons whose mouse action runs on mousedown (so a keyboard "click", which
 * has detail 0, would otherwise do nothing).
 */

interface KeyEventLike {
  key: string
  target: unknown
  currentTarget: unknown
  repeat?: boolean
  isComposing?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

/** True for Enter / Space pressed on the element itself (not on a child control), without modifiers. */
export function isActivation(e: KeyEventLike): boolean {
  if (e.key !== 'Enter' && e.key !== ' ') return false
  if (e.target !== e.currentTarget) return false
  if (e.repeat || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return false
  return true
}

/** onKeyDown that runs `action` on Enter / Space (and swallows the key so the page doesn't scroll). */
export function onActivateKey<E extends KeyEventLike>(action: (e: E) => void) {
  return (e: E) => {
    if (!isActivation(e)) return
    e.preventDefault()
    e.stopPropagation()
    action(e)
  }
}

/** A click that came from the keyboard (Enter / Space on a button): the browser reports detail 0. */
export function isKeyboardClick(e: { detail: number }): boolean {
  return e.detail === 0
}
