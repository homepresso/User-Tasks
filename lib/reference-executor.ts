/**
 * Shared reference execution logic — the one runtime for integration
 * references: the workflow engine (Call Reference, Live Reference, event
 * triggers), agents, MCP tools, reports and the test-reference API.
 *
 * Requests are rendered by lib/integrations/request-template (escaping per
 * position), authenticated by lib/integrations/attach-auth (static or minted
 * tokens) and sent by lib/integrations/http (egress guard on every hop,
 * timeout budget, 429/5xx retries, response size caps).
 */

import { resolveTransportFetch } from "@/lib/integrations/transports";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallerContext } from "./trace";
import { isSensitiveKey, decryptSensitiveFields } from "./secret-fields";
import { applyAuthHeaders } from "./integrations/attach-auth";
import {
  connectorFetch,
  MAX_BINARY_RESPONSE_BYTES,
  MAX_STRUCTURED_RESPONSE_BYTES,
  providerErrorMessage,
  readCappedBody,
} from "./integrations/http";
import { invalidateMintedToken } from "./integrations/token-mint";
import {
  renderBodyTemplate,
  renderHeaderTemplate,
  renderPathTemplate,
  stripHeaderBreaks,
  templateMentions,
} from "./integrations/request-template";
import { truncateForStorage } from "./truncate";
import { referenceInputText } from "./reference-input-utils";
import { isCustomReference } from "./custom-references/types";

interface ExecuteReferenceOptions {
  supabase: SupabaseClient;
  referenceId: string;
  /** Resolved input values (name → value). Objects/arrays/file refs are allowed. */
  inputValues: Record<string, any>;
  timeout?: number;
  expectedTenantId?: string;
  /**
   * Caller context — propagates through to integration_call_logs so we can
   * link each outbound HTTP call back to the workflow run / form submission /
   * agent run that triggered it. Optional: if omitted the log still records
   * the call but without a caller id.
   */
  caller?: CallerContext;
  /** Per-call input locations (workflow node overrides), by input id or name. */
  inputLocations?: Record<string, string>;
  /** Replaces the reference's body template (workflow custom / form-built bodies). */
  bodyTemplate?: string;
  /**
   * Database result shape. 'rows' always returns the row array (the
   * workflow Call Reference contract); 'smart' (default) returns one object
   * for single-row lookups and { affected_rows } for writes.
   */
  dbResultShape?: "smart" | "rows";
  /**
   * Run an unsaved reference (the custom reference builder's Test / Load
   * sample) against one of the tenant's integrations: same executor, egress
   * guard, credential handling and call log. Requires expectedTenantId.
   */
  draft?: { integrationId: string; inputs: any[]; request_config: any; sourceOnly?: boolean };
  /**
   * Write-kind custom references: 'dry_run' rolls a database write back
   * (reporting the SQL and the rows it would affect) and renders a REST
   * request without sending it. Only the builder's Test uses it.
   */
  writeMode?: "run" | "dry_run";
  /**
   * The caller only reads (form lookups, Data table sources, reports): a
   * write-kind custom reference is refused.
   */
  readOnly?: boolean;
  /** Internal (custom reference writes): database transaction options. */
  dbWrite?: { maxAffected?: number; dryRun?: boolean };
  /** Internal (custom reference REST dry run): render the request and return it without sending. */
  previewRequest?: boolean;
}

export interface ExecuteReferenceResult {
  status: number;
  data: any;
  headers?: Record<string, string>;
  /** Provider error text for HTTP >= 400 (or Slack-style ok:false), when recognisable. */
  error_message?: string;
  /** Custom references: which shaping stages ran where, and row counts. */
  shaping?: Record<string, any>;
  log?: {
    integrationId: string | null;
    tenantId: string | null;
    method: string | null;
    url: string | null;
    requestHeaders?: Record<string, any> | null;
    responseHeaders?: Record<string, any> | null;
  };
}

/** Headers that always get redacted before being written to integration_call_logs */
const SENSITIVE_HEADER_RE =
  /^(authorization|cookie|set-cookie|proxy-authorization|x-csrf-token|api-key|.*api[-_]?key.*|.*token.*|.*secret.*|.*signature.*|.*password.*|x-goog-api-key|ocp-apim-subscription-key|dropbox-api-select-user)$/i;
/** Query params that always get redacted from URL logs */
const SENSITIVE_QUERY_RE =
  /(^|[&?])(access_token|api_key|apikey|auth|token|key|password|secret|signature|sig|sas_token|client_secret|code|refresh_token|x-amz-signature|x-amz-credential|x-amz-security-token)=[^&#]*/gi;

/** Returns a shallow-copied headers object with sensitive values replaced by "***" */
export function redactHeaders(
  headers: Record<string, any> | undefined,
): Record<string, any> {
  if (!headers || typeof headers !== "object") return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_RE.test(k) ? "***" : v;
  }
  return out;
}

/** Strip sensitive query params (and URL userinfo) from a URL for safe logging */
export function redactUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return url
      .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1***@")
      .replace(SENSITIVE_QUERY_RE, (_, prefix, key) => `${prefix}${key}=***`);
  } catch {
    return url;
  }
}

/** Input values for the call log: values of credential-like inputs masked. */
function redactInputs(values: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(values ?? {})) out[k] = isSensitiveKey(k) ? "***" : v;
  return out;
}

/** Clamp a value to a max size so we don't blow up the log row */
const truncate = (value: any, maxBytes = 64 * 1024): any => truncateForStorage(value, maxBytes);

/** Fire-and-forget write to integration_call_logs. Never throws. */
async function writeCallLog(
  supabase: SupabaseClient,
  row: Record<string, any>,
): Promise<void> {
  try {
    await (supabase as any).from("integration_call_logs").insert(row);
  } catch (err) {
    console.warn("[reference-executor] call log write failed:", err);
  }
}

