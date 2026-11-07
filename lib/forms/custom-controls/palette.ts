/**
 * The designer palette hands the control being placed (by click or drag)
 * to newField('custom') through this slot, so the grid's existing drop
 * handling (which only carries a field type) places a configured control.
 * Browser-only, single designer at a time.
 */

import type { CustomControlFieldConfig } from './field'

let pending: CustomControlFieldConfig | null = null

export function setPendingCustomControl(config: CustomControlFieldConfig | null): void {
  pending = config
}

/** The control to place (cleared once taken). */
export function takePendingCustomControl(): CustomControlFieldConfig | null {
  const out = pending
  pending = null
  return out
}
