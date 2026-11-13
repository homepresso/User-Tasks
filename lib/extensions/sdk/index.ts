/**
 * @user-tasks/extension-sdk — the contract between core and compiled-in
 * extensions (tier T3). Extensions import ONLY from this module (aliased as
 * `@user-tasks/extension-sdk` in tsconfig, next.config and vitest), never
 * from core paths, so core can refactor freely and the same extension code
 * can later move to the remote tier.
 *
 * An extension package has up to three entry points, each a default export:
 *
 *   manifest  defineExtension({ manifest, connectors? })   client-safe data
 *   server    defineServerExtension({ ... })               server-only behaviour
 *   pages     definePages({ '<path>': Component })         custom pages /x/<id>/…
 *
 * Everything here is types and identity helpers: importing the SDK never
 * pulls server code into a client bundle.
 */

import type { z } from 'zod'
import type { ReactNode } from 'react'
import type { ConnectorDefinition } from '@/lib/connectors/registry'
import type { EndpointDef } from '@/lib/api-schemas/registry'
import type { ActionField } from '@/lib/custom-actions/contract'
import type { ExtensionManifestInput, SettingsScope } from '@/lib/extensions/manifest'
import type { EntitlementDecision } from '@/lib/extensions/entitlement-port'

export { defineEndpoint } from '@/lib/api-schemas/registry'
export type { EndpointDef, CliMetadata } from '@/lib/api-schemas/registry'
export type { ActionField } from '@/lib/custom-actions/contract'
export type { ConnectorDefinition, ConnectorField, ReferenceTemplate } from '@/lib/connectors/registry'
export type {
  ExtensionManifest, ExtensionManifestInput, ExtensionGuard, ExtensionTarget, ExtensionIcon, SettingsSchema, SettingField,
  NodeContribution, TriggerContribution, UiContributions, ObjectType,
} from '@/lib/extensions/manifest'
export type { EntitlementDecision } from '@/lib/extensions/entitlement-port'
export { EXTENSION_SDK_VERSION, EXTENSION_MANIFEST_VERSION } from '@/lib/extensions/manifest'

/* ── manifest entry point ──────────────────────────────────────────── */

export interface ExtensionDefinition {
  /** The manifest (usually `import manifest from './usertasks-extension.json'`); validated by core at load. */
  manifest: ExtensionManifestInput | Record<string, unknown>
  /**
   * Connector definitions (the same model as the built-in catalog). Their
   * keys are namespaced by core: `key: 'echo'` in extension `acme` is the
   * connector `ext.acme.echo`. Listed in manifest.contributes.connectors.
   */
  connectors?: ConnectorDefinition[]
}

export function defineExtension(definition: ExtensionDefinition): ExtensionDefinition {
  return definition
}

/* ── server entry point ────────────────────────────────────────────── */

export interface ExtensionLogger {
  info(message: string, metadata?: Record<string, unknown>): void
  warn(message: string, metadata?: Record<string, unknown>): void
  error(message: string, metadata?: Record<string, unknown>): void
}

/**
 * Host API handed to every server hook. Tenant-scoped: `db` is the caller's
 * client (RLS on for session callers; service role for API keys, jobs and
 * public routes, where the extension must filter by tenantId itself).
 */
