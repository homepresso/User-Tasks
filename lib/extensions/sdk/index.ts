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

import type { ReactNode } from 'react'
import type { ConnectorDefinition } from '@/lib/connectors/registry'
import type { EndpointDef } from '@/lib/api-schemas/registry'
import type { ActionField } from '@/lib/custom-actions/contract'
import type { ExtensionManifestInput, SettingsScope } from '@/lib/extensions/manifest'
import type { EntitlementDecision } from '@/lib/extensions/entitlement-port'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { FIELD_PATCH_KEYS, FormDataTargetRef } from '@/lib/forms/data-target'
export type { FormDataTargetRef } from '@/lib/forms/data-target'

export { defineEndpoint } from '@/lib/api-schemas/registry'
/**
 * zod, the schema library of endpoint and MCP tool declarations — the copy
 * core validates with (extensions outside the repository cannot resolve
 * core's node_modules, and must not ship a second copy).
 */
import { z } from 'zod'
export { z }
export type { EndpointDef, CliMetadata } from '@/lib/api-schemas/registry'
export type { ActionField } from '@/lib/custom-actions/contract'
export type { ConnectorDefinition, ConnectorField, ReferenceTemplate } from '@/lib/connectors/registry'
export type {
  ExtensionManifest, ExtensionManifestInput, ExtensionGuard, ExtensionTarget, ExtensionIcon, SettingsSchema, SettingField,
  NodeContribution, TriggerContribution, UiContributions, ObjectType, DirectorySourceContribution, ImporterContribution,
} from '@/lib/extensions/manifest'
export type { EntitlementDecision } from '@/lib/extensions/entitlement-port'
export type { ApiReferenceDoc, ApiReferenceGroup, ApiReferenceOperation, ApiReferenceParam, ApiReferenceSchema, ApiReferenceField } from '@/lib/extensions/api-reference'
export { EXTENSION_SDK_VERSION, EXTENSION_MANIFEST_VERSION } from '@/lib/extensions/manifest'
export {
  evaluateFieldFilters, evaluateFieldFilterRule, parseFieldFilters, fieldFilterFields, fieldFilterOperators, fieldFilterNeedsValue,
  comparableParts, describeFieldFilters, FIELD_FILTER_OPERATORS, FIELD_FILTER_OPERATOR_LABELS, FIELD_FILTER_TYPES,
} from '@/lib/extensions/field-filters'
export type { FieldFilterGroup, FieldFilterRule, FieldFilterOperator, FieldFilterType, FieldFilterField, FieldChange } from '@/lib/extensions/field-filters'
export { toOpenApiDocument } from '@/lib/extensions/api-reference'
export { importCoverage, importComplexityLevel, importReadiness, importReportMarkdown } from '@/lib/importers/report'

/**
 * An error with an HTTP status and a machine code, for endpoint, MCP tool,
 * node and UI action handlers: REST answers `status` with
 * `{ error, code, details }`, MCP returns `[code] message`, a workflow step
 * fails with the message. Use 4xx for caller problems (400 invalid_request,
 * 404 not_found, 409 conflict, 412 precondition_failed), 502 for an
 * upstream system's failure.
 */
