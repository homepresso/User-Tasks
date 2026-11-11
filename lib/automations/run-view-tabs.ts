/** The run page's tabs (components/automations/process-viewer.tsx); ?tab= picks one. Kept apart so the page doesn't pull in the viewer's chunk. */
export type RunViewTab = 'canvas' | 'timeline' | 'compare' | 'logs' | 'variables'
export const RUN_VIEW_TABS: readonly RunViewTab[] = ['canvas', 'timeline', 'compare', 'logs', 'variables']
