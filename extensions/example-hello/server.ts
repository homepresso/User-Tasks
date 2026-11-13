/**
 * Hello — example extension, server entry. Every server contribution point
 * in one small module: node and trigger behaviour, REST endpoints, public
 * routes, a job, an event subscription, an MCP tool, a migration, a
 * connector transport, UI actions and data sources, settings validation and
 * lifecycle hooks. It only talks to core through the ExtensionContext.
 */
import { z } from 'zod'
import { defineEndpoint, defineServerExtension, type ExtensionContext } from '@user-tasks/extension-sdk'

const TABLE = 'ext_example_hello__greetings'

/** The greeting a node, endpoint or tool builds. */
export function buildGreeting(word: string, name: string, punctuation: string, repeat = 1): string {
  const times = Math.max(1, Math.min(5, Math.trunc(repeat) || 1))
  return Array.from({ length: times }, () => `${word || 'Hello'}, ${name}${punctuation || '!'}`).join(' ')
}

async function greetingWord(ctx: ExtensionContext): Promise<{ word: string; punctuation: string }> {
  const config = await ctx.config.get()
  return { word: String(config.greeting_word ?? 'Hello'), punctuation: String(config.default_punctuation ?? '!') }
}

/** Store a greeting (RLS: ctx.db is the caller's client; service-role callers filter by tenant themselves). */
async function saveGreeting(ctx: ExtensionContext, name: string, text: string, source: string) {
  if (!ctx.tenantId) throw new Error('A workspace is required')
  const { data, error } = await ctx.db.from(TABLE)
    .insert({ tenant_id: ctx.tenantId, name, greeting: text, source, created_by: ctx.actorId })
    .select('id, name, greeting, source, created_at').single()
  if (error) throw new Error(error.message)
  return data as { id: string; name: string; greeting: string; source: string; created_at: string }
}

async function countToday(ctx: ExtensionContext): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { count } = await ctx.db.from(TABLE).select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId).gte('created_at', since.toISOString())
  return count ?? 0
}

const greetingSchema = z.object({ id: z.string(), name: z.string(), greeting: z.string(), source: z.string(), created_at: z.string() })

const listGreetings = defineEndpoint({
  method: 'GET', path: '/greetings', operationId: 'listGreetings', tags: ['Hello (example)'],
  summary: 'List greetings', permission: 'ext.example-hello.view',
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }),
  response: z.object({ greetings: z.array(greetingSchema) }),
  listKey: 'greetings',
  cli: { resource: 'hello', verb: 'list' },
})

const createGreeting = defineEndpoint({
  method: 'POST', path: '/greetings', operationId: 'createGreeting', tags: ['Hello (example)'],
  summary: 'Send a greeting (starts "Greeting Received" workflows; dedupe with dedupe_key)', permission: 'ext.example-hello.manage',
  body: z.object({ name: z.string().min(1).max(100), dedupe_key: z.string().max(200).optional() }),
  response: z.object({ greeting: greetingSchema, workflows_started: z.number(), duplicate: z.boolean() }),
  successStatus: 201,
  cli: { resource: 'hello', verb: 'send', positional: ['name'] },
})

const getGreeting = defineEndpoint({
  method: 'GET', path: '/greetings/{id}', operationId: 'getGreeting', tags: ['Hello (example)'],
  summary: 'Get one greeting', permission: 'ext.example-hello.view',
  params: z.object({ id: z.string().uuid() }),
  response: z.object({ greeting: greetingSchema }),
  cli: { resource: 'hello', verb: 'get', positional: ['id'] },
})

async function send(ctx: ExtensionContext, name: string, source: string, dedupeKey?: string) {
  const { word, punctuation } = await greetingWord(ctx)
  const text = buildGreeting(word, name, punctuation)
  const greeting = await saveGreeting(ctx, name, text, source)
  const started = await ctx.workflows.trigger('greeting_received', { greeting_name: name, greeting_text: text }, { dedupeKey: dedupeKey ?? `greeting:${greeting.id}` })
  await ctx.events.emit('greeting.sent', { message: `Greeting sent to ${name}`, attributes: { name, source } })
  await ctx.audit({ action: 'create', summary: `Sent greeting to ${name}`, objectId: greeting.id, metadata: { source } })
  return { greeting, workflows_started: started.started, duplicate: started.duplicate }
}