export async function executeReference(
  opts: ExecuteReferenceOptions,
): Promise<ExecuteReferenceResult> {
  const { supabase, referenceId, inputValues, caller, expectedTenantId } = opts;
  const startedAt = Date.now();
  let integrationId: string | null = null;
  let tenantId: string | null = null;
  let logMethod: string | null = null;
  let logUrl: string | null = null;
  let logRequestHeaders: Record<string, any> | null = null;
  let logResponseHeaders: Record<string, any> | null = null;

  try {
    const result = await executeReferenceInner(opts);
    integrationId = result.log?.integrationId ?? null;
    tenantId = result.log?.tenantId ?? null;
    logMethod = result.log?.method ?? null;
    logUrl = result.log?.url ?? null;
    logRequestHeaders = result.log?.requestHeaders ?? null;
    logResponseHeaders = result.log?.responseHeaders ?? null;

    // Write success log row
    if (tenantId) {
      void writeCallLog(supabase, {
        tenant_id: tenantId,
        integration_id: integrationId,
        reference_id: referenceId || null,
        caller_type: caller?.callerType ?? null,
        caller_id: caller?.callerId ?? null,
        caller_node_id: caller?.callerNodeId ?? null,
        trace_id: caller?.traceId ?? null,
        method: logMethod,
        url: redactUrl(logUrl),
        request_headers: truncate(
          logRequestHeaders ? redactHeaders(logRequestHeaders) : null,
        ),
        request_body: truncate(redactInputs(inputValues)),
        response_status: result.status,
        response_headers: truncate(
          logResponseHeaders ? redactHeaders(logResponseHeaders) : null,
        ),
        response_body: truncate(result.data),
        duration_ms: Date.now() - startedAt,
        error: result.error_message ?? null,
        started_at: new Date(startedAt).toISOString(),
        completed_at: new Date().toISOString(),
      });
    }

    // Callers hand results to browsers, MCP clients and agents: never the
    // raw request headers (they carry the decrypted credentials).
    return {
      ...result,
      log: result.log
        ? {
            ...result.log,
            url: redactUrl(result.log.url),
            requestHeaders: result.log.requestHeaders ? redactHeaders(result.log.requestHeaders) : null,
            responseHeaders: result.log.responseHeaders ? redactHeaders(result.log.responseHeaders) : null,
          }
        : undefined,
    };
  } catch (err: any) {
    // Best-effort identification of the reference for failure logging
    try {
      if (opts.draft) throw new Error("draft");
      const { data: refForLog } = await supabase
        .from("integration_references")
        .select(
          "integration_id, tenant_id, integration:integrations(id, tenant_id, config)",
        )
        .eq("id", referenceId)
        .single();
      const integ = (refForLog as any)?.integration;
      integrationId = (refForLog as any)?.integration_id ?? integ?.id ?? null;
      tenantId = (refForLog as any)?.tenant_id ?? integ?.tenant_id ?? null;
      if (expectedTenantId && tenantId !== expectedTenantId) {
        integrationId = null;
        tenantId = null;
      }
      logUrl = redactUrl(integ?.config?.base_url ?? null);
    } catch {
      if (opts.draft && expectedTenantId) {
        integrationId = opts.draft.integrationId;
        tenantId = expectedTenantId;
      }
    }

    if (tenantId) {
      void writeCallLog(supabase, {
        tenant_id: tenantId,
        integration_id: integrationId,
        reference_id: referenceId || null,
        caller_type: caller?.callerType ?? null,
        caller_id: caller?.callerId ?? null,
        caller_node_id: caller?.callerNodeId ?? null,
        trace_id: caller?.traceId ?? null,
        method: logMethod,
        url: logUrl,
        request_headers: null,
        request_body: truncate(redactInputs(inputValues)),
        response_status: null,
        response_headers: null,
        response_body: null,
        duration_ms: Date.now() - startedAt,
        error: String(err?.message ?? err),
        started_at: new Date(startedAt).toISOString(),
        completed_at: new Date().toISOString(),
      });
    }

    throw err;
  }
}

const PAGE_SIZE_INPUTS = new Set(["limit", "top", "page_size", "max_results"]);

/**
 * Inputs → typed values: defaults, numeric coercion, required checks.
 * An empty optional number stays empty (it is dropped from the request)
 * instead of becoming 0.
 */
function resolveInputValues(inputs: any[], inputValues: Record<string, any>, options: { pageDefaults?: boolean } = {}): Record<string, any> {
  const resolved: Record<string, any> = {};
  for (const input of inputs) {
    let value: any = inputValues[input.name];
    if (value === undefined || value === null || value === "") value = input.default_value ?? "";

    if ((input.type === "number" || input.type === "integer") && value !== "" && value != null && typeof value !== "object") {
      const n = Number(value);
      value = Number.isNaN(n) ? "" : n;
    }

    // Sensible defaults for common params
    if ((value === undefined || value === null || value === "") && options.pageDefaults !== false) {
      if (input.name === "offset" || input.name === "skip") value = 0;
      else if (PAGE_SIZE_INPUTS.has(input.name)) value = 100;
    }

    if (input.required && (value === undefined || value === null || value === "")) {
      throw new Error(
        `Required input "${input.name}" is missing. Provide a value or set a default.`,
      );
    }
    resolved[input.name] = value;
  }
  return resolved;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === lower);
  return key ? headers[key] : undefined;
}

function setHeaderCI(headers: Record<string, string>, name: string, value: string) {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) delete headers[k];
  headers[name] = value;
}

/** Non-HTTP keys connector definitions keep in integration headers. */
const NON_HTTP_HEADER_KEYS = new Set(["_executor", "db_type", "host", "port", "database", "ssl", "encrypt", "trustservercertificate"]);

/** The reference row (with its integration) — or a draft built on one of the tenant's integrations. */
async function loadReferenceRow(opts: ExecuteReferenceOptions): Promise<any> {
  const { supabase, referenceId, draft, expectedTenantId } = opts;
  if (draft) {
    if (!expectedTenantId) throw new Error("Reference not found");
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", draft.integrationId)
      .eq("tenant_id", expectedTenantId)
      .maybeSingle();
    if (!integration) throw new Error("Reference not found");
    return {
      id: referenceId || null,
      tenant_id: expectedTenantId,
      integration_id: draft.integrationId,
      inputs: Array.isArray(draft.inputs) ? draft.inputs : [],
      request_config: draft.request_config ?? {},
      integration,
    };
  }
  const { data: ref } = await supabase
    .from("integration_references")
    .select("*, integration:integrations(*)")
    .eq("id", referenceId)
    .single();
  return ref;
}

