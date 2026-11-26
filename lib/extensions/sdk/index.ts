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
import type { TaskFieldDef, TaskFieldType } from '@/lib/task-field-schema'
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
 * Schedule math of the core Schedule trigger (pure): for an extension trigger that also runs on a
 * schedule (e.g. a SharePoint site workflow), with the same settings and semantics — the most
 * recent occurrence at or before now fires once (catch-up limited to that one slot).
 */
export { normalizeScheduleConfig, getDueOccurrence, getNextOccurrence, describeSchedule, type ScheduleConfig, type ScheduleMode } from '@/lib/workflow-schedule'

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
  /**
   * The workspace's own address (https://<subdomain>.<base domain>, scheme
   * and port as APP_URL) when workspace addresses are on and the workspace
   * has one — the address to give browsers for this workspace on a
   * multi-tenant instance (the cloud edition). null otherwise: use appUrl.
   */
  workspaceUrl(): Promise<string | null>
  /**
   * Trusted embedding. `url(path)` turns an embeddable path (/embed/…) into
   * the URL to send a browser to: on the workspace's own address with a
   * short-lived signed token listing the sites the workspace approved
   * (per-workspace lists, lib/embedding-token.ts), or the path unchanged when
   * the instance-wide list applies. `origins()` reads what is approved.
   */
  embedding: {
    url(path: string): Promise<string>
    origins(): Promise<{ supported: boolean; origins: string[]; instanceOrigins: string[]; reason: string | null }>
  }
  /**
   * The workspace's on-premises gateways (lib/gateway): read-only. Use a
   * gateway connection through ctx.connections like any other; these are
   * for status ("gateway offline") and for addresses systems on the
   * customer's network should call back on (`relayUrl(gatewayId, path)` =
   * the gateway's relay listener + `/relay/ext-public/<this extension>/<path>`;
   * the gateway forwards it, signed, to the extension's public route).
   */
  gateways: {
    list(): Promise<ExtensionGateway[]>
    get(id: string): Promise<ExtensionGateway | null>
    relayUrl(gatewayId: string, path: string): Promise<string | null>
  }
  /**
   * A page path (/x/<id>/…, /embed/x/<id>/…) as the URL to send a browser
   * to when another system opens it (an add-in button, a portal tile): the
   * path with this workspace as the sign-in hint (`ut_org`), so a signed-out
   * visitor is signed in straight away with the workspace's SSO (automatic
   * sign-in, no sign-in page) when the workspace allows it. The hint only
   * chooses which identity provider to ask — never who is signed in.
   * Without a workspace: the path unchanged.
   */
  launchUrl(path: string): Promise<string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js client typing is per-schema
  db: any
  /**
   * Instance level (paid instance-wide extensions, e.g. the processing add-on):
   * `isAdmin()` is true for instance contexts (jobs with scope 'instance',
   * processing provider hooks, the processor) and for a signed-in instance
   * administrator (INSTANCE_ADMIN_EMAILS / instance.admin_emails, as Settings →
   * Infrastructure); `db()` is the service-role client for the extension's
   * instance tables and `settings.set` writes an instance setting
   * (`ext.<id>.<key>`) — both refuse (403) anyone else. `settings.get` reads
   * a non-secret instance setting of this extension.
   */
  instance: {
    isAdmin(): Promise<boolean>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js client typing is per-schema
    db(): Promise<any>
    settings: {
      get(key: string): Promise<unknown>
      set(key: string, value: unknown): Promise<void>
    }
  }
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
     * workflow by hand on a record. `byPerson` (with `workflowId`, a signed-in
     * person): the run records them as its starter (Started by, run visibility,
     * {{workflow_started_by}}), signed like every other start. A hand start
     * (`workflowId` + `byPerson`, or `inputs`) also checks the workflow's
     * declared inputs server-side (types, required, choices; declared keys
     * only) and passes them as the run's start variables next to the payload —
     * a declared input wins over a payload field of the same name; invalid or
     * missing ones throw ExtensionError 400 `invalid_inputs` with
     * `details.fields` (key → message).
     */
    trigger(key: string, payload: Record<string, unknown>, options?: { dedupeKey?: string; workflowId?: string; byPerson?: boolean; inputs?: Record<string, unknown> }): Promise<{ started: number; duplicate: boolean }>
    /**
     * The start inputs (input parameters) of one of the extension's workflows —
     * what the Run dialog asks for: key, label, type, required, default,
     * choices and help, from the published version (the draft while never
     * published). `supported: false` marks inputs a hand start from an
     * extension page can't carry (attachments, custom form controls). Empty
     * without workflows.view / start / activate / edit.
     */
    inputs(workflowId: string): Promise<ExtensionWorkflowInput[]>
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
    /**
     * Every workflow (drafts and inactive ones too) whose trigger is one of
     * this extension's triggers (optionally one key): status, runs, last
     * editor and the trigger settings of the draft — e.g. "everything
     * bound to this record". Empty without workflows.view.
     */
    list(options?: { trigger?: string }): Promise<ExtensionWorkflowSummary[]>
    /**
     * Publish the draft and activate (workflows.activate), as the caller. Only this extension's
     * workflows. A trigger overlapping with other workflows (TriggerHandler.conflicts) needs an
     * answer in the draft or `onConflict`, else 409 (code conflict, details.conflicts).
     */
    publish(workflowId: string, options?: { onConflict?: TriggerConflictChoice; notes?: string }): Promise<{ id: string; version: number | null }>
    /** Activate / deactivate (workflows.activate), as the caller. */
    setActive(workflowId: string, active: boolean): Promise<void>
    /** Queue the workflow for deletion (workflows.delete), as the caller. */
    delete(workflowId: string): Promise<void>
    /**
     * Replace the workflow's tags that start with `prefix` (the extension's
     * own, e.g. "sharepoint:"), keep all others: a badge and filter in the
     * Automations list. Tags are lower-case, at most 40 characters.
     */
    setTags(workflowId: string, tags: string[], options: { prefix: string }): Promise<void>
    /**
     * The draft graph of one of this extension's workflows (workflows.view): nodes, edges, variables,
     * the trigger node's id and settings, and whether the draft has unpublished changes — e.g. to
     * copy it (create with nodes / edges) when splitting one workflow into several.
     */
    definition(workflowId: string): Promise<{ id: string; triggerNodeId: string | null; triggerConfig: Record<string, unknown>; nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>>; variables: Array<Record<string, unknown>>; hasUnpublishedChanges: boolean; published: boolean; active: boolean }>
    /** Replace the trigger's settings in the draft (as the person: workflows.edit or a design grant; audited); publish to make a new version. */
    setTriggerConfig(workflowId: string, config: Record<string, unknown>): Promise<{ changed: boolean }>
    /**
     * Give the signed-in person an Edit grant on this workflow (one of this
     * extension's), so the designer lets them save, restore and test it without
     * workflows.edit — publishing still needs workflows.activate. For people the
     * extension authorised elsewhere: call on ctx.elevate(reason) (or as someone
     * with team.change_roles). Audited as a grant.
     */
    grantDesign(workflowId: string): Promise<{ granted: boolean }>
    /**
     * Take back a grant made by grantDesign (the person's own Edit grant) from
     * `userId` (default: the signed-in person), e.g. once they no longer
     * manage the record in the outside system. Grants an admin gave are kept.
     * Elevated or team.change_roles; audited as a revoke.
     */
    revokeDesign(workflowId: string, userId?: string | null): Promise<{ revoked: boolean }>
    /**
     * Recent runs of the extension's trigger workflows whose trigger data
     * matches every `match` key (top-level fields, compared as text) — e.g.
     * the runs for one record. Newest first, at most 50. Empty without
     * workflows.view.
     */
    runs(options: { trigger?: string; match: Record<string, string | number>; limit?: number }): Promise<ExtensionWorkflowRun[]>
    /**
     * Run history across the extension's own trigger workflows (optionally
     * some of them: `workflowIds`, others ignored), newest first and paged
     * (`limit` ≤ 100, `offset` ≤ 10 000), filtered by status group and a
     * trigger-data `match`. Each run: status group, duration, the step it
     * waits on, who started it, the trigger-data keys named in `pick`
     * (top-level scalars only) and, for waiting runs, the open tasks.
     * Visibility follows the run lists: workflows.view, then
     * workflows.view_runs (every run) or workflows.view_queue (runs the
     * person is involved in, workflows they hold a View grant on); task
     * assignees need workflows.view_runs or tasks.view_all. System and
     * elevated contexts see everything. Queued jobs (not started yet) come
     * on the first page.
     */
    history(options?: ExtensionRunHistoryOptions): Promise<ExtensionRunHistory>
    /**
     * Aggregate run statistics of the extension's own trigger workflows
     * (optionally some of them) over the last `days` (1–90, default 30),
     * computed in the database: per workflow and in total — started,
     * completed, failed, cancelled, success rate, average and p95 duration
     * of completed runs, runs per UTC day, and the runs running / waiting /
     * queued now. Counts only, no run data. Needs workflows.view.
     */
    stats(options?: { trigger?: string; workflowIds?: string[]; days?: number }): Promise<ExtensionRunStats>
    /**
     * Cancel a run (running / waiting) or a queued job of one of the
     * extension's workflows, through the queue service: workflows.activate and
     * the run in the person's run scope (elevated contexts: any). Audited.
     */
    /**
     * Where the open (waiting) runs of the extension's workflows are: counts by
     * step and their open tasks by assignee — bounded to the newest 5 000 open
     * runs. Needs workflows.view; assignee names need workflows.view_runs or
     * tasks.view_all (else counts only).
     */
    waiting(options?: { trigger?: string; workflowIds?: string[] }): Promise<ExtensionWaiting>
    cancelRun(ref: { runId?: string; jobId?: string }): Promise<{ cancelled: boolean }>
    /**
     * Start one of the extension's workflows again with the trigger data of a
     * failed or cancelled run (a new run; `_retry_of` names the old one), the
     * person recorded as its starter. Needs workflows.start or
     * workflows.activate (elevated contexts: allowed). Audited on the workflow.
     */
    retryRun(runId: string): Promise<{ started: boolean }>
  }
  /**
   * Explicit grants (who may view, edit, delete, run / submit) on the
   * extension's OWN workflows and bound forms — the same grants as the
   * object Permissions panel, through the same service (team.change_roles,
   * audited on the object as `grant` / `revoke`). Workflows use view / edit /
   * delete / execute (start); forms use view / execute (submit).
   * `principals` lists the workspace's roles (with their permission keys) and
   * teams to pick from; people are found with users.findByEmail.
   */
  grants: {
    list(type: ExtensionGrantObject, objectId: string): Promise<ExtensionGrant[]>
    set(type: ExtensionGrantObject, objectId: string, input: ExtensionGrantInput): Promise<ExtensionGrant>
    remove(type: ExtensionGrantObject, objectId: string, grantId: string): Promise<void>
    principals(): Promise<{ roles: Array<{ id: string; name: string; permissions: string[] }>; teams: Array<{ id: string; name: string }> }>
  }
  /**
   * The same person with full workspace permissions, for an action the
   * extension has authorised itself against an outside system (e.g. the
   * person manages this list in SharePoint). The extension must scope what
   * it does to that authorisation. Every audit entry written through the
   * returned context carries the reason. Needs a person (actorId).
   */
  elevate(reason: string): ExtensionContext
  /**
   * Workspace members by e-mail (case-insensitive; active members only; id,
   * e-mail and display name) — to map an external system's user to a
   * UserTasks user.
   */
  users: {
    findByEmail(emails: string[]): Promise<Array<{ id: string; email: string; name: string }>>
    /** The signed-in person (actorId): their account e-mail (as verified at sign-in) and display name; null for system callers. */
    current(): Promise<{ id: string; email: string; name: string } | null>
  }
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
   *   pausedRuns()          workflow runs of the workspace parked because an
   *                         extension's licence lapsed (paused at a step that
   *                         failed with extension_licence_expired);
   *   resumePausedRuns(…)   resume them (only while this extension is licensed;
   *                         audited; a run blocked by another lapsed extension
   *                         simply parks again).
   * Limits are checked when something is added, never retroactively. The
   * decision also says whether the deciding grant is a trial, its expiry /
   * cutoff / days left, and the farms it is bound to (farmIds; unset = any).
   */
  licence: {
    check(feature?: string): Promise<EntitlementDecision>
    assert(feature?: string): Promise<void>
    limit(key: string, options?: LimitOptions): Promise<LimitVerdict>
    assertLimit(key: string, options?: LimitOptions): Promise<LimitVerdict>
    pausedRuns(): Promise<number>
    resumePausedRuns(options?: { limit?: number; deadline?: number }): Promise<{ resumed: number; failed: number; remaining: number }>
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
   * forms bound to this extension. `delete` removes one of THIS extension's
   * bound forms as the caller (forms.delete; refused like any form delete
   * while a workflow step uses it or it is on legal hold).
   */
  forms: {
    create(input: FormCreateInput): Promise<{ id: string; name: string; version: number; designerUrl: string; pageUrl: string }>
    list(options?: { key?: string }): Promise<BoundForm[]>
    /** `buttons`: the stored button bar (null = the default Submit / Cancel). */
    get(id: string): Promise<(BoundForm & { fields: TaskFieldDef[]; layout: unknown; buttons: unknown[] | null }) | null>
    delete(id: string): Promise<{ deleted: boolean }>
    /**
     * Change one of THIS extension's bound forms as the caller (forms.edit; the
     * normal form service: validation, a new version, audit). `target` replaces
     * the binding's config (same target key; the extension cannot rebind the
     * form to another target or extension). Fields omitted stay as they are.
     */
    update(id: string, input: FormUpdateInput): Promise<{ id: string; name: string; version: number; versionChanged: boolean }>
    /** Replace the form's tags that start with `prefix`, keep all others (see workflows.setTags). */
    setTags(id: string, tags: string[], options: { prefix: string }): Promise<void>
    /** The last person who changed each form (display name), from the audit log. */
    editors(ids: string[]): Promise<Map<string, string | null>>
    /** As workflows.grantDesign, for a form bound to one of this extension's form targets (save / restore drafts; publishing still needs forms.edit). */
    grantDesign(formId: string): Promise<{ granted: boolean }>
    /** As workflows.revokeDesign, for a form bound to one of this extension's form targets. */
    revokeDesign(formId: string, userId?: string | null): Promise<{ revoked: boolean }>
    /**
     * Submission counts of the extension's own bound forms (optionally some
     * of them: `formIds`, or one target `key`) over the last `days` (1–90,
     * default 30), computed in the database: total and per UTC day, and the
     * last submission (any time). Counts only, never values. Needs forms.view.
     */
    submissionStats(options?: { formIds?: string[]; key?: string; days?: number }): Promise<ExtensionSubmissionStats>
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
  /**
   * Event waits for workflow steps: a step pauses its run until an event
   * (from the extension's own trigger pipeline: push receivers, pollers)
   * matches, or a timeout. No polling per run: waits are stored with an
   * indexed match key; `resume` looks up the waiters of that key.
   *
   *   // in a node handler — return what waitFor gives back
   *   return ctx.runs.waitFor({ key: 'item_update', match: { list: id, item: 4 },
   *     conditions: { logic: 'and', rules: [{ field: 'Status', operator: 'equals', value: 'Approved' }] },
   *     timeoutMinutes: 1440, onTimeout: 'branch', description: 'Status = Approved on item 4' })
   *
   *   // in the trigger pipeline, when an item changes
   *   await ctx.runs.resume({ key: 'item_update', match: { list: id, item: 4 }, data: fields })
   *
   * The step resumes with `event` (the data) and `timed_out: false`; on a
   * timeout: onTimeout 'continue' (timed_out: true), 'fail' (the step fails)
   * or 'branch' (the edges labelled "Timed out"; others on a match).
   */
  runs: {
    waitFor(input: ExtensionWaitInput): ExtensionWaitRequest
    resume(input: { key: string; match: Record<string, string | number | boolean>; data?: Record<string, unknown> }): Promise<{ resumed: number; waiting: number }>
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
  target: { key: string; config: FormDataTargetRef['config']; label?: string; writes?: 'rules' }
  /** Override the default buttons (lib/forms/buttons.ts). */
  buttons?: unknown[] | null
}

/** ctx.forms.update input: only what is given changes. */
export interface FormUpdateInput {
  name?: string
  description?: string | null
  fields?: FormCreateInput['fields']
  layout?: FormCreateInput['layout']
  buttons?: FormCreateInput['buttons']
  /** New config of the form's binding (its target key stays); `writes: 'rules'`: only the Save to … action writes (FormDataTargetRef.writes). */
  target?: { config: Record<string, unknown>; label?: string; writes?: 'rules' }
}

/** A form bound to one of the extension's targets. */
/** One workflow on an extension trigger (ctx.workflows.list). */
export interface ExtensionWorkflowSummary {
  id: string
  name: string
  /** The trigger key (without ext.<id>.). */
  trigger: string
  /** The trigger node's settings in the draft. */
  config: Record<string, unknown>
  /** draft = never published; active / disabled = published and on / off. */
  status: 'draft' | 'active' | 'disabled'
  published: boolean
  active: boolean
  hasUnpublishedChanges: boolean
  runCount: number
  lastRunAt: string | null
  tags: string[]
  updatedAt: string | null
  /** Display name of the last person who changed it (audit log), when known. */
  updatedBy: string | null
  /** The designer (/automations/<id>). */
  path: string
}

/** One run started by an extension trigger (ctx.workflows.runs). */
export interface ExtensionWorkflowRun {
  workflowId: string
  workflowName: string | null
  /** null while queued (not started yet). */
  runId: string | null
  /** The run's status (running, completed, failed, paused …), else the queue's (pending, processing …). */
  status: string
  /** The trigger data's `event`, when it has one. */
  event: string | null
  queuedAt: string | null
  startedAt: string | null
  completedAt: string | null
  /** The run page (/automations/runs/<id>), null while queued. */
  path: string | null
}

/** A start input of a workflow (ctx.workflows.inputs). */
export interface ExtensionWorkflowInput {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json' | 'select' | 'email' | 'url' | 'attachments' | 'custom'
  required: boolean
  /** Typed default, or null. */
  default: unknown
  /** Choices of a `select` input. */
  options: Array<{ value: string; label: string }> | null
  help: string | null
  /** False for inputs only UserTasks itself can collect (attachments, custom form controls). */
  supported: boolean
}

/** Objects ctx.grants manages. */
export type ExtensionGrantObject = 'workflow' | 'form'

export interface ExtensionGrant {
  id: string
  who: { kind: 'role' | 'team' | 'person'; id: string; name: string }
  view: boolean
  edit: boolean
  delete: boolean
  /** Workflows: start it; forms: submit it. */
  execute: boolean
  /** The person gave it to themselves through grantDesign (e.g. a list manager opening the designer). */
  selfGranted: boolean
}

/** Exactly one of role / team / person (ids), and the access to give. */
export interface ExtensionGrantInput {
  role?: string
  team?: string
  person?: string
  view?: boolean
  edit?: boolean
  delete?: boolean
  execute?: boolean
}

/** Status groups of runs (ctx.workflows.history / stats). */
export type ExtensionRunGroup = 'running' | 'waiting' | 'completed' | 'failed'

export interface ExtensionRunHistoryOptions {
  trigger?: string
  /** Only these of the extension's workflows (ids of other workflows are ignored). */
  workflowIds?: string[]
  /** running; waiting (paused on a task / approval / event, or queued); completed; failed (failed or cancelled); queued (not started yet) and cancelled on their own. */
  status?: Array<ExtensionRunGroup | 'queued' | 'cancelled'>
  /** Runs started by this person (a user id). */
  startedBy?: string
  /** Started at or after / before (ISO instants). */
  since?: string
  until?: string
  /** started (newest first, default), duration (longest first, over the newest 1 000 matching runs) or status. */
  sort?: 'started' | 'duration' | 'status'
  /** Item title (trigger data `title`), a run id, or the starter's name / e-mail. */
  search?: string
  /** Trigger-data match (top-level keys, compared as text), as in runs(). */
  match?: Record<string, string | number>
  /** Top-level trigger-data keys to return per run (scalars; at most 10). */
  pick?: string[]
  /** Page size, 1–100 (default 25). */
  limit?: number
  offset?: number
  /** Keyset paging (newest-first order): the previous page's `nextCursor`; deep pages without OFFSET. */
  cursor?: string
}

export interface ExtensionRunTask {
  id: string
  title: string
  status: string
  dueAt: string | null
  /** Display name of the assignee; null when unassigned or not visible to the caller (see `ExtensionRunHistory.assignees`). */
  assignee: string | null
  /** A team / group assignment (name), when the task has no single assignee. */
  team: string | null
}

export interface ExtensionRunHistoryItem extends ExtensionWorkflowRun {
  group: ExtensionRunGroup
  /** The queue job (queued items; cancel it with cancelRun({ jobId })). */
  jobId: string | null
  startedById: string | null
  /** The run's title, when the workflow sets one. */
  title: string | null
  /** completed − started (or now − started while it runs); null while queued. */
  durationMs: number | null
  /** The step it is paused on (its label), when it waits. */
  currentStep: string | null
  /** The person who started it (a manual start or a form), else null (an event). */
  startedBy: string | null
  /** The picked trigger-data keys. */
  data: Record<string, string | number | boolean | null>
  /** Open tasks of a waiting run. */
  tasks: ExtensionRunTask[]
  error: string | null
}

export interface ExtensionRunHistory {
  runs: ExtensionRunHistoryItem[]
  /** Runs matching the filters (queued jobs not included), counted up to 10 000 (`totalCapped`: more). */
  total: number
  totalCapped: boolean
  /** Pass as `cursor` for the next page (newest-first order); null on the last page. */
  nextCursor: string | null
  /** Queued jobs that have not started yet (in `runs` on the first page when `waiting` is asked for). */
  queued: number
  hasMore: boolean
  /** Which runs the caller sees: every run, only involved / granted ones, or none (no run-list access). */
  visibility: 'all' | 'involved' | 'none'
  /** Whether task assignees are shown. */
  assignees: boolean
}

/** One UTC day: runs started that day, how they ended, and the average duration of those completed (ms). */
export interface ExtensionRunDay { day: string; started: number; completed: number; failed: number; avgMs: number | null }

/** Where open runs wait: by step (label), and their open tasks by assignee (names only with View all runs / View all tasks). */
export interface ExtensionWaiting {
  total: number
  steps: Array<{ workflowId: string; workflowName: string; step: string; count: number }>
  assignees: Array<{ name: string | null; team: boolean; unassigned: boolean; count: number }>
  assigneesVisible: boolean
}

export interface ExtensionRunCounts {
  started: number
  completed: number
  failed: number
  cancelled: number
  /** completed ÷ (completed + failed + cancelled); null before any run finished. */
  successRate: number | null
  /** Of completed runs (ms). */
  avgMs: number | null
  p95Ms: number | null
  /** Now (whatever the period). */
  running: number
  waiting: number
  queued: number
  /** Every UTC day of the period, oldest first. */
  perDay: ExtensionRunDay[]
}

export interface ExtensionRunStats {
  since: string
  until: string
  days: number
  workflows: Array<ExtensionRunCounts & { workflowId: string; name: string }>
  totals: ExtensionRunCounts
}

export interface ExtensionSubmissionStats {
  since: string
  until: string
  days: number
  forms: Array<{ formId: string; name: string; key: string; total: number; lastAt: string | null; perDay: Array<{ day: string; count: number }> }>
  totals: { total: number; lastAt: string | null; perDay: Array<{ day: string; count: number }> }
}

export interface BoundForm {
  id: string
  name: string
  version: number
  key: string
  config: FormDataTargetRef['config']
  label: string | null
  /** `rules`: only buttons with a Save to … action write the record. */
  writes?: 'rules' | null
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
  /**
   * The group's origin badge when it differs from the source's `kind`
   * (manifest contributes.directorySources[].kind), e.g. an Active Directory
   * group a SharePoint source lists as such: 'active_directory'.
   */
  kind?: 'sharepoint' | 'active_directory' | 'ldap' | 'entra' | 'okta' | 'google' | 'extension' | null
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
  /**
   * Set when the connection goes through one of the workspace's on-premises
   * gateways (`transport: 'gateway'`): its id and the gateway target the
   * connection names (null = found by origin). The target's credentials live
   * on the gateway, not in UserTasks.
   */
  gateway: { id: string; target: string | null } | null
}

/** An on-premises gateway of the workspace (ctx.gateways). */
export interface ExtensionGateway {
  id: string
  name: string
  /** At least one instance is connected. */
  online: boolean
  state: 'online' | 'offline' | 'never_connected' | 'revoked'
  /** Targets it advertises from its own configuration: what connections through it may reach. */
  targets: Array<{ id: string; origin: string }>
  /**
   * Where the gateway takes inbound callbacks on the customer's network
   * (its relay listener), null when the relay is off. Systems that cannot
   * reach UserTasks call this address instead (ctx.gateways.relayUrl).
   */
  relayUrl: string | null
  version: string | null
  lastSeenAt: string | null
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
  /**
   * Other workflows this configuration would overlap with (e.g. another workflow already
   * starting on the same event of the same record set). The designer asks the person about
   * each one when the trigger settings change and stores the answer in the draft
   * (`config[TRIGGER_CONFLICT_CHOICES]`, conflict key → choice); publishing checks again and
   * refuses unanswered conflicts (API: `on_conflict`). Runs as the person.
   */
  conflicts?(input: { ctx: ExtensionContext; workflowId: string | null; config: Record<string, unknown> }): Promise<TriggerConflict[]>
  /**
   * The current values of the record behind a run (manifest `record`), by
   * field key in the shape of the run variable (e.g. `after`): core asks when
   * a task whose form is prefilled from the record opens, so the person sees
   * the record as it is now (fields they already edited keep their value).
   * `ids` holds the run variables named in `record.idFrom`. Return null when
   * the record is gone or can't be read (the stored values stay). Runs as
   * the person opening the task; check they may read the record.
   */
  readRecord?(input: { ctx: ExtensionContext; config: Record<string, unknown>; ids: Record<string, unknown> }): Promise<Record<string, unknown> | null>
  /**
   * Apply the answers when the workflow is published, before its new version goes live:
   * `take_over` (e.g. take the event out of the other workflow — a new version of THAT one) or
   * `keep_both` (record that both run). Runs as the person; throw to stop the publish.
   */
  resolveConflicts?(input: { ctx: ExtensionContext; workflowId: string; config: Record<string, unknown>; choices: Record<string, TriggerConflictChoice> }): Promise<{ notes?: string[] }>
}

/** Where the designer stores the answers to trigger conflicts in the trigger's settings. */
export const TRIGGER_CONFLICT_CHOICES = '_conflict_choices'
export type TriggerConflictChoice = 'keep_both' | 'take_over'

export interface TriggerConflict {
  /** Stable key of this overlap (e.g. "created:<other workflow id>"); answers are stored by it. */
  key: string
  /** One plain sentence: "'Contracts – Item created' already starts when an item is created." */
  message: string
  workflow: { id: string; name: string }
  /** Label of the take-over button ("Remove this event from 'Contracts – Item created'"). */
  takeOverLabel: string
  /** Taking over leaves the other workflow with nothing to start on (it is turned off, never deleted). */
  deactivates?: boolean
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
  /**
   * `via` is set when the call came through a workspace's on-premises
   * gateway relay (the gateway took it on the customer's network and
   * forwarded it, signed): the handler may require that what it resolves
   * (e.g. a receiver registration) belongs to `via.tenantId`.
   */
  handler(input: { ctx: ExtensionContext; request: Request; params: Record<string, string>; body: string; via?: PublicRouteVia }): Promise<Response>
}

/** How a public route call reached UserTasks when not directly (see PublicRoute.handler). */
export interface PublicRouteVia {
  kind: 'gateway'
  gatewayId: string
  tenantId: string
}

export interface ExtensionJob {
  /** Job name (becomes `ext.<id>.<name>` in the tick registry). */
  name: string
  cadence: { every: number } | { daily: string }
  budgetMs?: number
  /** Run once per workspace that has the extension enabled and licensed (default), or once per instance. */
  scope?: 'tenant' | 'instance'
  /**
   * Also run while the extension is NOT licensed (expired / never licensed) in
   * workspaces that have it enabled — for licence-lapse housekeeping only
   * (give back what the extension changed outside UserTasks when its licence
   * ends, and put it back when a licence arrives). Check ctx.licence yourself;
   * never do licensed work from such a job.
   */
  runWhenUnlicensed?: boolean
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
  /** Per-field messages (form field name → message) shown under those fields of an ExtensionActionForm. */
  fieldErrors?: Record<string, string>
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
  /** `rules`: only a button's Save to … step writes (FormDataTargetRef.writes); null: an older binding (every submit writes). */
  writes?: 'rules' | null
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
  /**
   * `display`: a display form — the page shows the record read-only (core
   * marks every field read-only and hides the submit buttons) and core
   * refuses submissions. Return it for `purpose: 'submit'` too.
   */
  mode?: 'display' | null
  /** Buttons on the page (e.g. "Edit" → the record's edit form): app paths (`/f/<id>?…`) or http(s) URLs; `target` self (app paths' default) / top / blank (http(s) default). */
  actions?: Array<{ label: string; url: string; primary?: boolean; target?: 'self' | 'top' | 'blank' }> | null
  /** The record's files in the external system (attachments), shown as links (http(s) only). */
  files?: Array<{ label: string; url: string }> | null
  /** Where the record lives (e.g. its list): {{target.return_url}} redirects go there. Validate it yourself (never an open redirect); http(s) only. */
  returnUrl?: string | null
  /** The person may delete this record (needs a `remove` hook); the form's Delete button shows only then. */
  canDelete?: boolean | null
  /** Named pages for the record, for {{target.url.<name>}} button redirects (e.g. `{ edit: '/f/<id>?ItemId=12' }`): app paths or http(s). */
  urls?: Record<string, string> | null
  /**
   * The record's own values by token name, for {{target.<name>}} in the
   * Save to … step's expressions and the button's other steps (workflow
   * inputs, messages): e.g. `{ id: 12, created_by: 'Jane', version: '3.0' }`.
   * Return them for `purpose: 'submit'` (read on the server when the form is
   * saved; never taken from the browser). Scalars, bounded.
   */
  context?: Record<string, string | number | boolean | null> | null
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
  /**
   * The button's visible "Save to …" action (bindings with `writes: 'rules'`):
   * do exactly this. operation null = the provider's default for the form;
   * conflict "overwrite" = `version` is null (no conflict check); `extra`:
   * source fields set from the action's expressions (source key → value,
   * resolved on the server), written besides the mapped form fields;
   * `options`: the provider's own (e.g. upload: false). Absent: an older
   * binding's implicit write.
   */
  action?: FormTargetSaveAction
}

export interface FormTargetSaveAction {
  operation: 'create' | 'update' | null
  conflict: 'refuse' | 'overwrite'
  extra?: Record<string, unknown>
  options?: Record<string, string | boolean>
}

export interface FormTargetResult {
  record: { id: string; label?: string | null; url?: string | null }
  version?: string | null
  /** Shown to the submitter beside the button's own messages. */
  message?: string | null
  /** Where the record lives ({{target.return_url}}), as for prepare. */
  returnUrl?: string | null
}

export interface FormTargetRemoveInput {
  ctx: ExtensionContext
  form: FormTargetForm
  params: Record<string, unknown>
  /** The version `prepare` returned when the page opened, if any. */
  version: string | null
}

export interface FormTargetProblem {
  /** The form field it is about (absent: the whole form). */
  field?: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

/* ── form data targets: the binding, described and edited in the designer ─ */

/**
 * A field of the system a bound form writes (e.g. a SharePoint column), as
 * the designer offers it: the "Connected to …" panel's mapping table and the
 * Data panel's draggable fields use the same list.
 */
export interface FormTargetSourceField {
  /** Stable key in the source (e.g. the column's internal name); what `bind` takes. */
  key: string
  label: string
  /** The source's own type name, shown to people ("Choice", "Person or group"). */
  typeLabel: string
  /** Form field types that can hold it, the suggested one first; an empty list = cannot be bound. */
  fieldTypes: TaskFieldType[]
  required?: boolean
  readOnly?: boolean
  multi?: boolean
  choices?: string[]
  /** A lookup to another list / table (its name). */
  lookup?: string | null
  help?: string | null
  /** How the Data panel groups it, e.g. 'columns' | 'lookups' | 'system' (provider-defined, plain). */
  group?: string | null
  /**
   * Where a structured value's plain value is (e.g. `value` of a lookup's
   * `{ id, value }`, `url` of a link): a workflow prefill reads
   * `{{<record>.<key>.<valuePath>}}`. People need none (core maps their
   * `email` to a workspace member).
   */
  valuePath?: string | null
  /** A lookup column whose list this extension offers as a lookup source: dropping it makes an Autocomplete bound to that list. */
  lookupSource?: { extension: string; provider: string; source: string; value_field?: string; label_field?: string } | null
  /** Added in the source since the last look (e.g. by the latest schema refresh). */
  isNew?: boolean
}

/** One form field's link to a source field (null = not mapped). `locked`: managed by the provider (e.g. the uploaded file), shown but not editable. */
export interface FormTargetMapping { field: string; source: string | null; locked?: boolean; note?: string | null }

/**
 * What a provider tells the designer about a form's binding, in plain words
 * (no ids or JSON): what it is connected to, how records load, the mapping,
 * editable options, actions and warnings.
 */
export interface FormTargetDescription {
  /** "SharePoint list "Requests"". */
  title: string
  /** Open the source (e.g. the list in SharePoint). */
  link?: { label: string; url: string } | null
  /** Read-only facts: role, which record loads, replacement state … */
  facts?: Array<{ label: string; value: string; help?: string | null }>
  sourceFields: FormTargetSourceField[]
  mappings: FormTargetMapping[]
  notes?: Array<{ severity: 'error' | 'warning' | 'info'; message: string }>
  /** Editable settings of the binding (saved into data_target.config through `bind`). */
  options?: Array<{ key: string; label: string; help?: string | null; type: 'boolean' | 'select'; value: string | boolean; choices?: Array<{ value: string; label: string }> }>
  /** Actions that act at once (not through the form save), e.g. "Use SharePoint's forms again". */
  actions?: Array<{ id: string; label: string; help?: string | null; confirm?: string | null; tone?: 'danger' | 'default' }>
  /** Plain labels of the {{target.*}} redirect targets ("return_url" → "Back to the SharePoint list"). */
  tokens?: Record<string, string>
  /**
   * The provider's own buttons for this form (FormButton shapes, by id): the
   * designer offers "Reset to <defaultsLabel>" on a button with the same id —
   * label, style, look and behaviours as the provider makes them.
   */
  defaultButtons?: Array<Record<string, unknown>>
  /** What the defaults are called ("SharePoint default"). */
  defaultsLabel?: string | null
  /**
   * The "Save to …" action as the designer shows it: its name ("Save to
   * SharePoint list "Requests""), the operations it offers (value '' = the
   * default, described), whether it can overwrite on a conflict, and its
   * own options.
   */
  save?: {
    label: string
    operations: Array<{ value: '' | 'create' | 'update'; label: string; help?: string | null }>
    conflict?: boolean
    options?: Array<{ key: string; label: string; help?: string | null; type: 'boolean'; value: boolean }>
  } | null
}

export interface FormTargetBindInput {
  ctx: ExtensionContext
  form: FormTargetForm
  /** The mapping as the designer wants it (form field key → source field key, or null). */
  mappings?: Array<{ field: string; source: string | null }>
  /** Source fields to add to the form (new fields bound to them). */
  add?: string[]
  /** New option values (FormTargetDescription.options keys). */
  options?: Record<string, string | boolean>
}

export interface FormTargetBindResult {
  /** The binding's new config (saved with the form; its identity must stay the same). */
  config: FormDataTargetRef['config']
  /** New form fields for `add` (keys unique against the form's). */
  fields?: TaskFieldDef[]
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
  /**
   * What makes two bindings the same (e.g. the list a form writes): a save
   * whose binding keeps its identity is an update of that binding — no
   * bindPermission check, and `saved` gets `previousConfig` instead of
   * `deleted` + `saved`. Without it, any change to the config counts as a
   * new binding. Synchronous and cheap (no I/O).
   */
  identity?(config: FormDataTargetRef['config']): string
  /**
   * The form was created or saved (record which external fields it uses).
   * Runs after the response (the save never waits for it); errors are logged,
   * never block the save. `previousConfig`: the binding's config before this
   * save when it kept its identity (null for a new binding).
   */
  saved?(input: { ctx: ExtensionContext; form: FormTargetForm & { id: string }; previousConfig?: FormDataTargetRef['config'] | null }): Promise<void>
  /**
   * A Delete button was pressed: delete the record the params name (check
   * the person may), return the record, an optional message and where to go
   * back to ({{target.return_url}}). Without it forms bound here show no
   * Delete button.
   */
  remove?(input: FormTargetRemoveInput): Promise<{ record?: { id: string; label?: string | null } | null; message?: string | null; returnUrl?: string | null }>
  /**
   * The designer: what the binding is (the "Connected to …" panel and the
   * Data panel). `form` is the designer's current, unsaved state.
   */
  describe?(input: { ctx: ExtensionContext; form: FormTargetForm }): Promise<FormTargetDescription>
  /**
   * The designer changed the mapping / options or adds source fields: return
   * the new config (and new fields). Validate here (e.g. refuse a field type
   * that cannot hold the column, with ExtensionError details.fields). Saved
   * with the form, never on its own.
   */
  bind?(input: FormTargetBindInput): Promise<FormTargetBindResult>
  /** A FormTargetDescription action (acts at once, as the person; e.g. replace / restore a list's forms). */
  runAction?(input: { ctx: ExtensionContext; form: FormTargetForm & { id: string }; action: string }): Promise<{ message?: string | null }>
  /** The form was deleted or unbound (runs after the response; errors are logged). */
  deleted?(input: { ctx: ExtensionContext; formId: string; config: FormDataTargetRef['config'] }): Promise<void>
}

/* ── lookup sources: lists a form's Dropdown / Autocomplete reads ─── */

/** A column of a lookup source list, as the designer offers it. */
export interface LookupSourceColumn {
  key: string
  label: string
  /** string (default), number, date, boolean, choice, user, lookup. */
  type?: string
  choices?: string[]
}

/** A list a lookup can read (e.g. a connected SharePoint list), with its columns. */
export interface LookupSourceList {
  id: string
  label: string
  columns: LookupSourceColumn[]
  /** The column stored as the value by default (e.g. `id`). */
  valueColumn?: string
  /** The column shown by default (e.g. `Title`). */
  labelColumn?: string
}

/** One filter of a lookup query: its value already resolved by core (cascading filters read other fields). */
export interface LookupQueryFilter {
  column: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'is_set' | 'is_not_set'
  value?: string
}

export interface LookupQueryInput {
  ctx: ExtensionContext
  /** LookupSourceList.id */
  listId: string
  /** The typed text ('' = no search). */
  search: string
  match: 'contains' | 'prefix'
  searchColumns: string[]
  /** All must hold. */
  filters: LookupQueryFilter[]
  sort: { column: string; direction: 'asc' | 'desc' } | null
  /** Page size and start (server-side paging). */
  limit: number
  offset: number
  /** Only the rows whose `valueColumn` is one of these (checking stored / submitted values). */
  values?: string[]
  valueColumn: string
  /** The columns core needs back (display, value, fill); return no others. */
  columns: string[]
}

/**
 * A lookup source (ServerExtension.lookupSources): lists of the system the
 * extension connects (e.g. SharePoint lists) that a form's Autocomplete /
 * Dropdown reads its options from. Core resolves the filters, checks the
 * stored value is one of the source's rows on submit and keeps only the
 * configured columns. Runs as the person filling the form (anonymous
 * visitors only when the field allows it).
 */
export interface LookupSourceProvider {
  /** What it is ("SharePoint list"). */
  label: string
  /** Licence feature checked before every call. */
  feature?: string
  /** The lists a designer may pick (as the designer). */
  lists(input: { ctx: ExtensionContext }): Promise<LookupSourceList[]>
  /** One page of rows. `more`: there are rows after this page. */
  query(input: LookupQueryInput): Promise<{ rows: Array<Record<string, unknown>>; more?: boolean }>
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
  /** 'ai': an AI assist suggested it (shown as "AI — review"); absent: the importer's own mapping. */
  origin?: 'ai' | null
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

/** A place the core Nintex importer can put a workflow, offered by an extension ("a connected SharePoint list"). */
export interface NintexImportTarget {
  /** Unique within the extension; the importer addresses it as `ext.<extension>.<key>`. */
  key: string
  label: string
  description?: string
  /** What the person picks for it (e.g. the list, the events): select options are resolved for the workspace. */
  fields: Array<{ name: string; label: string; type: 'select' | 'multiselect' | 'text' | 'boolean'; options?: Array<{ value: string; label: string }>; required?: boolean; default?: string | string[] | boolean; description?: string }>
}

/** The Nintex workflow's start settings, as read from the export. */
export interface NintexStartOptions { manual: boolean; onCreate: boolean; onChange: boolean; conditions: boolean; workflowType: string }

/** A SharePoint list action of the Nintex workflow, for the extension to map onto its own step. */
export interface NintexListActionInput {
  kind: 'update' | 'create' | 'delete' | 'query'
  label: string
  fields: Record<string, string>
  currentItem: boolean
  caml?: string
  top?: number
  outputVar?: string
  /** Query list: the CAML translated — OData $filter / $orderby, a readable form; `exact` false when part of it could not be translated (keep `caml`). */
  query?: { filter: string; orderby: string; text: string; exact: boolean; unsupported: string[]; listId: string | null; select: string[] }
}

/**
 * One Nintex action as this extension's step(s): `node`, then `nodes` in order (e.g. "stop
 * inheriting permissions" and one grant per principal for Set item permissions).
 */
export interface NintexActionMapping {
  node: Omit<WorkflowGraphNode, 'id'>
  nodes?: Array<Omit<WorkflowGraphNode, 'id'>>
  status?: ImportReportItem['status']
  mappedTo: string
  detail?: string
}

/** What a target makes of an import: the trigger, the first step, and how list actions map. */
export interface NintexTargetPlan {
  /** One of this extension's trigger keys and its config (e.g. the list and events). */
  trigger: { key: string; config: Record<string, unknown>; label?: string }
  /** A step the target needs first (e.g. remember the item id); its id must not be `trigger`. */
  firstStep?: WorkflowGraphNode | null
  /** Map a list action onto this extension's step (null: the importer's placeholder). */
  listAction?(action: NintexListActionInput): { node: Omit<WorkflowGraphNode, 'id'>; status?: ImportReportItem['status']; mappedTo: string; detail?: string } | null
  /**
   * Map another Nintex action onto this extension's step (null: the importer's placeholder):
   * the SharePoint-only ones — NWSetItemPermissions, SPCheckOutItemWithKeyAdapter,
   * NWCheckInItemWithKeyAdapter, NWSetModerationStatusAdapter, NWStartWorkflow2Adapter … —
   * with their parameters as UserTasks templates.
   */
  otherAction?(action: { type: string; label: string; params: Record<string, string>; currentItem: boolean }): NintexActionMapping | null
  /** Shown before the import: other workflows on the same events, … */
  conflicts?: Array<{ workflowId: string; name: string; detail: string }>
  warnings?: string[]
  /** After the workflow is made / replaced (e.g. resolve the event conflicts the person chose); returns notes. */
  after?(input: { workflowId: string; conflictChoice: 'keep_both' | 'remove_from_other' }): Promise<string[]>
  /**
   * The workflow that already covers this target (e.g. one workflow per event of a list): the
   * import becomes a new draft version of it — same id, trigger, versions and run history —
   * instead of a second workflow on the same events. Ignored when the person picked a workflow.
   */
  into?: { workflowId: string; name: string } | null
}

/**
 * A column of the record a target writes (e.g. a SharePoint list column), as the core Nintex
 * importer compares it with the columns the workflow references. `kind` is the provider's type in
 * the importer's plain vocabulary; `typeLabel` its own name for people ("Person or group").
 */
export type ImportColumnKind =
  | 'text' | 'note' | 'number' | 'currency' | 'integer' | 'datetime' | 'boolean' | 'choice' | 'multichoice'
  | 'person' | 'people' | 'lookup' | 'lookupmulti' | 'url' | 'calculated' | 'system' | 'other'

export interface ImportTargetColumn {
  /** Stable key (the internal name): what `{{after.<key>}}` and list steps use. */
  key: string
  /** Display name. */
  label: string
  kind: ImportColumnKind
  typeLabel: string
  readOnly?: boolean
  choices?: string[]
}

/** The columns of a target (NintexImportHook.columns). */
export interface ImportTargetColumns {
  /** What they belong to, in plain words ("Expense Claims"). */
  title: string
  columns: ImportTargetColumn[]
  /** Ids / names the export may use for this record type (e.g. the SharePoint list GUID and title): lookups to them are lookups to the current list. */
  aliases?: string[]
  /** Kinds `createColumns` can add; empty / absent: none. */
  creatable?: ImportColumnKind[]
  /** The person may add columns here (e.g. manages the list); else `createReason` says why not. */
  canCreate?: boolean
  createReason?: string | null
}

/** A column to add (NintexImportHook.createColumns). */
export interface ImportColumnRequest { key: string; label: string; kind: ImportColumnKind; choices?: string[]; description?: string | null }

/** What "create a new record type for this workflow" offers (NintexImportHook.createTargetInfo), e.g. a SharePoint list. */
export interface NintexCreateTargetInfo {
  /** The button: "Create a SharePoint list for this workflow". */
  label: string
  description?: string | null
  /** Where it can go (e.g. connected sites), and the default (the current site in the designer embedded there). */
  containers: Array<{ value: string; label: string }>
  defaultContainer?: string | null
  containerLabel?: string
  /** Kinds of record type (e.g. list / document library). */
  kinds: Array<{ value: string; label: string }>
  /** Column kinds it can create. */
  creatable: ImportColumnKind[]
  canCreate: boolean
  reason?: string | null
}

export interface NintexCreateTargetInput {
  name: string
  container: string
  kind: string
  columns: Array<ImportColumnRequest & { required?: boolean }>
  /** A record type of that name exists: `fail` (409 code `exists`, details.existing) or `use` it (connect it; columns go through the column check). */
  ifExists: 'fail' | 'use'
  /** The dialog's id for this attempt: a retry of the same request finishes it instead of clashing with itself. */
  requestId: string
}

export interface NintexCreatedTarget {
  /** The import target it makes (one of this extension's target keys) and its settings. */
  target: string
  config: Record<string, unknown>
  title: string
  /** It existed already (ifExists: use). */
  existing: boolean
  created: Array<{ key: string; label: string }>
  failed: Array<{ label: string; reason: string }>
  url?: string | null
  notes?: string[]
}

/** The target a workflow already is bound to (NintexImportHook.boundTarget): the embedded designer's default "Connect to this …". */
export interface NintexBoundTarget {
  /** One of this extension's target keys (as in `targets`). */
  target: string
  /** The target's settings for this workflow (e.g. its list and events), passed to `plan`. */
  config: Record<string, unknown>
  /** "Connect to this SharePoint list". */
  label: string
  /** "Expense Claims · Item created". */
  description?: string | null
}

/**
 * Hooks into the core Nintex importer (ServerExtension.nintex): targets the
 * person can choose under "Where should this go?", and the plan for one.
 * Runs only where the extension is usable (and `feature` licensed).
 */
export interface NintexImportHook {
  feature?: string
  targets(input: { ctx: ExtensionContext }): Promise<NintexImportTarget[]>
  plan(input: { ctx: ExtensionContext; target: string; config: Record<string, unknown>; start: NintexStartOptions; workflowName: string; replacingWorkflowId?: string | null }): Promise<NintexTargetPlan>
  /**
   * The target one of this extension's workflows is bound to (its trigger settings), or null:
   * the import dialog of that workflow's designer offers it first ("Connect to this list") and
   * imports as a new draft of that workflow, keeping its trigger.
   */
  /**
   * The extension's mapping of its own Nintex actions when the import has no target of this
   * extension (a standalone workflow, a replaced core workflow, the first preview): the steps
   * come in with their record (e.g. the list) left to choose. Without it those actions are
   * placeholders.
   */
  unbound?(input: { ctx: ExtensionContext }): Promise<Pick<NintexTargetPlan, 'otherAction'>>
  boundTarget?(input: { ctx: ExtensionContext; workflow: { id: string; name: string; trigger: string; config: Record<string, unknown> } }): Promise<NintexBoundTarget | null>
  /** The target's real columns (read live where possible), for the importer's column check. */
  columns?(input: { ctx: ExtensionContext; target: string; config: Record<string, unknown> }): Promise<ImportTargetColumns | null>
  /**
   * Add columns the workflow needs to the target (after the person confirmed each one). Check
   * the person may change the target's schema (e.g. manages the list); refuse with ExtensionError
   * 403. Partial success is fine: report what failed per column.
   */
  /** "Create a <list> for this workflow": what can be created and where (null: not offered here). */
  createTargetInfo?(input: { ctx: ExtensionContext; workflow?: { id: string; trigger: string; config: Record<string, unknown> } | null }): Promise<NintexCreateTargetInfo | null>
  /** Create (or, ifExists: use, connect) the record type with its columns; check the person may (ExtensionError 403). */
  createTarget?(input: { ctx: ExtensionContext; input: NintexCreateTargetInput }): Promise<NintexCreatedTarget>
  createColumns?(input: { ctx: ExtensionContext; target: string; config: Record<string, unknown>; columns: ImportColumnRequest[] }): Promise<{ created: Array<{ key: string; label: string }>; failed: Array<{ label: string; reason: string }> }>
}

/** ctx.runs.waitFor input. */
export interface ExtensionWaitInput {
  /** What kind of event (the extension's own name, e.g. "item_update"); at most 60 characters. */
  key: string
  /** Exact values the event must carry (e.g. list and item id): they form the indexed match key. */
  match: Record<string, string | number | boolean>
  /** Conditions on the event's data (core rule operators: equals, not_equals, contains, gt, is_empty, changed …); none: any event of the key and match. */
  conditions?: { logic?: 'and' | 'or'; rules: Array<{ field: string; operator: string; value?: unknown }> }
  /** Minutes until the wait times out (none: waits until the event or a cancel). */
  timeoutMinutes?: number
  onTimeout?: 'continue' | 'fail' | 'branch'
  /** Shown in the run's process view ("Waiting for Status = Approved on item 4"). */
  description: string
}

/** What waitFor returns: the node handler returns it to pause the run. */
export interface ExtensionWaitRequest { __ext_wait: ExtensionWaitInput }

/** One reference method an extension generates for a connection (see ServerExtension.connectionReferences). */
export interface ConnectionReferenceMethod {
  /** Stable id, unique within the connection (≤ 300 characters). */
  id: string
  name: string
  description?: string
  /** Heading the References list groups it under. */
  group?: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Shown after the connection's base URL. */
  path: string
  /** Test dialog inputs; `default_value` pre-fills them (strings; objects / arrays as JSON). */
  inputs: Array<{ name: string; type: string; required?: boolean; description?: string; default_value?: string; enum?: string[] }>
  /** Changes data: the dialog asks before running it. */
  writes: boolean
  /** Needs `confirm: true` among its inputs (destructive bulk operations); never pre-filled. */
  destructive?: boolean
  access?: 'read' | 'write' | 'manage'
  notes?: string[]
}

/**
 * Reference methods for the extension's own connections: Integrations → the
 * connection → References lists them (read-only) and the Test dialog runs
 * them, as the caller (ctx.can carries the caller's permissions), gated on
 * `feature`.
 */
export interface ConnectionReferenceProvider {
  feature?: string
  list(input: { ctx: ExtensionContext; connectionId: string }): Promise<ConnectionReferenceMethod[]>
  run(input: { ctx: ExtensionContext; connectionId: string; methodId: string; inputs: Record<string, unknown> }): Promise<unknown>
}

/* ── processing provider (where queued work runs) ──────────────────── */

/**
 * How core hands off work (lib/processing/handoff.ts):
 *   web    run it in the web app, as without a provider (self-calls,
 *          synchronous starts and test runs inside the request);
 *   queue  enqueue only and return: the provider's workers run it (callers
 *          that need a result wait for the queued job, bounded).
 */
export type ProcessingHandoff = 'web' | 'queue'
export type ProcessingWorkKind = 'workflows' | 'agents' | 'media'

/** A workflow_queue job claimed for a processor (leased to host.workerId). */
export interface ProcessorJob {
  id: string
  workflow_id: string
  tenant_id: string
  trigger_type: string | null
  priority: number
  attempts: number
  /** Times a worker lost this job's lease before (crash, OOM, timeout) or an admin recovered it. */
  lease_lost_count: number
}

export interface ProcessorJobResult {
  /** completed: the job finished (whatever the run's own status); failed: it will be retried / is dead; lease_lost: taken over meanwhile, result discarded. */
  status: 'completed' | 'failed' | 'lease_lost'
  run_status?: string
  error?: string
}

/** Workflow queue counts (public.get_queue_health); null before migration 20270124090000. */
export interface QueueHealth {
  due: number
  scheduled: number
  processing: number
  /** Processing jobs whose lease expired (worker lost); the next claim recovers them. */
  stuck: number
  retrying: number
  dead_24h: number
  oldest_due_seconds: number
  at: string
}

/**
 * What core gives a processor process (`node worker.cjs --processor`): the
 * queue primitives the web app's own processor uses — leases (renewed by the
 * host while a job runs), expired-lease recovery, checkpoints and the
 * interrupted-run handling all stay in core.
 */
export interface ProcessorHost {
  /** UserTasks version of this build. */
  version: string
  /** This process's worker id (lease owner): `<host>-<pid>-<random>`. */
  workerId: string
  hostname: string
  /** WORKFLOW_CONCURRENCY (default 5, at most 50). */
  concurrency: number
  /** WORKFLOW_LEASE_SECONDS (default 120). */
  leaseSeconds: number
  workflows: {
    /** Claims up to `limit` runnable jobs (recovering stuck ones first), leased to workerId. */
    claim(limit: number): Promise<ProcessorJob[]>
    /** Runs one claimed job to its end; the host renews its lease meanwhile. Never throws. */
    run(job: ProcessorJob): Promise<ProcessorJobResult>
    /** Hands claimed jobs that were not started back to the queue (graceful stop). */
    release(jobIds: string[]): Promise<number>
    /** Jobs this process is running now. */
    running(): number
  }
  agents: { processBatch(input: { batchSize: number; deadline?: number }): Promise<{ processed: number }> }
  media: { processBatch(input: { batchSize: number; deadline?: number }): Promise<{ processed: number }> }
  queueHealth(): Promise<QueueHealth | null>
  /** The scheduler's minute tick in this process (leader-elected across processes). */
  scheduler: { start(): void; stop(): Promise<void> }
  /**
   * A session-level Postgres URL for LISTEN (PROCESSING_LISTEN_DATABASE_URL,
   * else the gateway's resolution: POSTGRES_URL_NON_POOLING, SUPABASE_DB_URL,
   * DATABASE_URL with DB_PROVIDER=postgres), or null — then poll.
   */
  listenUrl(): string | null
  /** node-postgres connection config for a URL (core's auth plugins: IAM / Entra tokens, TLS). */
  pgConfig(url: string, extra?: Record<string, unknown>): Record<string, unknown>
  /** Service-role database client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js client typing is per-schema
  db: any
}

/** One processor process as the provider reports it (SDK 1.3). */
export interface ProcessingWorkerSummary {
  id: string
  hostname: string | null
  version: string | null
  /** running | paused (memory or licence) | draining | stopped */
  state: string
  /** Heartbeat younger than the provider's online window. */
  online: boolean
  queues: string[]
  concurrency: number
  jobs_running: number
  jobs_per_minute: number
  rss_bytes: number | null
  listening: boolean
  last_seen: string
  note?: string | null
}

/** The provider's switches (SDK 1.3): what Settings → Infrastructure → Processing shows and changes through `configure`. */
export interface ProcessingSettingsView {
  mode: 'web' | 'workers'
  test_runs_on_workers: boolean
  /** Set in the server environment: the UI and API cannot change it. */
  locked: { mode: boolean; test_runs_on_workers: boolean }
  /** Switching to workers is possible now (at least one worker online). */
  can_use_workers?: boolean
}

/** Settings → Infrastructure → Processing: what the provider reports. */
export interface ProcessingStatus {
  mode: ProcessingHandoff
  /** One line, e.g. "Separate workers (3 online)". */
  label: string
  tone?: 'success' | 'warning' | 'danger' | 'info'
  details?: string[]
  /** The provider's own page (e.g. /x/processing). */
  href?: string
  /** SDK 1.3: the switches, so core's Settings card can show and change them (through `configure`). */
  settings?: ProcessingSettingsView
  /** SDK 1.3: processor processes (most recent first, at most 50). */
  workers?: ProcessingWorkerSummary[]
}

/**
 * Processing provider: decides where queued work runs and runs the processor
 * process. Instance-wide: hooks get an instance context (tenantId null);
 * core asks only while the extension is licensed (`feature`).
 */
export interface ProcessingProvider {
  /** Licence feature (manifest licence.features) the provider needs. */
  feature?: string
  /** The hand-off mode now. Called often; core caches the answer ~5 s per process. */
  handoff(input: { ctx: ExtensionContext }): Promise<ProcessingHandoff>
  /** queue mode: run designer test runs through the queue too (default: in the web app). */
  testRunsOnWorkers?(input: { ctx: ExtensionContext }): Promise<boolean>
  /** Work of `kind` was enqueued (queue mode): wake the workers. Best effort. */
  notify?(input: { ctx: ExtensionContext; kind: ProcessingWorkKind }): Promise<void>
  /**
   * The processor process (`node worker.cjs --processor [args]`): claim and
   * run work until `signal` aborts (SIGTERM / SIGINT), then drain and
   * resolve. Core exits when it resolves.
   */
  processor?(input: { ctx: ExtensionContext; host: ProcessorHost; signal: AbortSignal; args: string[] }): Promise<void>
  /** Status block on Settings → Infrastructure (and GET /api/v1/admin/processing). */
  status?(input: { ctx: ExtensionContext }): Promise<ProcessingStatus>
  /**
   * PATCH /api/v1/admin/processing (instance admin token; `usertasks
   * admin-processing configure`): change the provider's settings. Throw
   * ExtensionError (e.g. 409 when no worker is online) to refuse.
   */
  configure?(input: { ctx: ExtensionContext; changes: { mode?: 'web' | 'workers'; test_runs_on_workers?: boolean } }): Promise<ProcessingStatus>
}

/* ── infrastructure provider (changing infrastructure: the Infrastructure add-on) ── */

/** The signed-in instance admin an infrastructure action runs for (core checked instance-admin access and the licence). */
export interface InfrastructureViewer {
  id: string
  email: string | null
}

export type InfrastructureActionResult = ({ ok: true } & Record<string, unknown>) | ({ ok: false; error: string } & Record<string, unknown>)

/** What core's admin CLI hands an add-on command (`usertasks-admin switch|rollback …`). */
export interface InfrastructureCliInput {
  /** The arguments after the command name, unparsed. */
  argv: string[]
  io: { out: (line: string) => void; err: (line: string) => void; env: NodeJS.ProcessEnv }
  /**
   * Run `fn` with the instance store: a direct connection (DATABASE_URL /
   * --db-url, data keys loaded) or, on the Supabase provider without one, the
   * service-role API (dbUrl ''). Resolves null when neither is available
   * (the command says what to set).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SqlClient (lib/admin/ops/instance-db) without importing core into the SDK
  withStore<T>(fn: (db: any, dbUrl: string, viaApi: boolean) => Promise<T>): Promise<T | null>
  /** Who to record in the switch log (--actor, else user@host). */
  actor: string
}

/**
 * Changing infrastructure (the paid Infrastructure add-on). Core RUNS any
 * provider configuration on its own; this provider is what CHANGES it:
 * provider switches with their data copies, rollback, the switch log
 * controls, the setup wizard's "move off Supabase" section and the
 * `switch` / `rollback` admin commands. Core consults it only while the
 * extension is licensed for `feature` (instance-wide), and refuses the same
 * calls itself otherwise (lib/infrastructure/provider.ts). At most one
 * extension in a build should provide it.
 */
export interface InfrastructureProvider {
  /** Licence feature (manifest licence.features) the provider needs. */
  feature?: string
  /** The add-on's page (e.g. /x/infrastructure): Settings → Infrastructure links its Change… buttons there. */
  href: string
  /**
   * Server actions behind the add-on's pages, by name, called through core's
   * `infrastructureAction(name, input)` server action after core checked the
   * caller is an instance admin and the add-on is licensed. The provider
   * checks again (defence in depth) and returns `{ ok: false, error }` to refuse.
   */
  actions: Record<string, (input: { ctx: ExtensionContext; viewer: InfrastructureViewer; input: unknown }) => Promise<InfrastructureActionResult>>
  /**
   * The provider-switches job (every minute, and on /api/cron/provider-switches):
   * run or continue queued background switches. `deadline` (epoch ms) bounds
   * a serverless chunk.
   */
  runQueued?(input: { ctx: ExtensionContext; deadline?: number }): Promise<Record<string, unknown>>
  /** Admin CLI commands by name (`switch`, `rollback`); exit code 0 ok, 1 failed, 2 usage / refused. */
  cli?: Record<string, { usage: string; run(input: InfrastructureCliInput): Promise<number> }>
}

/** A note about the extension's licence state for Settings → Extensions (e.g. what was given back when a trial ended). */
export interface LicensingNotice {
  tone: 'info' | 'success' | 'warning' | 'danger'
  message: string
}

export interface ServerExtension {
  /** Must equal manifest.id. */
  id: string
  /**
   * Licensing hooks (paid extensions):
   *   notices      plain-language notes Settings → Extensions shows under the
   *                extension's licence state (called with the workspace's
   *                system context; may run while unlicensed; keep it cheap);
   *   trialFarms   farms this installation already knows (manifest
   *                licence.trial with unit 'farm'), to pre-fill "Start a trial".
   */
  licensing?: {
    notices?(input: { ctx: ExtensionContext }): Promise<LicensingNotice[]>
    trialFarms?(input: { ctx: ExtensionContext }): Promise<Array<{ id: string; label?: string }>>
  }
  /** Reference methods of this extension's connections (Integrations → References, Test dialog). */
  connectionReferences?: ConnectionReferenceProvider
  /** Form data targets by key: forms bound to records this extension provides (layout.data_target = { extension, key, config }). */
  formTargets?: Record<string, FormTarget>
  /** Lookup sources by key: lists a form's Autocomplete / Dropdown reads (lookup source `extension`). */
  lookupSources?: Record<string, LookupSourceProvider>
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
  /** Targets for the core Nintex importer (bind to a record of this extension, map its list actions). */
  nintex?: NintexImportHook
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
  /** Where queued work runs (separate workers): see ProcessingProvider. At most one extension in a build should provide it. */
  processing?: ProcessingProvider
  /** Changing infrastructure providers (the Infrastructure add-on): see InfrastructureProvider. */
  infrastructure?: InfrastructureProvider
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