export interface ExtensionContext {
  extensionId: string
  /** null for instance-level hooks (public routes before tenant resolution, instance jobs). */
  tenantId: string | null
  actorId: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js client typing is per-schema
  db: any
  /** Per-workspace configuration (tenant_extensions.config) and secrets. */
  config: {
    get(): Promise<Record<string, unknown>>
    /** A secret / certificate settings field, decrypted (server only). */
    secret(key: string): Promise<string | null>
  }
  /** Outbound HTTP through the egress guard (redirects checked, credentials never cross origins). */
  http: { fetch(url: string, init?: RequestInit, options?: { timeoutMs?: number }): Promise<Response> }
  /** Emit an event to the outbox (event_stream) as `ext.<id>.<name>`. */
  events: { emit(name: string, input: { message: string; severity?: 'debug' | 'info' | 'warn' | 'error'; attributes?: Record<string, unknown> }): Promise<void> }
  /** Start the workspace's workflows that listen to one of this extension's triggers. */
  workflows: { trigger(key: string, payload: Record<string, unknown>, options?: { dedupeKey?: string }): Promise<{ started: number; duplicate: boolean }> }
  /** Write an audit row (object_audit_log) attributed to the actor. */
  audit(entry: { action: string; summary: string; objectId?: string | null; metadata?: Record<string, unknown> }): Promise<void>
  /**
   * Send an in-app notification (the bell) of one of the manifest's
   * notification types to a member of the workspace; `href` is an app path
   * the notification opens (e.g. /x/<id>/…).
   */
  notify(input: { userId: string; type: string; title: string; body?: string | null; href?: string | null; taskId?: string | null }): Promise<void>
  /** Licence check for a feature of this extension (entitlement port). */
  licence: { check(feature?: string): Promise<EntitlementDecision> }
  logger: ExtensionLogger
}

export interface NodeRunInput {
  ctx: ExtensionContext
  /** The node's inputs, resolved ({{data}} filled in) and coerced to the declared types. */
  inputs: Record<string, unknown>
  node: { id: string; label: string; type: string }
  run: { id: string | null; workflowId: string | null; test: boolean; variables: Readonly<Record<string, unknown>> }
}
/** A workflow node's behaviour. Returns the declared outputs (they become `{{<prefix>_<name>}}`). */
export type NodeHandler = (input: NodeRunInput) => Promise<Record<string, unknown>>

export interface TriggerHandler {
  /**
   * Does one workflow's trigger configuration accept this event? Omitted =
   * every active workflow with the trigger starts.
   */
  matches?(config: Record<string, unknown>, payload: Record<string, unknown>): boolean
}

export interface ExtensionEndpoint {
  /** Path relative to /api/v1/ext/<id> (OpenAPI params: `/greetings/{name}`); permission/cli as for core endpoints. */
  endpoint: EndpointDef
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed by the endpoint's zod schemas
  handler(input: { ctx: ExtensionContext; params: any; query: any; body: any; request: Request }): Promise<unknown>
}

export interface PublicRoute {
  /** Path relative to /ext-public/<id> (`/receivers/{name}`); must match manifest.capabilities.inbound_public_routes. */
  path: string
  methods: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>
  /**
   * How the route authenticates (core rate-limits and audits every call):
   *   none      — handler checks its own proof (signed token, HMAC) and resolves the tenant;
   *   api_key   — a normal Bearer API key / OAuth token (ctx.tenantId set);
   *   signature — HMAC-SHA256 of the raw body with the workspace secret setting `secretKey` in header `header`.
   */
  auth: { kind: 'none' } | { kind: 'api_key'; permission?: string } | { kind: 'signature'; header: string; secretKey: string; tenantParam: string }
  handler(input: { ctx: ExtensionContext; request: Request; params: Record<string, string>; body: string }): Promise<Response>
}

export interface ExtensionJob {
  /** Job name (becomes `ext.<id>.<name>` in the tick registry). */
  name: string
  cadence: { every: number } | { daily: string }
  budgetMs?: number
  /** Run once per workspace that has the extension enabled and licensed (default), or once per instance. */
  scope?: 'tenant' | 'instance'
  run(input: { ctx: ExtensionContext; deadline: number }): Promise<unknown>
}

export interface EventSubscription {
  /** Event type glob, e.g. `task.completed`, `workflow.run.*`, `ext.acme.*`. */
  pattern: string
  handler(input: { ctx: ExtensionContext; event: { id: number; type: string; category: string; message: string; occurred_at: string; attributes: Record<string, unknown>; task_id: string | null; run_id: string | null; workflow_id: string | null } }): Promise<void>
}

export interface ExtensionMcpTool {
  /** Tool name without the prefix: `greet` → `ext_<id>_greet`. */
  name: string
  description: string
  schema: Record<string, z.ZodTypeAny>
  /** Permission key (core or `ext.<id>.<key>`); writes should name a write permission. */
  permission: string
  /** true = mutation (audited). */
  mutates?: boolean
  handler(input: { ctx: ExtensionContext; args: Record<string, unknown> }): Promise<unknown>
}