async function executeReferenceInner(opts: ExecuteReferenceOptions): Promise<ExecuteReferenceResult> {
  const { supabase, expectedTenantId } = opts;
  // Load reference + integration
  const ref = await loadReferenceRow(opts);

  if (!ref) throw new Error("Reference not found");

  const integration = ref.integration as any;
  const referenceTenantId = (ref as any).tenant_id
    ? String((ref as any).tenant_id)
    : null;
  const integrationTenantId = integration?.tenant_id
    ? String(integration.tenant_id)
    : referenceTenantId;
  if (!integrationTenantId)
    throw new Error("Reference is missing tenant context");
  if (referenceTenantId && integration?.tenant_id && String(integration.tenant_id) !== referenceTenantId) {
    throw new Error("Reference not found");
  }
  if (expectedTenantId && integrationTenantId !== expectedTenantId) {
    throw new Error("Reference not found");
  }
  // Central read boundary: credential fields inside integration config are
  // encrypted at rest — decrypt once here so every executor path (HTTP auth,
  // db-connector, S3, Azure Blob, Google service accounts) sees plaintext.
  let integrationConfig = decryptSensitiveFields(integration?.config) as any;
  if (integration?.type && integrationConfig) {
    // Connector integrations stored by an older definition are upgraded on read.
    const { getConnectorDefinition } = await import("@/lib/connectors/registry");
    const upgrade = getConnectorDefinition(String(integration.type))?.upgradeIntegrationConfig;
    if (upgrade) integrationConfig = upgrade(integrationConfig);
  }

  // Custom references: run the source operation / table query, then shape
  // the result (lib/custom-references/run).
  if (isCustomReference(ref)) {
    const { runCustomReference } = await import("./custom-references/run");
    return runCustomReference({
      ref,
      integrationConfig,
      inputValues: opts.inputValues ?? {},
      sourceOnly: Boolean(opts.draft?.sourceOnly),
      writeMode: opts.writeMode,
      readOnly: opts.readOnly,
      idempotency: ref.id
        ? (key: string) => idempotencyStore(String(ref.id), integrationTenantId, key)
        : undefined,
      loadSettings: async () => ({
        ...settingsFromConfig(integrationConfig),
        ...(await loadTemplateVars(supabase, integration, integrationConfig, integrationTenantId)),
      }),
      runSource: (sourceRef, values, extra) =>
        executeLoadedReference(
          { ...opts, inputValues: values, dbResultShape: "rows", inputLocations: undefined, bodyTemplate: undefined, dbWrite: extra?.dbWrite, previewRequest: extra?.previewRequest },
          sourceRef,
          integration,
          integrationConfig,
          integrationTenantId,
        ),
    });
  }
  return executeLoadedReference(opts, ref, integration, integrationConfig, integrationTenantId);
}

/** The idempotency ledger of a custom reference write (lib/custom-references/idempotency). */
function idempotencyStore(referenceId: string, tenantId: string, key: string) {
  let loaded: Promise<typeof import("./custom-references/idempotency")> | null = null;
  const mod = () => (loaded ??= import("./custom-references/idempotency"));
  let claimId: string | null = null;
  return {
    claim: async () => {
      const result = await (await mod()).claimIdempotencyKey({ tenantId, referenceId, key });
      if (result.kind === "claimed") claimId = result.id;
      return result;
    },
    complete: async (result: ExecuteReferenceResult) => { if (claimId) await (await mod()).completeIdempotencyKey(claimId, result); },
    release: async () => { if (claimId) await (await mod()).releaseIdempotencyKey(claimId); },
  };
}

