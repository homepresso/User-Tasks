import { z } from 'zod'
import { defineEndpoint } from './registry'

/**
 * Event stream: cursor reads (GET /events) and live Server-Sent Events
 * (GET /events/stream). Enumerations mirror lib/services/events.ts and the
 * CHECK constraints on public.event_stream; this module stays zod-only so the
 * OpenAPI generator can load it.
 */

const CATEGORIES = ['workflow', 'integration', 'agent', 'audit', 'security', 'task', 'system'] as const
const SEVERITIES = ['debug', 'info', 'warn', 'error'] as const

/** One normalized event (also published as components.schemas.Event). */
export const eventSchema = z.object({
  id: z.number().int().describe('Global, monotonic event id: the cursor (`after`, SSE `id:`) and a stable dedupe key'),
  occurred_at: z.string().describe('ISO timestamp'),
  type: z.string().describe('Dotted event type, e.g. workflow.run.completed, integration.call, audit.workflow.update, task.completed'),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  message: z.string(),
  source_table: z.string().describe('Table the event was normalized from'),
  source_id: z.string().nullable(),
  trace_id: z.string().nullable(),
  run_id: z.string().nullable(),
  workflow_id: z.string().nullable(),
  task_id: z.string().nullable(),
  actor_id: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()).describe('Allow-listed, source-specific fields (never bodies, headers, prompts or credentials)'),
})

/** Filters shared by the list and stream endpoints. */
const filterQuery = z.object({
  category: z.string().optional().describe(`Categories (comma-separated): ${CATEGORIES.join(', ')}. audit and security also need settings.view`),
  type: z.string().optional().describe('Event types or globs (comma-separated), e.g. workflow.* or *.failed'),
  severity: z.enum(SEVERITIES).optional().describe('Minimum severity'),
  workflow_id: z.string().optional().describe('Only events of this workflow'),
  run_id: z.string().optional().describe('Only events of this workflow run'),
  task_id: z.string().optional().describe('Only events of this task'),
  trace_id: z.string().optional().describe('Only events with this trace id'),
  since: z.string().optional().describe('ISO timestamp or a duration back from now (30s, 15m, 1h, 2d, 1w)'),
})

const cursor = z.string().regex(/^\d{1,19}$/, 'must be an event id')

export const listEventsQuery = filterQuery.extend({
  after: cursor.optional().describe('Cursor: only events after this id (the previous next_cursor)'),
  until: z.string().optional().describe('ISO timestamp or duration: only events at or before'),
  limit: z.coerce.number().int().min(1).max(1000).optional().describe('Page size (1-1000, default 100)'),
})

export const streamEventsQuery = filterQuery.extend({
  after: cursor.optional().describe('Resume after this event id (the Last-Event-ID header wins). Default: from now, or from `since`'),
})

const STREAM_DESCRIPTION = [
  'Server-Sent Events (`text/event-stream`). Each event is `id: <event id>`, `event: <type>`, `data: <Event JSON>`.',
  'New events are polled every second; a `: heartbeat` comment is sent every 15 s.',
  'The server ends the stream shortly before its time limit with `event: reconnect` (data `{ "after": "<cursor>" }`):',
  'reconnect with `Last-Event-ID` (or `after`) set to the last id to continue without gaps. Delivery is at-least-once; dedupe on `id`.',
].join(' ')

const tags = ['Events']

export const listEventsEndpoint = defineEndpoint({
  method: 'GET', path: '/events', operationId: 'listEvents', tags,
  summary: 'List events from the unified event stream (oldest first, cursor paged)',
  description: 'Workflow, integration, agent, task, system, audit and security events, retained for 72 hours by default. Pass next_cursor as `after` to read the next page.',
  permission: 'observability.view',
  query: listEventsQuery,
  response: z.object({
    events: z.array(eventSchema),
    next_cursor: z.string().nullable().describe('Pass as `after` to continue (unchanged when no new events)'),
    has_more: z.boolean(),
  }),
  listKey: 'events',
  cli: { resource: 'events', verb: 'list' },
})

export const streamEventsEndpoint = defineEndpoint({
  method: 'GET', path: '/events/stream', operationId: 'streamEvents', tags,
  summary: 'Stream events live (Server-Sent Events)',
  description: STREAM_DESCRIPTION,
  permission: 'observability.view',
  query: streamEventsQuery,
  stream: true,
})

export const eventEndpoints = [listEventsEndpoint, streamEventsEndpoint]