export interface ExtensionMigration {
  /** Timestamp version, e.g. 20270115000000. Forward-only; additive within a major version. */
  version: string
  name: string
  sql: string
}

/**
 * Connector transport hook: supplies the HTTP transport for a connector's
 * calls (NTLM, Kerberos, a vendor JWT …). Core still checks every hop with
 * the egress guard and owns retries, timeouts and redirects; the transport
 * only performs one request. Select it with `auth_config._transport`.
 */
export type TransportFactory = (input: { ctx: ExtensionContext; config: Record<string, unknown> }) => Promise<{ fetch: typeof fetch }>

export interface UiActionInput {
  ctx: ExtensionContext
  /** Object type and items for row / toolbar / bulk actions; empty for menu entries. */
  objectType: string | null
  items: Array<Record<string, unknown>>
  /** Values of the form that ran the action (a custom page's ActionForm). */
  values?: Record<string, unknown>
  /** Settings page actions: the page id and the unsaved form values (secrets omitted). */
  settings?: { page: string; values: Record<string, unknown> }
}
export interface UiActionResult {
  message?: string
  tone?: 'success' | 'info' | 'warning' | 'danger'
  /** Navigate after the action (a path inside the app). */
  redirect?: string
  /** Re-fetch the page's data. */
  refresh?: boolean
}
export interface UiDataInput {
  ctx: ExtensionContext
  objectType: string | null
  item: Record<string, unknown> | null
}

export interface ServerExtension {
  /** Must equal manifest.id. */
  id: string
  /** Node behaviour by node key (manifest.contributes.nodes). */
  nodes?: Record<string, NodeHandler>
  triggers?: Record<string, TriggerHandler>
  endpoints?: ExtensionEndpoint[]
  publicRoutes?: PublicRoute[]
  jobs?: ExtensionJob[]
  events?: EventSubscription[]
  mcpTools?: ExtensionMcpTool[]
  migrations?: ExtensionMigration[]
  transports?: Record<string, TransportFactory>
  ui?: {
    /** Targets `{ action }` of menus, row actions, settings buttons. */
    actions?: Record<string, (input: UiActionInput) => Promise<UiActionResult | void>>
    /** Sources of badges, widgets and detail tabs. */
    data?: Record<string, (input: UiDataInput) => Promise<unknown>>
  }
  settings?: {
    /** Cross-field checks after the schema passes; return messages to refuse the save. */
    validate?(input: { ctx: ExtensionContext; scope: SettingsScope; page: string; values: Record<string, unknown> }): Promise<string[]>
  }
  lifecycle?: {
    onEnable?(ctx: ExtensionContext): Promise<void>
    onDisable?(ctx: ExtensionContext): Promise<void>
  }
}

export function defineServerExtension(definition: ServerExtension): ServerExtension {
  return definition
}

/* ── pages entry point ─────────────────────────────────────────────── */

/**
 * Props of a custom page. Pages are React server components rendered inside
 * the app shell (/x/<id>/…); `ctx` is the host API for the signed-in person
 * in their current workspace. Interactive pieces come from
 * `@user-tasks/extension-sdk/ui` (core components that follow the theme).
 */
export interface ExtensionPageProps {
  ctx: ExtensionContext
  extensionId: string
  /** The path below /x/<id>/ split on "/". */
  path: string[]
  searchParams: Record<string, string | string[] | undefined>
}
export type ExtensionPage = (props: ExtensionPageProps) => ReactNode | Promise<ReactNode>
export type ExtensionPages = Record<string, ExtensionPage>

export function definePages(pages: ExtensionPages): ExtensionPages {
  return pages
}

/** Field model helpers for node and trigger declarations. */
export function field(name: string, type: ActionField['type'], extra: Omit<ActionField, 'name' | 'type'> = {}): ActionField {
  return { name, type, ...extra }
}