/** Integration settings a custom reference's Fixed inputs may use (auth / database values, never the internal `_` keys). */
export function settingsFromConfig(integrationConfig: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const section of [integrationConfig?.auth_config, integrationConfig?.db_config]) {
    if (!section || typeof section !== "object") continue;
    for (const [k, v] of Object.entries(section)) {
      if (k.startsWith("_") || (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")) continue;
      if (!(k in out)) out[k] = v;
    }
  }
  return out;
}

async function executeLoadedReference(
  {
    supabase,
    inputValues,
    timeout = 30000,
    inputLocations,
    bodyTemplate,
    dbResultShape,
    caller,
    dbWrite,
    previewRequest,
  }: ExecuteReferenceOptions,
  ref: any,
  integration: any,
  integrationConfig: any,
  integrationTenantId: string,
): Promise<ExecuteReferenceResult> {
  let effectiveRef: any = ref;
  if (integration?.type && (ref as any).request_config?.connector_template) {
    const { getConnectorDefinition } = await import("@/lib/connectors/registry");
    const { currentConnectorReference } = await import("@/lib/connectors/reference-upgrade");
    effectiveRef = currentConnectorReference(ref as any, getConnectorDefinition(String(integration.type)));
  }
  const reqConfig = effectiveRef.request_config as any;
  const inputs = (effectiveRef.inputs as any[]) ?? [];
  const method = (reqConfig?.method ?? "GET").toUpperCase();
  const logContext = {
    integrationId: integration?.id ?? (ref as any)?.integration_id ?? null,
    tenantId: integrationTenantId,
    method,
  };

  // A dry run never reaches executors that act on their own (objects, e-signature).
  if (previewRequest && (reqConfig?._executor === "object" || String(reqConfig?.path_template ?? "").startsWith("/_internal/esign/"))) {
    return {
      status: 200,
      data: { request: { method, url: String(reqConfig?.path_template ?? ""), headers: {}, body: inputValues } },
      log: { ...logContext, url: null },
    };
  }

  // ── Object executor: queries custom_table_rows directly ──
  if (reqConfig?._executor === "object" && reqConfig?.table_id) {
    const tableId = reqConfig.table_id;
    const operation = reqConfig.operation ?? "list";
    const limit = Number(inputValues.limit ?? 50) || 50;
    const offset = Number(inputValues.offset ?? 0) || 0;

    if (operation === "list") {
      const { data: rows, error } = await supabase
        .from("custom_table_rows")
        .select("id, data, created_at")
        .eq("tenant_id", integrationTenantId)
        .eq("table_id", tableId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw new Error(error.message);
      return {
        status: 200,
        data: (rows ?? []).map((r) => ({
          id: r.id,
          ...((r as any).data ?? {}),
          created_at: r.created_at,
        })),
        log: { ...logContext, url: `object://${tableId}/list` },
      };
    }

    if (operation === "get") {
      const rowId = inputValues.id;
      if (!rowId) throw new Error('Input "id" is required for get operation');
      const { data: row, error } = await supabase
        .from("custom_table_rows")
        .select("id, data, created_at")
        .eq("tenant_id", integrationTenantId)
        .eq("id", rowId)
        .eq("table_id", tableId)
        .single();
      if (error) throw new Error(error.message);
      return {
        status: 200,
        data: {
          id: row.id,
          ...((row as any).data ?? {}),
          created_at: row.created_at,
        },
        log: { ...logContext, url: `object://${tableId}/${rowId}` },
      };
    }

    if (operation === "insert") {
      const { id: _id, limit: _l, offset: _o, ...rowData } = inputValues;
      const { data: row, error } = await supabase
        .from("custom_table_rows")
        .insert({
          table_id: tableId,
          tenant_id: integrationTenantId,
          data: rowData,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return {
        status: 201,
        data: { id: row?.id, inserted: true },
        log: { ...logContext, url: `object://${tableId}` },
      };
    }

    if (operation === "update") {
      const rowId = inputValues.id;
      if (!rowId)
        throw new Error('Input "id" is required for update operation');
      const { id: _id, limit: _l, offset: _o, ...updates } = inputValues;
      // Merge with existing data
      const { data: existing } = await supabase
        .from("custom_table_rows")
        .select("data")
        .eq("tenant_id", integrationTenantId)
        .eq("id", rowId)
        .eq("table_id", tableId)
        .single();
      const merged = { ...((existing as any)?.data ?? {}), ...updates };
      const { error } = await supabase
        .from("custom_table_rows")
        .update({ data: merged })
        .eq("tenant_id", integrationTenantId)
        .eq("id", rowId)
        .eq("table_id", tableId);
      if (error) throw new Error(error.message);
      return {
        status: 200,
        data: { id: rowId, updated: true },
        log: { ...logContext, url: `object://${tableId}/${rowId}` },
      };
    }

    if (operation === "delete") {
      const rowId = inputValues.id;
      if (!rowId)
        throw new Error('Input "id" is required for delete operation');
      const { error } = await supabase
        .from("custom_table_rows")
        .delete()
        .eq("tenant_id", integrationTenantId)
        .eq("id", rowId)
        .eq("table_id", tableId);
      if (error) throw new Error(error.message);
      return {
        status: 200,
        data: { id: rowId, deleted: true },
        log: { ...logContext, url: `object://${tableId}/${rowId}` },
      };
    }

    throw new Error(`Unknown object operation: ${operation}`);
  }

  // Values: connector configuration (account ids, API versions, sender
  // addresses …) fill inputs the caller left empty and {{placeholders}} that
  // are not inputs; then the reference inputs proper.
  const templateVars = await loadTemplateVars(supabase, integration, integrationConfig, integrationTenantId);
  const callerValues: Record<string, any> = { ...(inputValues ?? {}) };
  for (const input of inputs) {
    const given = callerValues[input.name];
    const empty = given === undefined || given === null || given === "";
    if (empty && (input.default_value === undefined || input.default_value === null || input.default_value === "") && templateVars[input.name] != null && templateVars[input.name] !== "") {
      callerValues[input.name] = templateVars[input.name];
    }
  }
  // Hand-built references keep the historic page-size defaults; connector
  // templates declare their own (an implicit $top=100 would cap OData results).
  const resolvedParams = resolveInputValues(inputs, callerValues, { pageDefaults: !reqConfig?.typed_placeholders });
  const values: Record<string, any> = { ...templateVars, ...resolvedParams };

  const rawPathTemplate: string = reqConfig?.path_template ?? "";
  const rawBodyTemplate: string = bodyTemplate ?? reqConfig?.body_template ?? "";
  const requestHeaderTemplates: Record<string, any> = reqConfig?.headers ?? {};

  // E-signature connectors: /_internal/esign/<operation> templates run the
  // shared e-sign runtime (multi-step provider calls, idempotent sends,
  // downloads into workflow files) — lib/esign/executor.
  if (typeof rawPathTemplate === "string" && rawPathTemplate.startsWith("/_internal/esign/") && integration?.type) {
    const { isEsignConnector } = await import("@/lib/esign/catalog");
    if (isEsignConnector(String(integration.type))) {
      const { executeEsignReference } = await import("@/lib/esign/executor");
      const esign = await executeEsignReference({
        integration: { id: String(integration.id), type: String(integration.type) },
        integrationConfig,
        path: rawPathTemplate,
        values: resolvedParams,
        tenantId: integrationTenantId,
        supabase,
        timeout,
        caller: caller ?? null,
      });
      return {
        status: esign.status,
        data: esign.data,
        ...(esign.error_message ? { error_message: esign.error_message } : {}),
        log: { ...logContext, method, url: `esign://${String(integration.type)}/${esign.operation}` },
      };
    }
  }

  // Check if this is a database integration
  const dbConfig = integrationConfig?.db_config;
  const isDatabase =
    dbConfig ||
    integrationConfig?.headers?._executor === "database" ||
    integrationConfig?.base_url?.match(
      /^(postgresql|postgres|mssql|mysql|oracle|mongodb|snowflake):\/\//,
    );

  if (isDatabase && previewRequest) {
    // An operation of a database integration is not run by a dry run (table writes dry-run in a transaction).
    return {
      status: 200,
      data: { request: { method, url: null, headers: {}, body: rawBodyTemplate || rawPathTemplate, note: "Database operations are not run by a dry run — use a table source for a rolled-back dry run" } },
      log: { ...logContext, url: null },
    };
  }

  if (isDatabase) {
    // SQL / Mongo specs are rendered and bound by lib/db-reference (values
    // as driver parameters, never URL-encoded or spliced into SQL text).
    const { executeDatabaseReference } = await import("@/lib/db-reference");
    const db = await executeDatabaseReference({
      integrationConfig,
      method,
      pathTemplate: rawPathTemplate,
      bodyTemplate: rawBodyTemplate,
      inputs,
      values: resolvedParams,
      resultShape: dbResultShape ?? "smart",
      timeout,
      ...(dbWrite ? { write: dbWrite } : {}),
    });
    return {
      status: db.status,
      data: db.data,
      log: { ...logContext, url: db.logUrl },
    };
  }

  const locationOf = (input: any): string =>
    inputLocations?.[input.id] ?? inputLocations?.[input.name] ?? input.location ?? "query";
  const mentioned = (name: string) =>
    templateMentions(rawPathTemplate, name) ||
    templateMentions(rawBodyTemplate, name) ||
    templateMentions(reqConfig?.method, name) ||
    Object.values(requestHeaderTemplates).some((v) => templateMentions(v, name));

  // Inputs that are not placed by a template go where their location says.
  const queryParams: Record<string, string> = {};
  const inputHeaders: Record<string, string> = {};
  for (const input of inputs) {
    const value = resolvedParams[input.name];
    const strValue = referenceInputText(value);
    const location = locationOf(input);
    if (location === "header") {
      if (strValue && !mentioned(input.name)) inputHeaders[input.name] = stripHeaderBreaks(strValue);
    } else if (location === "query") {
      // A value the template already places (path, body or header) is not
      // repeated as a query parameter.
      if (strValue && !mentioned(input.name) && input.name !== "next_link") queryParams[input.name] = strValue;
    }
  }

  const inputTypes = reqConfig?.typed_placeholders
    ? Object.fromEntries(inputs.map((input: any) => [input.name, String(input.type ?? "string")]))
    : undefined;

  // Template headers ({{placeholders}} rendered, CR/LF stripped).
  const renderedRequestHeaders: Record<string, string> = {};
  for (const [hk, hv] of Object.entries(requestHeaderTemplates)) {
    if (typeof hv !== "string") continue;
    const rendered = hv.includes("{{") ? renderHeaderTemplate(hv, values, inputTypes) : stripHeaderBreaks(hv);
    if (hv.includes("{{") && !rendered.trim()) {
      // An idempotency key the caller did not supply: one per call, reused
      // by every retry of it (so a retried POST cannot charge twice).
      if (/^idempotency-key$/i.test(hk)) renderedRequestHeaders[hk] = randomUUID();
      continue; // optional header left empty
    }
    renderedRequestHeaders[hk] = rendered;
  }

  const integrationHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(integrationConfig?.headers ?? {})) {
    if (NON_HTTP_HEADER_KEYS.has(k.toLowerCase()) || typeof v !== "string") continue;
    // A static CSRF "fetch" marker is a request to prefetch a token, not a header to send.
    if (k.toLowerCase() === "x-csrf-token" && v.toLowerCase() === "fetch") continue;
    integrationHeaders[k] = stripHeaderBreaks(v);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...integrationHeaders,
    ...inputHeaders,
    ...renderedRequestHeaders,
  };
  const contentType = findHeader(headers, "content-type");

  const effectiveMethod = /\{\{/.test(String(reqConfig?.method ?? ""))
    ? renderHeaderTemplate(String(reqConfig.method), values).trim().toUpperCase()
    : method;
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(effectiveMethod)) {
    throw new Error(`Unsupported HTTP method "${effectiveMethod}"`);
  }
  const body = renderBodyTemplate(rawBodyTemplate, values, contentType, inputTypes);

  // Custom reference REST dry run: the request as it would be sent (before
  // authentication is attached — credentials are never part of a preview).
  if (previewRequest) {
    const isHttp = !["aws_s3", "sftp", "azure_blob"].includes(String(integrationConfig?.auth_config?._executor ?? ""));
    const previewPath = renderPathTemplate(rawPathTemplate, values, isHttp ? undefined : { encodePath: false });
    const base = typeof reqConfig?.base_url === "string" && /^https:\/\//i.test(reqConfig.base_url) ? reqConfig.base_url : integrationConfig?.base_url ?? "";
    let parsedBody: unknown = body || null;
    if (body) { try { parsedBody = JSON.parse(body); } catch { parsedBody = body; } }
    const previewUrl = redactUrl(joinUrl(String(base ?? ""), previewPath, queryParams));
    return {
      status: 200,
      data: { request: { method: effectiveMethod, url: previewUrl, headers: redactHeaders(headers), body: parsedBody } },
      log: { ...logContext, method: effectiveMethod, url: previewUrl },
    };
  }

  // AWS S3 executor — requires Signature V4 signing (it encodes the key itself)
  const isS3 = integrationConfig?.auth_config?._executor === "aws_s3";
  if (isS3) {
    const path = renderPathTemplate(rawPathTemplate, values, { encodePath: false });
    const { executeS3Reference } = await import("@/lib/aws-s3-executor");
    const s3 = await executeS3Reference(
      integrationConfig,
      effectiveMethod,
      path,
      body || undefined,
      queryParams,
      { ...inputHeaders, ...renderedRequestHeaders },
      timeout,
      integrationTenantId,
    );
    return {
      ...s3,
      ...(s3.status >= 400 ? { error_message: providerErrorMessage(s3.data) ?? `HTTP ${s3.status}` } : {}),
      log: { ...logContext, method: effectiveMethod, url: `s3://${integrationConfig?.auth_config?.bucket ?? ""}${path}` },
    };
  }

  // SFTP executor — file operations over SSH
  if (integrationConfig?.auth_config?._executor === "sftp") {
    const { executeSftpReference } = await import("@/lib/sftp-executor");
    const sftp = await executeSftpReference(integrationConfig, reqConfig, resolvedParams, {
      timeout,
      tenantId: integrationTenantId,
      supabase,
    });
    return {
      status: sftp.status,
      data: sftp.data,
      ...(sftp.status >= 400 ? { error_message: providerErrorMessage(sftp.data) ?? `SFTP error ${sftp.status}` } : {}),
      log: { ...logContext, method: effectiveMethod, url: `sftp://${integrationConfig?.auth_config?.host ?? ""}/${sftp.operation ?? ""}` },
    };
  }

  const path = renderPathTemplate(rawPathTemplate, values);

  // Azure Blob Storage — SAS token or Shared Key auth
  const isAzureBlob =
    integrationConfig?.auth_config?._executor === "azure_blob";
  if (isAzureBlob) {
    return await executeAzureBlobRequest({
      integrationConfig,
      method: effectiveMethod,
      path,
      body,
      queryParams,
      inputHeaders: { ...inputHeaders, ...renderedRequestHeaders },
      timeout,
      tenantId: integrationTenantId,
      logContext,
    });
  }

  // HTTP API execution
  // A template may target another host of the same provider (Box uploads,
  // Dropbox content endpoints): request_config.base_url overrides.
  const overrideBase = typeof reqConfig?.base_url === "string" && /^https:\/\//i.test(reqConfig.base_url) ? reqConfig.base_url : null;
  const baseUrl = overrideBase ?? integrationConfig?.base_url;
  // Object references that somehow missed the _executor guard — check by integration name
  if (integration?.name === "__objects__") {
    throw new Error(
      "Object reference missing _executor flag. Re-generate references from the Objects tab.",
    );
  }
  if (!baseUrl && baseUrl !== "")
    throw new Error(
      `Integration "${integration?.name}" has no base_url configured. If this is an Object reference, ensure request_config._executor is set to "object".`,
    );
  // Teams/Workflows webhooks: the whole URL is the (secret) credential.
  const webhookUrl = integrationConfig?.auth_config?.webhook_url;
  const effectiveBase = !baseUrl && typeof webhookUrl === "string" ? webhookUrl : baseUrl;

  const authQuery: Record<string, string> = {};
  const authCtx = {
    supabase,
    integrationId: integration?.id ?? (ref as any)?.integration_id ?? null,
    tenantId: integrationTenantId,
  };
  let applied = await applyAuthHeaders(integrationConfig, headers, authCtx, authQuery);

  let url = joinUrl(effectiveBase, path, { ...queryParams, ...authQuery });
  // Paging: a `next_link` input holding the provider's continuation URL
  // (Graph @odata.nextLink, Salesforce nextRecordsUrl, Twilio next_page_uri …)
  // replaces the request URL — only on the integration's own origin, so
  // credentials never follow a link elsewhere.
  const nextLink = referenceInputText(resolvedParams.next_link ?? "").trim();
  if (nextLink) url = continuationUrl(nextLink, effectiveBase, authQuery);

  // Request body: form attachments, file URLs and base64 become bytes.
  const prepared = await prepareRequestBody({
    method: effectiveMethod,
    body,
    headers,
    tenantId: integrationTenantId,
    timeout,
  });

  // SAP Gateway (and other CSRF-protected OData services): fetch a token
  // with a GET before any write and send it back with the session cookies.
  const wantsCsrf =
    integrationConfig?.auth_config?._csrf === "fetch" ||
    String(findHeader(integrationConfig?.headers ?? {}, "x-csrf-token") ?? "").toLowerCase() === "fetch";
  if (wantsCsrf && !["GET", "HEAD", "OPTIONS"].includes(effectiveMethod)) {
    await attachCsrfToken(effectiveBase, headers, timeout);
  }

  // Connection transport hook (auth_config._transport: NTLM, Kerberos, an
  // extension's transport …): replaces the single fetch call; the egress
  // guard, retries and redirects stay with connectorFetch.
  const transportFetch = await resolveTransportFetch({ tenantId: integrationTenantId ?? null, integrationConfig: integrationConfig ?? {} });
  const send = async () => {
    try {
      return await connectorFetch(url, { method: effectiveMethod, headers, body: prepared as BodyInit | undefined }, { timeoutMs: timeout, fetchImpl: transportFetch });
    } catch (error: any) {
      if (error?.name === "EgressBlockedError") throw error;
      // Transport failure (DNS, refused, timeout): fail the step with the target named.
      throw new Error(`API call to ${redactUrl(url)} failed: ${error?.message ?? error}`);
    }
  };
  let resp = await send();
  if (resp.status === 401 && applied.mintedTokenKey) {
    // A cached token the provider no longer accepts (revoked, rotated
    // secret): mint a fresh one once.
    await resp.body?.cancel().catch(() => {});
    invalidateMintedToken(applied.mintedTokenKey);
    applied = await applyAuthHeaders(integrationConfig, headers, authCtx, authQuery);
    resp = await send();
  }

  const data = await parseResponseBody(resp, supabase, integrationTenantId, url);
  return {
    status: resp.status,
    data,
    ...errorMessageFor(resp.status, data),
    log: {
      ...logContext,
      method: effectiveMethod,
      url: redactUrl(url),
      requestHeaders: headers,
      responseHeaders: Object.fromEntries(resp.headers.entries()),
    },
  };
}

function errorMessageFor(status: number, data: any): { error_message?: string } {
  if (status >= 400) return { error_message: providerErrorMessage(data) ?? `HTTP ${status}` };
  // Slack-style APIs answer 200 with { ok: false, error }.
  if (data && typeof data === "object" && data.ok === false && typeof data.error === "string") {
    return { error_message: data.error };
  }
  return {};
}

function continuationUrl(nextLink: string, base: string, authQuery: Record<string, string>): string {
  let target: URL;
  let origin: URL;
  try {
    origin = new URL(base);
    target = new URL(nextLink, origin);
  } catch {
    throw new Error("next_link is not a valid URL");
  }
  if (target.origin !== origin.origin) {
    throw new Error("next_link must point at the integration's own host");
  }
  for (const [k, v] of Object.entries(authQuery)) if (!target.searchParams.has(k)) target.searchParams.set(k, v);
  return target.toString();
}

function joinUrl(base: string, path: string, query: Record<string, string>): string {
  let url = base && path && base.endsWith("/") && path.startsWith("/") ? base + path.slice(1) : base + path;
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  return url;
}

/**
 * Connector configuration values usable as template variables. Connector
 * integrations carry them as config.template_vars; integrations created
 * before that are read from their tenant connector (migrate on read).
 */
async function loadTemplateVars(
  supabase: SupabaseClient,
  integration: any,
  integrationConfig: any,
  tenantId: string,
): Promise<Record<string, any>> {
  const stored = integrationConfig?.template_vars;
  if (stored && typeof stored === "object" && !Array.isArray(stored)) return { ...stored };
  if (!integration?.id || !integration?.type) return {};
  const { getConnectorDefinition } = await import("@/lib/connectors/registry");
  const definition = getConnectorDefinition(String(integration.type));
  if (!definition) return {};
  try {
    const { data } = await (supabase as any)
      .from("tenant_connectors")
      .select("config, credentials")
      .eq("integration_id", integration.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!data) return {};
    const { connectorTemplateVars } = await import("@/lib/connectors/template-vars");
    return connectorTemplateVars(definition, decryptSensitiveFields(data.config ?? {}), decryptSensitiveFields(data.credentials ?? {}));
  } catch {
    return {};
  }
}

/** Resolve upload bodies: form attachments → bytes, file URLs → downloaded bytes, base64 → bytes. */
async function prepareRequestBody(opts: {
  method: string;
  body: string;
  headers: Record<string, string>;
  tenantId: string;
  timeout: number;
}): Promise<string | Uint8Array | FormData | undefined> {
  const { method, body, headers, tenantId, timeout } = opts;
  if (method === "GET" || method === "HEAD" || !body) return undefined;
  const contentTypeKey = Object.keys(headers).find((k) => k.toLowerCase() === "content-type");
  // Multipart uploads (Box, Google Drive) whose JSON template names a form
  // attachment: the real multipart body with the file's bytes.
  if (contentTypeKey && /^multipart\/(form-data|related)/i.test(headers[contentTypeKey])) {
    const multipart = await (await import("@/lib/services/form-files")).buildFormFileMultipart(body, headers[contentTypeKey], tenantId);
    if (multipart) {
      if (multipart.contentType) headers[contentTypeKey] = multipart.contentType;
      else delete headers[contentTypeKey];
      return multipart.body;
    }
  }
  if (method !== "PUT" && method !== "POST" && method !== "PATCH") return body;
  const file = await resolveFileBody(body, tenantId, timeout);
  if (file) {
    if (file.contentType) setHeaderCI(headers, "Content-Type", file.contentType);
    return file.bytes;
  }
  return body;
}

/**
 * A body that names a file: a form attachment of this tenant, an http(s)
 * URL (downloaded through the egress guard, size-capped) or base64 text.
 */
async function resolveFileBody(
  bodyStr: string,
  tenantId: string,
  timeout: number,
): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
  const { readFormFileBody } = await import("@/lib/services/form-files");
  const formFile = await readFormFileBody(bodyStr, tenantId);
  if (formFile) return { bytes: formFile.bytes, contentType: formFile.mime_type };
  const trimmed = bodyStr.trim();
  if (/^https?:\/\/\S+$/.test(trimmed)) {
    try {
      const fileResp = await connectorFetch(trimmed, {}, { timeoutMs: timeout });
      if (fileResp.ok) {
        const bytes = await readCappedBody(fileResp, MAX_BINARY_RESPONSE_BYTES);
        const ct = fileResp.headers.get("content-type");
        return { bytes: new Uint8Array(bytes), contentType: ct ? ct.split(";")[0].trim() : undefined };
      }
      await fileResp.body?.cancel().catch(() => {});
    } catch (error: any) {
      if (error?.name === "EgressBlockedError" || error?.name === "ResponseTooLargeError") throw error;
      /* not downloadable — send as-is */
    }
    return null;
  }
  if (
    /^[A-Za-z0-9+/]+=*$/.test(bodyStr.slice(0, 200).replace(/\s/g, "")) &&
    bodyStr.length > 100
  ) {
    // Looks like base64 — decode to binary
    const buf = Buffer.from(bodyStr, "base64");
    if (buf.byteLength > 0 && buf.byteLength < bodyStr.length) return { bytes: new Uint8Array(buf) };
  }
  return null;
}

async function attachCsrfToken(baseUrl: string, headers: Record<string, string>, timeout: number) {
  const probeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (/^(authorization|sap-client|accept-language|cookie)$/i.test(k)) probeHeaders[k] = v;
  }
  probeHeaders["x-csrf-token"] = "Fetch";
  const res = await connectorFetch(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`, { method: "GET", headers: probeHeaders }, { timeoutMs: Math.min(timeout, 15_000) });
  await res.body?.cancel().catch(() => {});
  const token = res.headers.get("x-csrf-token");
  if (!token || token.toLowerCase() === "required") {
    throw new Error(`Could not fetch a CSRF token from the service (HTTP ${res.status})`);
  }
  setHeaderCI(headers, "x-csrf-token", token);
  const setCookies = typeof (res.headers as any).getSetCookie === "function" ? (res.headers as any).getSetCookie() as string[] : [];
  const cookie = setCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (cookie) setHeaderCI(headers, "Cookie", cookie);
}

const BINARY_TYPE_RE = /^(application\/(octet-stream|pdf|zip|gzip|x-zip|vnd\.|msword|x-tar|x-7z)|image\/|audio\/|video\/|font\/)/i;

/** Response → data: JSON parsed, text kept (capped), binary stored as a workflow file reference. */
async function parseResponseBody(resp: Response, supabase: SupabaseClient, tenantId: string, url: string): Promise<any> {
  const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
  if (resp.status === 204 || resp.status === 205 || resp.headers.get("content-length") === "0") {
    await resp.body?.cancel().catch(() => {});
    return resp.ok ? { success: true } : null;
  }
  if (BINARY_TYPE_RE.test(contentType) && !contentType.includes("json") && !contentType.includes("xml")) {
    const bytes = await readCappedBody(resp, MAX_BINARY_RESPONSE_BYTES);
    if (!resp.ok) return { _raw: bytes.toString("utf8").slice(0, 5000) };
    return await storeBinaryResponse(bytes, resp, supabase, tenantId, url, contentType);
  }
  const text = (await readCappedBody(resp, MAX_STRUCTURED_RESPONSE_BYTES)).toString("utf8");
  if (!text) return resp.ok ? { success: true } : null;
  try {
    return JSON.parse(text);
  } catch {
    // Text/CSV/XML payloads up to 1 MB are returned whole; error pages are clipped.
    return { _raw: resp.ok ? text.slice(0, 1024 * 1024) : text.slice(0, 5000) };
  }
}

async function storeBinaryResponse(bytes: Buffer, resp: Response, supabase: SupabaseClient, tenantId: string, url: string, contentType: string) {
  const disposition = resp.headers.get("content-disposition");
  let fileName = "download";
  if (disposition) {
    const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
    if (match) {
      try { fileName = decodeURIComponent(match[1]); } catch { fileName = match[1]; }
    }
  }
  if (fileName === "download") {
    try {
      const last = new URL(url).pathname.split("/").pop();
      if (last && last.includes(".")) fileName = decodeURIComponent(last);
    } catch { /* keep default */ }
  }
  fileName = fileName.replace(/[\\/\r\n]/g, "_").slice(0, 200);
  const ext = fileName.includes(".") ? (fileName.split(".").pop() ?? "bin").replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || "bin" : "bin";
  try {
    const { storeWorkflowFile } = await import("@/lib/storage/files");
    const stored = await storeWorkflowFile(supabase as any, tenantId, new Uint8Array(bytes), ext, contentType.split(";")[0]);
    return {
      _file: true,
      name: fileName,
      url: stored.url,
      path: stored.path,
      size: bytes.byteLength,
      content_type: contentType,
      ...(stored.ref ? { ref: stored.ref } : {}),
    };
  } catch (error: any) {
    // No storage available (tests, misconfigured storage): small files inline.
    if (bytes.byteLength <= 1024 * 1024) {
      return { _binary: true, name: fileName, size: bytes.byteLength, content_type: contentType, base64: bytes.toString("base64") };
    }
    throw new Error(`File storage failed: ${error?.message ?? error}`);
  }
}

const AZURE_QUERY_KEYS = new Set([
  "restype", "comp", "prefix", "maxresults", "marker", "include", "delimiter", "blockid", "blocklisttype", "timeout",
]);

async function executeAzureBlobRequest(opts: {
  integrationConfig: any;
  method: string;
  path: string;
  body: string;
  queryParams: Record<string, string>;
  inputHeaders: Record<string, string>;
  timeout: number;
  tenantId: string;
  logContext: { integrationId: string | null; tenantId: string | null; method: string | null };
}): Promise<ExecuteReferenceResult> {
  const { integrationConfig, method, body, timeout, tenantId, logContext } = opts;
  const queryParams = { ...opts.queryParams };
  let path = opts.path;
  const { createHmac } = await import("crypto");
  const authCfg = integrationConfig.auth_config ?? {};
  const container = queryParams.container || authCfg.container || "";
  delete queryParams.container;
  // Legacy templates: '/{{container}}/…' rendered with an empty container → '//…'.
  if (path === "" || path.startsWith("//")) {
    if (!container) throw new Error("Azure Blob: no container given and the connector has no default container");
    path = `/${encodeURIComponent(container)}${path.replace(/^\/+/, "/")}`.replace(/\/$/, "");
  }
  const legacyContentType = queryParams.content_type;
  for (const k of Object.keys(queryParams)) if (!AZURE_QUERY_KEYS.has(k)) delete queryParams[k];
  const accountName = authCfg.account_name || "";
  const baseUrl = integrationConfig.base_url || `https://${accountName}.blob.core.windows.net`;
  const qs = Object.entries(queryParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  let url = baseUrl + path + (qs ? (path.includes("?") ? "&" : "?") + qs : "");

  const headers: Record<string, string> = {
    "x-ms-version": "2023-11-03",
    "x-ms-date": new Date().toUTCString(),
    ...opts.inputHeaders,
  };
  if (legacyContentType && !findHeader(headers, "content-type")) headers["Content-Type"] = stripHeaderBreaks(legacyContentType);
  if (method === "PUT" && !Object.keys(headers).some((k) => k.toLowerCase() === "x-ms-blob-type") && !/[?&]comp=/.test(url)) {
    headers["x-ms-blob-type"] = "BlockBlob";
  }

  let fetchBody: string | Uint8Array | undefined = method !== "GET" && method !== "HEAD" && body ? body : undefined;
  if (fetchBody && (method === "PUT" || method === "POST")) {
    const file = await resolveFileBody(String(fetchBody), tenantId, timeout);
    if (file) {
      fetchBody = file.bytes;
      if (file.contentType) setHeaderCI(headers, "Content-Type", file.contentType);
    }
  }
  const contentLength = fetchBody ? (typeof fetchBody === "string" ? Buffer.byteLength(fetchBody) : fetchBody.byteLength) : 0;
  if ((method === "PUT" || method === "POST") && !findHeader(headers, "content-type")) {
    headers["Content-Type"] = "application/octet-stream";
  }

  // Auth: SAS token (appended to URL) or Shared Key (HMAC header)
  if (authCfg.sas_token) {
    const sasToken = String(authCfg.sas_token).replace(/^\?/, "");
    url += (url.includes("?") ? "&" : "?") + sasToken;
  } else if (authCfg.account_key) {
    const urlObj = new URL(url);
    const canonicalResource = `/${accountName}${urlObj.pathname}`;
    const msHeaders = Object.keys(headers)
      .filter((k) => k.toLowerCase().startsWith("x-ms-"))
      .map((k) => [k.toLowerCase(), String(headers[k]).replace(/\s+/g, " ").trim()] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}:${v}`)
      .join("\n");
    // Canonicalized resource: query names lower-cased and sorted, values decoded, comma-joined.
    const grouped = new Map<string, string[]>();
    for (const [k, v] of urlObj.searchParams.entries()) {
      const key = k.toLowerCase();
      grouped.set(key, [...(grouped.get(key) ?? []), v]);
    }
    const canonicalQuery = [...grouped.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, vs]) => `\n${k}:${vs.sort().join(",")}`)
      .join("");
    const stringToSign = [
      method,
      findHeader(headers, "content-encoding") ?? "",
      findHeader(headers, "content-language") ?? "",
      contentLength > 0 ? String(contentLength) : "",
      findHeader(headers, "content-md5") ?? "",
      findHeader(headers, "content-type") ?? "",
      "",
      findHeader(headers, "if-modified-since") ?? "",
      findHeader(headers, "if-match") ?? "",
      findHeader(headers, "if-none-match") ?? "",
      findHeader(headers, "if-unmodified-since") ?? "",
      findHeader(headers, "range") ?? "",
      msHeaders,
      canonicalResource + canonicalQuery,
    ].join("\n");
    const key = Buffer.from(authCfg.account_key, "base64");
    const sig = createHmac("sha256", key).update(stringToSign, "utf8").digest("base64");
    headers["Authorization"] = `SharedKey ${accountName}:${sig}`;
  }

  const resp = await connectorFetch(url, { method, headers, body: fetchBody as BodyInit | undefined }, { timeoutMs: timeout });
  const respContentType = resp.headers.get("content-type") ?? "";
  let data: any;
  if (respContentType.includes("json")) {
    const text = (await readCappedBody(resp, MAX_STRUCTURED_RESPONSE_BYTES)).toString("utf8");
    try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 5000) }; }
  } else if (respContentType.includes("xml") || resp.status >= 400) {
    const text = (await readCappedBody(resp, MAX_STRUCTURED_RESPONSE_BYTES)).toString("utf8");
    data = { _raw: text };
    const codeMatch = text.match(/<Code>([^<]+)<\/Code>/);
    const msgMatch = text.match(/<Message>([^<]+)<\/Message>/);
    if (codeMatch) data = { error: true, code: codeMatch[1], message: msgMatch?.[1] ?? "Azure Blob request failed" };
  } else if (method === "GET") {
    // Blob download: store the bytes as a file (binary-safe).
    const bytes = await readCappedBody(resp, MAX_BINARY_RESPONSE_BYTES);
    const { createServiceClient } = await import("@/lib/cron-auth");
    data = await storeBinaryResponse(bytes, resp, createServiceClient() as any, tenantId, url.split("?")[0], respContentType || "application/octet-stream");
  } else {
    const text = (await readCappedBody(resp, MAX_STRUCTURED_RESPONSE_BYTES)).toString("utf8");
    data = text ? { _raw: text.slice(0, 5000) } : { success: true };
  }
  if (resp.ok && method === "PUT") {
    data = { success: true, etag: resp.headers.get("etag")?.replace(/"/g, ""), url: url.split("?")[0] };
  }
  if (resp.ok && method === "DELETE") data = { success: true };
  // Normalize Azure XML list responses
  if (resp.ok && data?._raw && typeof data._raw === "string") {
    const raw = data._raw;
    const tag = (chunk: string, name: string) => chunk.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`))?.[1];
    const nextMarker = tag(raw, "NextMarker") || null;
    if (raw.includes("<Blobs>")) {
      const blobs: any[] = [];
      const blobRe = /<Blob>[\s\S]*?<\/Blob>/g;
      let m;
      while ((m = blobRe.exec(raw)) !== null) {
        const chunk = m[0];
        blobs.push({
          name: xmlDecode(tag(chunk, "Name") ?? ""),
          size: Number(tag(chunk, "Content-Length") ?? 0),
          last_modified: tag(chunk, "Last-Modified") ?? "",
          content_type: tag(chunk, "Content-Type") ?? "",
          etag: (tag(chunk, "Etag") ?? "").replace(/"/g, ""),
        });
      }
      const prefixes = [...raw.matchAll(/<BlobPrefix>\s*<Name(?:\s[^>]*)?>([^<]*)<\/Name>/g)].map((p) => xmlDecode(p[1]));
      data = { blobs, count: blobs.length, next_marker: nextMarker, ...(prefixes.length ? { prefixes } : {}) };
    } else if (raw.includes("<Containers>")) {
      const containers: any[] = [];
      const contRe = /<Container>[\s\S]*?<\/Container>/g;
      let m;
      while ((m = contRe.exec(raw)) !== null) {
        const chunk = m[0];
        containers.push({
          name: xmlDecode(tag(chunk, "Name") ?? ""),
          last_modified: tag(chunk, "Last-Modified") ?? "",
          public_access: tag(chunk, "PublicAccess") ?? "none",
        });
      }
      data = { containers, count: containers.length, next_marker: nextMarker };
    }
  }
  return {
    status: resp.status,
    data,
    ...errorMessageFor(resp.status, data),
    log: {
      ...logContext,
      method,
      url: redactUrl(url),
      requestHeaders: headers,
      responseHeaders: Object.fromEntries(resp.headers.entries()),
    },
  };
}

function xmlDecode(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

