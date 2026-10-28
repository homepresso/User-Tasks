import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type TaskDraftValues = Record<string, unknown>

interface AppState {
  currentTenantId: string | null
  setCurrentTenant: (id: string | null) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  taskFilters: {
    status: string[]
    priority: string[]
    sortBy: string
  }
  setTaskFilters: (filters: Partial<AppState['taskFilters']>) => void
  /** Persisted layout preference per asset page (tasks, templates, agents, workflows, data) */
  layoutPreference: Record<string, string>
  setLayoutPreference: (page: string, layout: string) => void
  openTasks: { id: string; title: string }[]
  addOpenTask: (task: { id: string; title: string }) => void
  removeOpenTask: (id: string) => void
  taskDrafts: Record<string, TaskDraftValues>
  setTaskDraft: (taskId: string, values: TaskDraftValues) => void
  clearTaskDraft: (taskId: string) => void
}

export const useAppStore = create<AppState>()(persist(
  (set) => ({
    currentTenantId: null,
    setCurrentTenant: (id) => set({ currentTenantId: id }),
    sidebarCollapsed: false,
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    taskFilters: {
      status: ['todo', 'in_progress', 'blocked'],
      priority: [],
      sortBy: 'due_date',
    },
    setTaskFilters: (filters) =>
      set((s) => ({ taskFilters: { ...s.taskFilters, ...filters } })),
    layoutPreference: {},
    setLayoutPreference: (page, layout) =>
      set((s) => ({ layoutPreference: { ...s.layoutPreference, [page]: layout } })),
    openTasks: [],
    addOpenTask: (task) =>
      set((s) => {
        const deduped = s.openTasks.filter((t) => t.id !== task.id)
        return { openTasks: [task, ...deduped].slice(0, 6) }
      }),
    removeOpenTask: (id) =>
      set((s) => ({ openTasks: s.openTasks.filter((t) => t.id !== id) })),
    taskDrafts: {},
    setTaskDraft: (taskId, values) =>
      set((s) => {
        // Cap persisted drafts — abandoned ones otherwise pile up in
        // localStorage forever (only submit clears a draft).
        const next = { ...s.taskDrafts, [taskId]: values }
        const keys = Object.keys(next)
        if (keys.length > 20) {
          for (const stale of keys.slice(0, keys.length - 20)) delete next[stale]
        }
        return { taskDrafts: next }
      }),
    clearTaskDraft: (taskId) =>
      set((s) => {
        const nextDrafts = { ...s.taskDrafts }
        delete nextDrafts[taskId]
        return { taskDrafts: nextDrafts }
      }),
  }),
  {
    name: 'usertasks-app-state',
    version: 3,
    // v3: the theme is the workspace's (server-rendered) — the personal
    // themeId and per-browser customThemes are dropped from storage.
    migrate: (persisted: any) => {
      if (persisted && typeof persisted === 'object') {
        delete persisted.themeId
        delete persisted.customThemes
      }
      return persisted
    },
  }
))