export default defineServerExtension({
  id: 'example-hello',

  nodes: {
    async greet({ ctx, inputs }) {
      const { word } = await greetingWord(ctx)
      const greeting = buildGreeting(word, String(inputs.name), String(inputs.punctuation ?? '!'), Number(inputs.repeat ?? 1))
      return { greeting, length: greeting.length }
    },
  },

  triggers: {
    greeting_received: {
      matches: (config, payload) => !config.name_filter || String(config.name_filter).toLowerCase() === String(payload.greeting_name ?? '').toLowerCase(),
    },
  },

  endpoints: [
    {
      endpoint: listGreetings,
      async handler({ ctx, query }) {
        const { data, error } = await ctx.db.from(TABLE).select('id, name, greeting, source, created_at')
          .eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false }).limit(query.limit ?? 50)
        if (error) throw new Error(error.message)
        return { greetings: data ?? [] }
      },
    },
    {
      endpoint: createGreeting,
      handler: ({ ctx, body }) => send(ctx, body.name, 'api', body.dedupe_key),
    },
    {
      endpoint: getGreeting,
      async handler({ ctx, params }) {
        const { data, error } = await ctx.db.from(TABLE).select('id, name, greeting, source, created_at').eq('tenant_id', ctx.tenantId).eq('id', params.id).maybeSingle()
        if (error) throw new Error(error.message)
        if (!data) return new Response(JSON.stringify({ success: false, error: 'Greeting not found', code: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })
        return { greeting: data }
      },
    },
  ],

  publicRoutes: [
    {
      path: '/ping', methods: ['GET'], auth: { kind: 'none' },
      handler: async () => Response.json({ ok: true, extension: 'example-hello' }),
    },
    {
      // Inbound webhook: the body is signed with the workspace's signing_secret (X-Hello-Signature: sha256=<hex>).
      path: '/hooks/greeting', methods: ['POST'], auth: { kind: 'signature', header: 'x-hello-signature', secretKey: 'signing_secret', tenantParam: 'workspace' },
      async handler({ ctx, body }) {
        const parsed = JSON.parse(body || '{}') as { name?: string; id?: string }
        if (!parsed.name) return Response.json({ success: false, error: 'name is required' }, { status: 400 })
        const result = await send(ctx, parsed.name, 'webhook', parsed.id ? `hook:${parsed.id}` : undefined)
        return Response.json({ success: true, data: { workflows_started: result.workflows_started, duplicate: result.duplicate } }, { status: 202 })
      },
    },
  ],

  jobs: [
    {
      name: 'digest', cadence: { every: 60 }, budgetMs: 10_000, scope: 'tenant',
      async run({ ctx }) {
        const decision = await ctx.licence.check('digest')
        if (!decision.allowed) return { skipped: 'digest not licensed' }
        const count = await countToday(ctx)
        if (count) await ctx.events.emit('digest.ready', { message: `${count} greeting(s) today`, attributes: { count } })
        return { count }
      },
    },
  ],

  events: [
    {
      pattern: 'task.completed',
      async handler({ ctx, event }) {
        ctx.logger.info(`task completed: ${event.task_id ?? '?'}`)
      },
    },
  ],

  mcpTools: [
    {
      name: 'greet', permission: 'ext.example-hello.view',
      description: 'Build a greeting for a name with the workspace\'s greeting word (Hello example extension). Nothing is stored.',
      schema: { name: z.string().min(1).max(100).describe('Who to greet') },
      async handler({ ctx, args }) {
        const { word, punctuation } = await greetingWord(ctx)
        return { greeting: buildGreeting(word, String(args.name), punctuation) }
      },
    },
    {
      name: 'send', permission: 'ext.example-hello.manage', mutates: true,
      description: 'Send (store) a greeting and start the workspace\'s "Greeting Received" workflows (Hello example extension).',
      schema: { name: z.string().min(1).max(100).describe('Who to greet'), dedupe_key: z.string().max(200).optional().describe('Repeat-safe key') },
      handler: ({ ctx, args }) => send(ctx, String(args.name), 'mcp', args.dedupe_key ? String(args.dedupe_key) : undefined),
    },
  ],

  migrations: [
    {
      version: '20270112000001',
      name: 'greetings',
      sql: `
CREATE TABLE IF NOT EXISTS public.${TABLE} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  greeting text NOT NULL,
  source text NOT NULL DEFAULT 'ui',
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ${TABLE}_tenant_created ON public.${TABLE} (tenant_id, created_at DESC);
ALTER TABLE public.${TABLE} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ${TABLE}_select ON public.${TABLE};
CREATE POLICY ${TABLE}_select ON public.${TABLE} FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS ${TABLE}_insert ON public.${TABLE};
CREATE POLICY ${TABLE}_insert ON public.${TABLE} FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT public.get_current_tenant_id()));
REVOKE ALL ON public.${TABLE} FROM anon;
GRANT SELECT, INSERT ON public.${TABLE} TO authenticated;
GRANT ALL ON public.${TABLE} TO service_role;
`,
    },
  ],

  transports: {
    // Loopback: answers every request locally (no network). A real extension
    // returns a fetch that speaks NTLM / Kerberos / a vendor JWT here.
    loopback: async () => ({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        let body: unknown = null
        try { body = init?.body ? JSON.parse(String(init.body)) : null } catch { body = String(init?.body ?? '') }
        const message = body && typeof body === 'object' ? (body as Record<string, unknown>).message ?? null : body
        return new Response(JSON.stringify({ message, transport: 'loopback', url, method: init?.method ?? 'GET' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }) as typeof fetch,
    }),
  },

  ui: {
    actions: {
      async say_hello({ ctx }) {
        await send(ctx, 'team', 'palette')
        return { message: 'Said hello to the team', tone: 'success', refresh: true }
      },
      async greet_task({ ctx, items }) {
        for (const item of items) {
          const { greeting } = await send(ctx, String(item.assignee_name ?? item.assignee_id ?? 'assignee'), 'task')
          // A notification type the manifest declares (the bell opens /x/example-hello).
          if (item.assignee_id) await ctx.notify({ userId: String(item.assignee_id), type: 'greeting_sent', title: greeting.greeting, body: `On task "${String(item.title ?? '')}"`, href: '/x/example-hello' }).catch((e) => ctx.logger.warn(String(e)))
        }
        return { message: `Greeted ${items.length} assignee${items.length === 1 ? '' : 's'}`, tone: 'success' }
      },
      async greet_item({ ctx, objectType, items }) {
        for (const item of items) await send(ctx, String(item.name ?? item.title ?? item.id ?? objectType), objectType ?? 'item')
        return { message: `Sent ${items.length} greeting${items.length === 1 ? '' : 's'}`, tone: 'success' }
      },
      async create_greeting({ ctx, values }) {
        const name = String(values?.name ?? '').trim()
        if (!name) return { message: 'Enter a name', tone: 'warning' }
        const { greeting } = await send(ctx, name, 'ui')
        return { message: greeting.greeting, tone: 'success', redirect: '/x/example-hello' }
      },
      async test_connection({ ctx, settings }) {
        const url = String(settings?.values.endpoint_url ?? '')
        const token = await ctx.config.secret('api_token')
        if (!url) return { message: 'No endpoint URL set: nothing to test.', tone: 'info' }
        return { message: `Would call ${url} ${token ? 'with' : 'without'} the saved API token (example only).`, tone: 'success' }
      },
    },
    data: {
      async greeting_count({ ctx }) {
        const count = await countToday(ctx)
        return { count, value: count, label: 'today', tone: count ? 'accent' : 'neutral', href: '/x/example-hello' }
      },
      async recent_greetings({ ctx }) {
        const { data } = await ctx.db.from(TABLE).select('id, name, greeting, created_at').eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false }).limit(5)
        return { items: ((data ?? []) as Array<{ id: string; greeting: string; created_at: string }>).map((g) => ({ title: g.greeting, meta: g.created_at, href: '/x/example-hello' })) }
      },
      async task_tab({ ctx, item }) {
        const { word, punctuation } = await greetingWord(ctx)
        const assignee = String(item?.assignee_name ?? item?.assignee_id ?? 'there')
        return { fields: [
          { label: 'Greeting', value: buildGreeting(word, assignee, punctuation) },
          { label: 'Task', value: String(item?.title ?? item?.id ?? '') },
        ] }
      },
    },
  },

  settings: {
    async validate({ scope, values }) {
      if (scope === 'workspace' && String(values.greeting_word ?? '').toLowerCase() === 'goodbye') return ['The greeting word cannot be "Goodbye"']
      return []
    },
  },

  lifecycle: {
    async onEnable(ctx) { ctx.logger.info('enabled') },
    async onDisable(ctx) { ctx.logger.info('disabled (data kept)') },
  },
})
