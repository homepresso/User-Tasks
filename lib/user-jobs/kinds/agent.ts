import { z } from 'zod'
import { ServiceError } from '@/lib/services/context'
import { AGENT_JOB_KIND } from '@/lib/assistants/background'
import { defineJobKind } from '../define'

/*
 * `agent.turn`: an Agent chat turn running (or moved to the background) in
 * the chat request's own invocation (lib/assistants/background.ts). Rows are
 * created by the chat route only, never enqueued (not a UI kind; enqueueing
 * is refused). The runner reaches one only when that invocation died
 * mid-turn and its lease expired: it fails the job, and the bell tells the
 * person (the conversation keeps the error; nothing is re-run).
 */
export const agentTurnJob = defineJobKind({
  kind: AGENT_JOB_KIND,
  effect: 'result',
  params: z.object({ turn_id: z.string().max(100), conversation_id: z.string().max(100), background: z.boolean().optional() }).loose(),
  title: () => 'Agent',
  authorize(ctx) {
    if (ctx.authKind !== 'job') throw ServiceError.forbidden('Agent jobs start from the Agent panel')
  },
  async run() {
    throw ServiceError.validation('The Agent stopped before it finished (the server ended the request). Open the Agent and ask again.')
  },
  maxAttempts: 1,
})
