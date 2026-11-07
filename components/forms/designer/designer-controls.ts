import { controlClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * The designer inspector's text inputs and selects: the shared control look
 * (input background and border, border-strong on hover, the global focus
 * ring, a danger border when aria-invalid) at 32px with 12px text.
 */
export const designerInputBase = cn(controlClass, 'h-8 w-auto px-2 text-xs')

/** Full-width designer input. */
export const designerInputClass = cn(controlClass, 'h-8 px-2 text-xs')