export class ExtensionError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: Record<string, unknown>
  constructor(code: string, message: string, status = 400, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ExtensionError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function isExtensionError(error: unknown): error is ExtensionError {
  return error instanceof ExtensionError || (error instanceof Error && error.name === 'ExtensionError' && typeof (error as ExtensionError).status === 'number')
}

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
  /**
   * The public base URL of this UserTasks instance (APP_URL / the configured
   * app address, no trailing slash) — for links other systems open (a form
   * page, a callback). null when none is configured.
   */
  appUrl: string | null
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
  workflows: {
    /**
     * Start the workspace's workflows that listen to one of this extension's
     * triggers. With `workflowId`, only that active workflow (if it listens
     * to the trigger) and without `matches()` — a person starting one
     * workflow by hand on a record.
     */
    trigger(key: string, payload: Record<string, unknown>, options?: { dedupeKey?: string; workflowId?: string }): Promise<{ started: number; duplicate: boolean }>
    /**
     * Create a draft workflow (inactive) whose trigger is one of this
     * extension's triggers, pre-configured — e.g. "new workflow for this
     * list". Needs a person holding workflows.create (or workflows.edit);
     * returns the id and the designer path (/automations/<id>). With `nodes`
     * / `edges` (an importer's graph) the steps after the trigger come too:
     * the trigger node's id is `trigger`, so the first edge leaves from it.
     */
    create(input: WorkflowCreateInput): Promise<{ workflowId: string; path: string; warnings?: unknown[] }>
    /**
     * The trigger settings of the workspace's active workflows on one of this
     * extension's triggers (published version) — for pollers that must know
     * what to watch and how often, and to record what each workflow uses.
     */
    triggerConfigs(key: string): Promise<Array<{ workflowId: string; name: string; versionId: string | null; config: Record<string, unknown> }>>
  }
  /**
   * Workspace members by e-mail (case-insensitive; active members only; id,
   * e-mail and display name) — to map an external system's user to a
   * UserTasks user.
   */
  users: { findByEmail(emails: string[]): Promise<Array<{ id: string; email: string; name: string }>> }
  /** Write an audit row (object_audit_log) attributed to the actor. */
  audit(entry: { action: string; summary: string; objectId?: string | null; metadata?: Record<string, unknown> }): Promise<void>
  /**
   * Send an in-app notification (the bell) of one of the manifest's
   * notification types to a member of the workspace; `href` is an app path
   * the notification opens (e.g. /x/<id>/…).
   */
  notify(input: { userId: string; type: string; title: string; body?: string | null; href?: string | null; taskId?: string | null }): Promise<void>
  /**
   * Does the caller hold this permission (a core key or `ext.<id>.<key>`,
   * implied permissions included)? Always true for system callers (jobs,
   * workflow steps, public routes without a user). Check it in UI actions,
   * which run from any page of the extension the person may open.
   */
  can(permission: string): boolean
  /**
   * Licensing (entitlement port):
   *   check(feature)        the decision (never throws);
   *   assert(feature)       throws the framework's licence error unless allowed —
   *                         402 extension_not_licensed / extension_licence_expired
   *                         (the expired one is retryable: a workflow step pauses);
   *   limit(key, options)   usage vs. a licence limit (`<id>.<name>`, e.g.
   *                         `sharepoint.farms`) counted with the extension's
   *                         registered usage counter (ServerExtension.usageCounters);
   *   assertLimit(key, …)   throws 402 extension_limit_reached when adding would
   *                         exceed the limit (and the licence error when not licensed).
   * Limits are checked when something is added, never retroactively.
   */
  licence: {
    check(feature?: string): Promise<EntitlementDecision>
    assert(feature?: string): Promise<void>
    limit(key: string, options?: LimitOptions): Promise<LimitVerdict>
    assertLimit(key: string, options?: LimitOptions): Promise<LimitVerdict>
  }
  /**
   * The workspace's connections (integrations) of THIS extension's connectors
   * (`ext.<id>.<key>`): metadata without credentials, and fetch through the
   * connection's own transport (e.g. the core `windows` NTLM / Kerberos
   * transport with its CA bundle and proxy) and auth headers. Requests are
   * bound to the connection's origin (a URL on another origin is refused),
   * egress-guarded on every hop, with core's timeouts, retries and redirect
   * rules. Connections of other connectors are invisible.
   */
  connections: {
    list(options?: { connector?: string }): Promise<ExtensionConnection[]>
    get(id: string): Promise<ExtensionConnection | null>
    /** `url` is absolute (same origin as the connection's base URL) or relative to the base URL. */
    fetch(id: string, url: string, init?: RequestInit, options?: ConnectionFetchOptions): Promise<Response>
  }
  /**
   * Reusable forms bound to this extension's form targets
   * (ServerExtension.formTargets). `create` makes a form in the workspace as
   * the caller (forms.edit and the target's bindPermission; validated like
   * any form) and returns the designer URL to open; `list` / `get` see only
   * forms bound to this extension.
   */
  forms: {
    create(input: FormCreateInput): Promise<{ id: string; name: string; version: number; designerUrl: string; pageUrl: string }>
    list(options?: { key?: string }): Promise<BoundForm[]>
    get(id: string): Promise<(BoundForm & { fields: TaskFieldDef[]; layout: unknown }) | null>
  }
  /**
   * Directory sources (manifest contributes.directorySources): queue a sync
   * of one of this extension's sources, read its state, and map between
   * workspace accounts and the source's people and groups (e.g. a person
   * field value → the person's external login name). Lookups see only this
   * workspace and only this extension's sources.
   */
  directory: ExtensionDirectory
  /**
   * Core importers an extension can drive with its own files (e.g. form
   * templates it pulled from another system). `infopath` runs the core
   * InfoPath importer as the caller (dry run: forms.view; import: forms.edit)
   * — the same analysis, report and forms as an upload — optionally binding
   * every form it makes to one of this extension's form targets. `hints`
   * reach the extensions' InfoPath enrich hooks (ServerExtension.infopath).
   */
  importers: {
    infopath(input: InfoPathRunInput): Promise<Record<string, unknown>>
  }
  /**
   * Unpack a zip or a CAB archive (MSZIP / uncompressed; e.g. a SharePoint
   * .wsp solution), bounded (files, per-file and total unpacked size).
   * Throws ExtensionError 400 for anything else.
   */
  archives: {
    unpack(bytes: Uint8Array, options?: { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number }): Promise<{ format: 'zip' | 'cab'; entries: Array<{ name: string; bytes: Uint8Array }> }>
  }
  logger: ExtensionLogger
  /**
   * Instance-level contexts only (public routes with `auth: none`, instance
   * jobs): a system context for one workspace, once the route has proven
   * which workspace a call belongs to (e.g. a secret in its URL). Refused
   * (403 / 402) unless the extension is usable in that workspace.
   */
  forWorkspace(tenantId: string): Promise<ExtensionContext>
}

