import { z } from 'zod'

const shortText = (max: number) => z.string().trim().max(max)

/* Open modes (shared by app schema and app rules; split out to avoid an import cycle). */

/**
 * How a target opens: centred modal, slide-in panel (right / left), bottom
 * sheet, full-screen overlay, inline (expands under the button), navigation
 * in this tab, or a new tab. Panels stack (lib/apps/panels.ts).
 */
export const OPEN_MODES = ['modal', 'panel_right', 'panel_left', 'sheet', 'fullscreen', 'inline', 'navigate', 'tab'] as const
export type OpenModeKind = (typeof OPEN_MODES)[number]
export const openModeSchema = z.object({
  mode: z.enum(OPEN_MODES).default('modal'),
  /** Phase 1 width presets (still read); size presets / percentages below win when set. */
  width: z.enum(['sm', 'md', 'lg', 'full']).default('md'),
  motion: z.enum(['auto', 'slide', 'fade', 'scale', 'none']).default('auto'),
  /** S / M / L / XL / Full — or exact percentages of the window (modal: width × height; panels: width; sheets: height). */
  preset: z.enum(['s', 'm', 'l', 'xl', 'full']).nullable().optional(),
  width_pct: z.number().int().min(20).max(100).nullable().optional(),
  height_pct: z.number().int().min(20).max(100).nullable().optional(),
  /** People may resize it (handles, maximise); their size is remembered per target. */
  resizable: z.boolean().default(true),
  /** A custom header title (default: the form's / page's own title). */
  title: shortText(80).nullable().optional(),
}).strict()
export type OpenMode = Omit<z.output<typeof openModeSchema>, 'resizable'> & { resizable?: boolean }
