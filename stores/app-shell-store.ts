import { create } from 'zustand'
import type { ShellMenuOverride } from '@/lib/apps/shell-collapse'

/**
 * Session-only state of the UserTasks frame around apps (not persisted —
 * the side menu preference itself lives in app-store): the visit's
 * expand / collapse override and each app's "collapse the UserTasks menu"
 * setting as its page view reported it. lib/apps/shell-collapse.ts has the rules.
 */
interface AppShellState {
  override: ShellMenuOverride | null
  setOverride: (override: ShellMenuOverride | null) => void
  /** app slug → collapse the side menu in it (missing = on, the default). */
  autoCollapse: Record<string, boolean>
  setAutoCollapse: (appSlug: string, on: boolean) => void
}

export const useAppShellStore = create<AppShellState>()((set) => ({
  override: null,
  setOverride: (override) => set({ override }),
  autoCollapse: {},
  setAutoCollapse: (appSlug, on) => set((s) => (s.autoCollapse[appSlug] === on ? s : { autoCollapse: { ...s.autoCollapse, [appSlug]: on } })),
}))