export interface FormCreateInput {
  name: string
  description?: string | null
  /** Core field definitions (lib/task-field-schema.ts). */
  fields: TaskFieldDef[]
  /** Grid, parameters, rules … (lib/forms/layout.ts); `data_target` is set from `target`. */
  layout?: Record<string, unknown> | null
  /** The binding: one of this extension's form target keys and its settings. */
  target: { key: string; config: FormDataTargetRef['config']; label?: string }
  /** Override the default buttons (lib/forms/buttons.ts). */
  buttons?: unknown[] | null
}

/** A form bound to one of the extension's targets. */
export interface BoundForm {
  id: string
  name: string
  version: number
  key: string
  config: FormDataTargetRef['config']
  label: string | null
  updatedAt: string | null
  designerUrl: string
  pageUrl: string
}

/* ── directory sources ─────────────────────────────────────────────── */

export interface ExtensionDirectory {
  /**
   * Queue a sync run of a source (`key` of contributes.directorySources);
   * core runs it in the background through the extension's handler.
   * `ifDue`: only when the last run is older than the source's interval
   * (`intervalMinutes`, default the manifest's) and the handler's enabled()
   * says there is something to sync — for a scheduled job. One run per
   * workspace and source at a time.
   */
  requestSync(source: string, options?: { full?: boolean; ifDue?: boolean; intervalMinutes?: number }): Promise<{ queued: boolean; runId: string | null; reason?: string }>
  status(source: string): Promise<DirectorySourceStatus>
  /** Workspace members and the source's entries by account id, e-mail / UPN, the source's external id or a claim. */
  lookupUsers(input: { userIds?: string[]; emails?: string[]; externalIds?: string[]; claims?: string[] }, options?: { source?: string }): Promise<DirectoryUserRef[]>
  /** The source's groups by team id or external id. */
  lookupGroups(input: { teamIds?: string[]; externalIds?: string[] }, options?: { source?: string }): Promise<DirectoryGroupRef[]>
}

export interface DirectorySourceStatus {
  /** `ext.<id>.<key>` */
  source: string
  lastSyncAt: string | null
  lastFullSyncAt: string | null
  lastError: string | null
  stats: Record<string, number> | null
  /** The run queued or in progress, if any. */
  activeRunId: string | null
  /** People with an account (linked) / waiting for their first sign-in (pending); groups (teams). */
  counts: { linked: number; pending: number; groups: number }
}

export interface DirectoryUserRef {
  /** The workspace account (null: a pending entry without one). */
  userId: string | null
  displayName: string | null
  email: string | null
  /** The source's external id and claims (null / [] for a member the source does not list). */
  externalId: string | null
  claims: string[]
  matchKeys: string[]
  pending: boolean
}

