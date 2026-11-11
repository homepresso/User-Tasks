/**
 * get_timeline: "what's happened on this request?" answered from the
 * timeline (lib/services/run-timeline.ts) — the same events, wording and
 * visibility as the Timeline in the app (only what the person may see).
 * Offered with a task open, on a run's process view and on /timeline/<run>.
 */
import type { AssistantToolDef } from '../engine'
import type { ServiceContext } from '@/lib/services/context'
import { timelineAsText, type TimelineTarget } from '@/lib/run-timeline'

export const TIMELINE_TOOL_MAX_CHARS = 12_000

export function timelineTool(ctx: ServiceContext, target: TimelineTarget): AssistantToolDef {
  return {
    name: 'get_timeline',
    description: "The story of this request so far, from its timeline: when it started and by whom, who each step went to and when, accepts / holds, reassignments, comments, approvals and declines (with who, on whose behalf and notes), notable automatic steps (emails, records, decisions, waits, errors), how it ended or where it is now. Call it for \"what's happened\", \"who approved this\", \"why is it taking so long\", \"where is it now\" questions and answer from it.",
    parameters: { type: 'object', properties: {}, required: [] },
    mode: 'read',
    label: () => 'Reading the timeline',
    maxResultChars: TIMELINE_TOOL_MAX_CHARS,
    run: async () => {
      try {
        const { getTimeline } = await import('@/lib/services/run-timeline')
        const timeline = await getTimeline(ctx, target)
        return { result: { timeline: timelineAsText(timeline).slice(0, TIMELINE_TOOL_MAX_CHARS - 200), detail: timeline.detail, live: timeline.live } }
      } catch (error) {
        return { result: { error: (error as Error).message || 'The timeline is not available' }, ok: false }
      }
    },
  }
}