export interface DirectoryGroupRef {
  teamId: string
  externalId: string
  name: string
  label: string | null
}

/** One person a directory source lists. */
export interface DirectorySourceUser {
  /** Stable id of the person in the source (merge a person's several logins into one entry). */
  externalId: string
  displayName: string
  /** The address the person is matched on (the instance's matching key: e-mail or UPN, as SSO and LDAP use). */
  email: string | null
  /** Other addresses / UPNs of the same person (matched too). */
  aliases?: string[]
  /** External login names (e.g. SharePoint claims), for mapping back. */
  claims?: string[]
  /** Default true. */
  active?: boolean
  /** Free-form attributes kept on the entry (job title, department …). */
  attributes?: Record<string, string | null>
}

/**
 * A group of another directory nested in a source group (e.g. an AD security
 * group inside a SharePoint group). When that directory is connected in core
 * (LDAP / Active Directory sync keeps a team for the group), core uses its
 * synced members; otherwise `members` (the source's own expansion).
 */
export interface DirectorySourceNestedGroup {
  directory: 'ldap' | 'entra' | 'okta' | 'google' | 'scim'
  /** The group's name as that directory names it (matched case-insensitively, a `DOMAIN\` prefix ignored). */
  name?: string | null
  /** The group's external id in that directory, when known. */
  externalId?: string | null
  /** Fallback members (externalIds of this source's users). */
  members?: string[]
}

export interface DirectorySourceGroup {
  externalId: string
  displayName: string
  description?: string | null
  /** Where the group comes from, shown with its team, e.g. "SharePoint · Sales". */
  label?: string | null
  /** externalIds of this source's users (direct members). */
  members: string[]
  nested?: DirectorySourceNestedGroup[]
}

export interface DirectorySourceSnapshot {
  users: DirectorySourceUser[]
  groups: DirectorySourceGroup[]
  /**
   * true (default): everything the source has — people and groups it no
   * longer lists lose what the source gave them. false: a partial update
   * (nothing is removed).
   */
  complete?: boolean
  /** Saved and handed back on the next run (e.g. a change token). */
  cursor?: string | null
  /** Run-log lines (counts and skips; never personal data beyond names). */
  warnings?: string[]
}

export interface DirectorySourceHandler {
  /** Whether the workspace has anything to sync (e.g. a connected site); scheduled syncs skip it otherwise. Default true. */
  enabled?(input: { ctx: ExtensionContext }): Promise<boolean>
  /**
   * Read the source. `mode` is 'full' at least daily and when an admin asks
   * for it ('delta' otherwise: the handler may reuse cached data when its
   * own change log says nothing changed, but still returns a complete
   * snapshot unless it sets complete: false).
   */
  sync(input: { ctx: ExtensionContext; mode: 'full' | 'delta'; cursor: string | null; lastFullSyncAt: string | null; deadline: number }): Promise<DirectorySourceSnapshot>
}

export interface LimitOptions {
  /** How many are being added (default 1; 0 = just report usage). */
  adding?: number
  /** A licence without this limit key: `allow` (default: unlimited) or `deny`. */
  missing?: 'allow' | 'deny'
  /** Count usage here instead of with the registered counter. */
  usage?: number
  /**
   * The identity of what is being added (e.g. a farm id). The registered
   * counter is asked for the usage with this unit included, so adding a unit
   * that is already counted (the same farm connected again, from another
   * workspace) adds nothing. Overrides `adding`.
   */
  unit?: string
}

export interface LimitVerdict {
  allowed: boolean
  key: string
  /** null = no limit for this key. */
  limit: number | null
  usage: number
  remaining: number | null
  reason?: string
}

/** A connection (integrations row) of one of the extension's connectors, without credentials. */
export interface ExtensionConnection {
  id: string
  name: string
  /** Namespaced connector key, e.g. `ext.acme.server`. */
  connector: string
  baseUrl: string
  authType: string
  /** The connection's transport kind (`windows`, `ext.<id>.<key>`) or null for plain HTTPS. */
  transport: string | null
  active: boolean
  /** Non-secret auth settings (e.g. { mode, username } for windows) — never passwords, tokens or keys. */
  authSummary: Record<string, string>
  lastTest: { status: string | null; message: string | null; at: string | null }
}

export interface ConnectionFetchOptions {
  /** Whole-call budget in ms (default 30 s). */
  timeoutMs?: number
  /** Attempts in total (default 3; 429 / idempotent 5xx are retried). */
  maxAttempts?: number
  /** 'never' for non-replayable or non-idempotent calls. */
  retry?: 'auto' | 'never'
  /**
   * Send WITHOUT the connection's credentials, keeping its TLS trust (CA
   * bundle) and proxy and the caller's own headers — for discovery probes
   * (e.g. an OAuth realm challenge). Supported for plain and `windows`
   * connections; other transports refuse.
   */
  anonymous?: boolean
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
  /** Licence feature the endpoint needs (manifest licence.features); denied calls answer 402. */
  feature?: string
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
  /** Requests per client address and window (default 120 per minute; at most 6000). */
  rateLimit?: { max: number; windowMs: number }
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
  /** Licence feature the tool needs (manifest licence.features); checked with the workspace access gate. */
  feature?: string
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

/* ── form data targets ─────────────────────────────────────────────── */

/** A form field as a form target sees it (the core field definition; see lib/task-field-schema.ts). */
export type FormTargetField = TaskFieldDef

/** The form a target hook runs for. */
export interface FormTargetForm {
  id: string | null
  name: string
  version: number | null
  /** The binding's provider settings (layout.data_target.config). */
  config: FormDataTargetRef['config']
  fields: FormTargetField[]
}

export interface FormTargetPrepareInput {
  ctx: ExtensionContext
  form: FormTargetForm
  /** The form's parameters (URL query parameters declared on the form, re-validated by core), by parameter name. */
  params: Record<string, unknown>
  /** `render`: the form page opens (load the record); `submit`: just before a submission is checked (field patches only). */
  purpose: 'render' | 'submit'
}

export interface FormTargetPrepared {
  /** Initial values by field key. Person fields may hold `{ email, name? }` (or arrays of them): core maps them to workspace members. */
  values?: Record<string, unknown>
  /** Concurrency token of the loaded record (an ETag); sent back to `submit` as `version`. */
  version?: string | null
  /** The record being edited (null / omitted = a new record). */
  record?: { id: string; label?: string | null; url?: string | null } | null
  /** Field properties that live in the external system (FIELD_PATCH_KEYS: options, option_labels, read_only, required, help_text, min, max, placeholder). */
  fields?: Record<string, Partial<Pick<TaskFieldDef, typeof FIELD_PATCH_KEYS[number]>>>
  /** A short text shown above the fields ("Editing item 12 of Requests"). */
  notice?: string | null
}

/** A person chosen in a Person field, as `submit` sees it. */
export interface FormTargetPerson { id: string; name: string | null; email: string | null }

export interface FormTargetSubmitInput {
  ctx: ExtensionContext
  form: FormTargetForm
  /** The checked, stored values (field key → value) — exactly what the submission records. */
  values: Record<string, unknown>
  params: Record<string, unknown>
  /** The `version` `prepare` returned when the page opened (null for a new record or an API submission without one). */
  version: string | null
  /** People of the Person fields by user id. */
  people: Record<string, FormTargetPerson>
  /** The bytes of a file value (attachments / image fields of THIS submission only); null when it is not one of them. */
  readFile(file: unknown): Promise<{ name: string; contentType: string; bytes: Uint8Array } | null>
}

export interface FormTargetResult {
  record: { id: string; label?: string | null; url?: string | null }
  version?: string | null
  /** Shown to the submitter beside the button's own messages. */
  message?: string | null
}

export interface FormTargetProblem {
  /** The form field it is about (absent: the whole form). */
  field?: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

/**
 * A form data target (lib/forms/data-target.ts): forms bound to records this
 * extension provides. Errors: throw ExtensionError — `details.fields`
 * (field key → message) is shown per field; 409 / 412 is a conflict (the
 * record changed since the page opened); other 4xx are shown as they are;
 * 5xx / 502 as "the external system failed". Nothing is stored when
 * `submit` throws.
 */
export interface FormTarget {
  /** What it is ("CRM account"). */
  label: string
  /** Licence feature checked (with the workspace access gate) before every hook. */
  feature?: string
  /** Permission (core or `ext.<id>.<key>`) a form editor needs to add or change a binding to this target. */
  bindPermission?: string
  prepare?(input: FormTargetPrepareInput): Promise<FormTargetPrepared | null>
  submit(input: FormTargetSubmitInput): Promise<FormTargetResult>
  /** Designer warnings (e.g. fields removed externally). */
  check?(input: { ctx: ExtensionContext; form: FormTargetForm }): Promise<FormTargetProblem[]>
  /** The form was created or saved (record which external fields it uses). Errors are logged, never block the save. */
  saved?(input: { ctx: ExtensionContext; form: FormTargetForm & { id: string } }): Promise<void>
  /** The form was deleted or unbound. */
  deleted?(input: { ctx: ExtensionContext; formId: string; config: FormDataTargetRef['config'] }): Promise<void>
}

/* ── workflows created by extensions ─────────────────────────────── */

/** A workflow step (node) of a graph an extension creates (the workflow JSON model, lib/workflow-schema.ts). */
export interface WorkflowGraphNode {
  id: string
  /** A core node type (user_task, condition, send_email, placeholder …) or `ext.<id>.<key>`. */
  type: string
  label: string
  position?: { x: number; y: number }
  config: Record<string, unknown>
  /** The section_group node the step sits in. */
  parentId?: string
}

/** An edge; branches carry the branch label (condition branch, "Else", parallel branch, "Done", a task outcome). */
export interface WorkflowGraphEdge { id?: string; source: string; target: string; label?: string }

export interface WorkflowCreateInput {
  name: string
  description?: string | null
  trigger: { key: string; config?: Record<string, unknown>; label?: string }
  /** Steps after the trigger (node id `trigger` is reserved for it). */
  nodes?: WorkflowGraphNode[]
  edges?: WorkflowGraphEdge[]
  /** Workflow variables ({ name, type, default_value?, description? }). */
  variables?: Array<{ name: string; type?: string; default_value?: unknown; description?: string }>
  tags?: string[]
}

/* ── importers ─────────────────────────────────────────────────────── */

/** One file handed to an importer (never stored by core). */
export interface ImportFile {
  name: string
  bytes: Uint8Array
  contentType?: string | null
}

/**
 * How one element of the source converted: mapped (a faithful equivalent),
 * partial (converted, needs review), placeholder (a labelled placeholder
 * step keeps the original), skipped (left out, with the reason), info.
 */
export type ImportItemStatus = 'mapped' | 'partial' | 'placeholder' | 'skipped' | 'info'

export interface ImportReportItem {
  /** What it is in the source ("activity", "condition", "variable", "rule", "field" …). */
  kind: string
  /** The source's name for it (e.g. "Set Field in Current Item"). */
  name: string
  status: ImportItemStatus
  /** What it became (e.g. "SharePoint items · items.update"). */
  mappedTo?: string | null
  detail?: string | null
  /** Where it is in the source (a step name, an XPath …). */
  location?: string | null
}

export interface ImportCoverage {
  /** Items that count (info items do not). */
  total: number
  mapped: number
  partial: number
  placeholder: number
  skipped: number
  /** mapped + half of partial, over total (0–100; 100 when there is nothing to map). */
  percent: number
}

/** The analysis an importer returns (dry run) and with every import. */
export interface ImportReport {
  /** The imported thing's name ("Claim approval"). */
  title: string
  /** What kind of source it is ("SharePoint Designer 2010 workflow"). */
  source: string
  summary?: string | null
  coverage: ImportCoverage
  /** 0–100 (higher = harder to migrate), its level and what drives it. */
  complexity: { score: number; level: 'low' | 'medium' | 'high'; factors: string[] }
  /** auto (import and publish after a look), review (import, then review the flagged steps), rebuild (start again). */
  readiness: 'auto' | 'review' | 'rebuild'
  items: ImportReportItem[]
  warnings: string[]
  /** The importer is a preview: its mapping is not verified on real exports. */
  preview?: boolean
  /** What an import would make. */
  outputs: Array<{ kind: 'workflow' | 'form' | 'other'; name: string; detail?: string | null }>
  /** Importer-specific facts (shown as JSON; kept small). */
  details?: Record<string, unknown>
}

export interface ImportCreated { kind: 'workflow' | 'form' | 'other'; id: string; name: string; href?: string | null }

export interface ImportResult {
  report: ImportReport
  created: ImportCreated[]
  warnings?: string[]
}

export interface ImporterRunInput {
  ctx: ExtensionContext
  files: ImportFile[]
  /** The manifest's `options` values (unchecked beyond their types: validate what you use). */
  options: Record<string, unknown>
}

/**
 * An importer's behaviour (manifest contributes.importers). Core checks the
 * licence feature, the permission and file limits before every call, audits
 * imports, and never stores the files. Throw ExtensionError for a file that
 * cannot be read (400) — the message is shown as it is.
 */
export interface ImporterHandler {
  /** How sure the importer is that it reads these files (0–1); the Import dialog picks the best match. */
  detect?(input: { files: ImportFile[] }): number
  /** Dry run: the report and what would be made. Nothing is created. */
  analyze(input: ImporterRunInput): Promise<ImportReport>
  /** Create the workflows / forms (as drafts) through ctx.workflows.create / ctx.forms.create; undo what you made when a later step fails. */
  import(input: ImporterRunInput): Promise<ImportResult>
}

/** ctx.importers.infopath input. */
export interface InfoPathRunInput {
  bytes: Uint8Array
  fileName: string
  /** Analyse only (default false: import). */
  dryRun?: boolean
  /** The core importer's options: mode (per_view | combined), pages, views, name, tag, existing (new | update), available_in_menu. */
  options?: Record<string, unknown>
  /** Bind each form made to one of this extension's form targets. */
  target?: { key: string; config: FormDataTargetRef['config']; label?: string }
  /** Passed to every enrich hook (e.g. { sharepoint_list_id }). */
  hints?: Record<string, unknown>
}

/** What an InfoPath enrich hook sees: the generated forms, before anything is stored. */
export interface InfoPathEnrichInput {
  ctx: ExtensionContext
  fileName: string
  hash: string
  /** The InfoPath form's name and data connections (name, kind, list / service details). */
  form: { name: string; connections: Array<Record<string, unknown>> }
  forms: Array<{ name: string; view: string | null; fields: TaskFieldDef[]; layout: Record<string, unknown> }>
  hints: Record<string, unknown>
  /** The extension that started this import through ctx.importers.infopath (null: an upload). */
  requestedBy: string | null
  /** The binding requested with ctx.importers.infopath (its config may be completed by the hook). */
  target: { extension: string; key: string; config: FormDataTargetRef['config'] } | null
}

export interface InfoPathEnrichResult {
  /** Per generated form (same order): replaced fields and / or layout keys merged over the layout (`data_target.config` keys merged for the requesting extension's own binding). */
  forms?: Array<{ fields?: TaskFieldDef[]; layout?: Record<string, unknown> } | null>
  /** Shown in the import report ("3 lookups now read the connected list"). */
  notes?: string[]
}

export interface ServerExtension {
  /** Must equal manifest.id. */
  id: string
  /** Form data targets by key: forms bound to records this extension provides (layout.data_target = { extension, key, config }). */
  formTargets?: Record<string, FormTarget>
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
  /** Directory sources by key (manifest contributes.directorySources). */
  directorySources?: Record<string, DirectorySourceHandler>
  /** Importers by key (manifest contributes.importers). */
  importers?: Record<string, ImporterHandler>
  /**
   * Hooks into the core InfoPath importer (uploads and ctx.importers.infopath):
   * `enrich` adjusts the generated forms before they are stored (bind lists,
   * live lookups …). Runs only where the extension is usable (and `feature`
   * licensed); a failing hook is logged and skipped.
   */
  infopath?: { feature?: string; enrich(input: InfoPathEnrichInput): Promise<InfoPathEnrichResult | void> }
  /**
   * Usage counters for the extension's licence limits, by limit key
   * (`<id>.<name>`, e.g. `sharepoint.farms`). Core registers them so
   * Settings → Licence and `usertasks-admin licence status` show usage, and
   * ctx.licence.limit / assertLimit count with them. `ctx.tenantId` is null
   * for the instance-wide count (licences are per instance); `ctx.db` is the
   * service-role client, so filter by tenant yourself when one is given.
   * With `unit`, return the usage as if that unit were added (distinct
   * units including it).
   */
  usageCounters?: Record<string, (input: { ctx: ExtensionContext; unit?: string }) => Promise<number>>
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
