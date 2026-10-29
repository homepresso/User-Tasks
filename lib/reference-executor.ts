/**
 * Shared reference execution logic.
 * Used by both the workflow engine (call_reference node) and the test-reference API endpoint.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallerContext } from "./trace";
import { assertSafeEgressUrl } from "./egress-guard";
import { decryptSensitiveFields } from "./secret-fields";
import { applyAuthHeaders } from "./integrations/attach-auth";
import { truncateForStorage } from "./truncate";
import { referenceInputText, substituteInputPlaceholder } from "./reference-input-utils";

interface ExecuteReferenceOptions {
  supabase: SupabaseClient;
  referenceId: string;
  inputValues: Record<string, string>; // resolved input values (name → value)
  timeout?: number;
  expectedTenantId?: string;
  /**
   * Caller context — propagates through to integration_call_logs so we can
   * link each outbound HTTP call back to the workflow run / form submission /
   * agent run that triggered it. Optional: if omitted the log still records
   * the call but without a caller id.
   */
  caller?: CallerContext;
}

interface ExecuteReferenceResult {
  status: number;
  data: any;
  headers?: Record<string, string>;
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
  /^(authorization|cookie|x-api-key|proxy-authorization|x-auth-token|x-csrf-token|api-key|x-access-token|set-cookie)$/i;
/** Query params that always get redacted from URL logs */
const SENSITIVE_QUERY_RE =
  /(^|[&?])(access_token|api_key|apikey|auth|token|key|password|secret|signature|sas_token)=[^&]*/gi;

/** Returns a shallow-copied headers object with sensitive values replaced by "***" */
function redactHeaders(
  headers: Record<string, any> | undefined,
): Record<string, any> {
  if (!headers || typeof headers !== "object") return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_RE.test(k) ? "***" : v;
  }
  return out;
}

/** Strip sensitive query params from a URL for safe logging */
function redactUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return url.replace(
      SENSITIVE_QUERY_RE,
      (_, prefix, key) => `${prefix}${key}=***`,
    );
  } catch {
    return url;
  }
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
        reference_id: referenceId,
        caller_type: caller?.callerType ?? null,
        caller_id: caller?.callerId ?? null,
        caller_node_id: caller?.callerNodeId ?? null,
        trace_id: caller?.traceId ?? null,
        method: logMethod,
        url: logUrl,
        request_headers: truncate(
          logRequestHeaders ? redactHeaders(logRequestHeaders) : null,
        ),
        request_body: truncate(inputValues),
        response_status: result.status,
        response_headers: truncate(
          logResponseHeaders ? redactHeaders(logResponseHeaders) : null,
        ),
        response_body: truncate(result.data),
        duration_ms: Date.now() - startedAt,
        error: null,
        started_at: new Date(startedAt).toISOString(),
        completed_at: new Date().toISOString(),
      });
    }

    return result;
  } catch (err: any) {
    // Best-effort identification of the reference for failure logging
    try {
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
      /* swallow */
    }

    if (tenantId) {
      void writeCallLog(supabase, {
        tenant_id: tenantId,
        integration_id: integrationId,
        reference_id: referenceId,
        caller_type: caller?.callerType ?? null,
        caller_id: caller?.callerId ?? null,
        caller_node_id: caller?.callerNodeId ?? null,
        trace_id: caller?.traceId ?? null,
        method: logMethod,
        url: logUrl,
        request_headers: null,
        request_body: truncate(inputValues),
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

/** Original implementation — unchanged, just renamed so the outer wrapper can add logging. */
async function executeReferenceInner({
  supabase,
  referenceId,
  inputValues,
  timeout = 30000,
  expectedTenantId,
}: ExecuteReferenceOptions): Promise<ExecuteReferenceResult> {
  // Load reference + integration
  const { data: ref } = await supabase
    .from("integration_references")
    .select("*, integration:integrations(*)")
    .eq("id", referenceId)
    .single();

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
  if (expectedTenantId && integrationTenantId !== expectedTenantId) {
    throw new Error("Reference not found");
  }
  // Central read boundary: credential fields inside integration config are
  // encrypted at rest — decrypt once here so every executor path (HTTP auth,
  // db-connector, S3, Azure Blob, Google service accounts) sees plaintext.
  const integrationConfig = decryptSensitiveFields(integration?.config) as any;
  const reqConfig = ref.request_config as any;
  const inputs = (ref.inputs as any[]) ?? [];
  const method = (reqConfig?.method ?? "GET").toUpperCase();
  const logContext = {
    integrationId: integration?.id ?? (ref as any)?.integration_id ?? null,
    tenantId: integrationTenantId,
    method,
  };

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

  // Resolve inputs into the path, body, query, and headers
  let path = reqConfig?.path_template ?? "";
  let body = reqConfig?.body_template ?? "";
  const queryParams: Record<string, string> = {};
  const inputHeaders: Record<string, string> = {};
  const resolvedParams: Record<string, any> = {};

  for (const input of inputs) {
    let value: any = inputValues[input.name] ?? input.default_value ?? "";

    // Coerce numeric types
    if (input.type === "number" || input.type === "integer") {
      value = value != null && value !== "" ? Number(value) : 0;
      if (isNaN(value)) value = 0;
    }

    // Sensible defaults for common params
    if (value === undefined || value === null || value === "") {
      if (input.name === "offset" || input.name === "skip") value = 0;
      else if (
        input.name === "limit" ||
        input.name === "top" ||
        input.name === "page_size" ||
        input.name === "max_results"
      )
        value = 100;
    }

    // Validate required inputs
    if (
      input.required &&
      (value === undefined || value === null || value === "")
    ) {
      throw new Error(
        `Required input "${input.name}" is missing. Provide a value or set a default.`,
      );
    }

    resolvedParams[input.name] = value;
    // Objects / arrays: JSON (real JSON inside a body template), not "[object Object]".
    const strValue = referenceInputText(value);

    const location = input.location ?? "query";
    switch (location) {
      case "header":
        if (strValue) inputHeaders[input.name] = strValue;
        break;
      case "query":
        if (strValue) queryParams[input.name] = strValue;
        break;
      case "path":
        path = path.replace(`{{${input.name}}}`, strValue);
        break;
      case "body":
        break;
      default:
        if (strValue) queryParams[input.name] = strValue;
        break;
    }
    // Replace {{name}} in path and body regardless of location
    path = path.replace(`{{${input.name}}}`, strValue);
    body = substituteInputPlaceholder(body, input.name, value, "json");
  }

  // Resolve {{placeholders}} in request_config headers
  const reqHeaders = reqConfig?.headers ?? {};
  for (const [hk, hv] of Object.entries(reqHeaders)) {
    if (typeof hv === "string" && hv.includes("{{")) {
      let resolved = hv;
      for (const [pk, pv] of Object.entries(resolvedParams)) {
        resolved = substituteInputPlaceholder(resolved, pk, pv, "text");
      }
      inputHeaders[hk] = resolved;
    } else if (typeof hv === "string") {
      inputHeaders[hk] = hv;
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

  if (isDatabase) {
    return await executeDatabaseReference(
      integrationConfig,
      path,
      body,
      method,
      inputs,
      resolvedParams,
      logContext,
    );
  }

  // AWS S3 executor — requires Signature V4 signing
  const isS3 = integrationConfig?.auth_config?._executor === "aws_s3";
  if (isS3) {
    const { executeS3Reference } = await import("@/lib/aws-s3-executor");
    return await executeS3Reference(
      integrationConfig,
      method,
      path,
      body || undefined,
      queryParams,
      inputHeaders,
      timeout,
      integrationTenantId,
    );
  }

  // Azure Blob Storage — SAS token or Shared Key auth
  const isAzureBlob =
    integrationConfig?.auth_config?._executor === "azure_blob";
  if (isAzureBlob) {
    const { createHmac } = await import("crypto");
    const authCfg = integrationConfig.auth_config ?? {};
    const container = queryParams.container || authCfg.container || "";
    delete queryParams.container;
    // Strip non-Azure query params
    for (const k of Object.keys(queryParams)) {
      if (
        ![
          "restype",
          "comp",
          "prefix",
          "maxresults",
          "marker",
          "include",
          "delimiter",
          "blockid",
          "blocklisttype",
        ].includes(k)
      ) {
        delete queryParams[k];
      }
    }
    const accountName = authCfg.account_name || "";
    const baseUrl =
      integrationConfig.base_url ??
      `https://${accountName}.blob.core.windows.net`;
    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    let url =
      baseUrl + path + (qs ? (path.includes("?") ? "&" : "?") + qs : "");

    const msVersion = "2023-11-03";
    const msDate = new Date().toUTCString();
    const headers: Record<string, string> = {
      "x-ms-version": msVersion,
      "x-ms-date": msDate,
      ...inputHeaders,
    };
    if (method === "PUT") {
      headers["x-ms-blob-type"] = headers["x-ms-blob-type"] || "BlockBlob";
    }

    // Resolve file content for uploads
    let fetchBody: string | Buffer | undefined =
      method !== "GET" && method !== "HEAD" && body ? body : undefined;
    if (fetchBody && (method === "PUT" || method === "POST")) {
      const bodyStr = String(fetchBody);
      // A form attachment (file input): its bytes, for this reference's tenant only.
      const { readFormFileBody } = await import("@/lib/services/form-files");
      const formFile = await readFormFileBody(bodyStr, integrationTenantId);
      if (formFile) {
        fetchBody = Buffer.from(formFile.bytes);
        headers["Content-Type"] = formFile.mime_type;
      } else if (bodyStr.startsWith("http://") || bodyStr.startsWith("https://")) {
        try {
          await assertSafeEgressUrl(bodyStr);
          const fileResp = await fetch(bodyStr, {
            signal: AbortSignal.timeout(timeout),
          });
          if (fileResp.ok) {
            fetchBody = Buffer.from(await fileResp.arrayBuffer());
            const ct = fileResp.headers.get("content-type");
            if (ct) headers["Content-Type"] = ct.split(";")[0].trim();
          }
        } catch {
          /* blocked or not downloadable — send as-is */
        }
      } else if (
        /^[A-Za-z0-9+/]+=*$/.test(bodyStr.slice(0, 200).replace(/\s/g, "")) &&
        bodyStr.length > 100
      ) {
        const buf = Buffer.from(bodyStr, "base64");
        if (buf.byteLength > 0 && buf.byteLength < bodyStr.length)
          fetchBody = buf;
      }
    }
    const contentLength = fetchBody
      ? Buffer.isBuffer(fetchBody)
        ? fetchBody.byteLength
        : fetchBody.length
      : 0;
    headers["Content-Length"] = String(contentLength);
    // Ensure Content-Type is set for PUT/POST so the signature matches
    if ((method === "PUT" || method === "POST") && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/octet-stream";
    }

    // Auth: SAS token (appended to URL) or Shared Key (HMAC header)
    if (authCfg.sas_token) {
      const sasToken = authCfg.sas_token.startsWith("?")
        ? authCfg.sas_token.slice(1)
        : authCfg.sas_token;
      url += (url.includes("?") ? "&" : "?") + sasToken;
    } else if (authCfg.account_key) {
      // Azure Shared Key auth — sign the request
      const urlObj = new URL(url);
      const canonicalResource = `/${accountName}${urlObj.pathname}`;
      // Build canonicalized headers (x-ms-* sorted)
      const msHeaders = Object.keys(headers)
        .filter((k) => k.toLowerCase().startsWith("x-ms-"))
        .sort()
        .map((k) => `${k.toLowerCase()}:${headers[k].trim()}`)
        .join("\n");
      // Build canonicalized query params for resource string
      const canonicalQuery = [...urlObj.searchParams.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `\n${k.toLowerCase()}:${v}`)
        .join("");
      const contentType = headers["Content-Type"] ?? "";
      const stringToSign = [
        method, // HTTP verb
        "", // Content-Encoding
        "", // Content-Language
        contentLength > 0 ? String(contentLength) : "", // Content-Length
        "", // Content-MD5
        contentType, // Content-Type
        "", // Date
        "", // If-Modified-Since
        "", // If-Match
        "", // If-None-Match
        "", // If-Unmodified-Since
        "", // Range
        msHeaders, // Canonicalized headers
        canonicalResource + canonicalQuery, // Canonicalized resource
      ].join("\n");
      const key = Buffer.from(authCfg.account_key, "base64");
      const sig = createHmac("sha256", key)
        .update(stringToSign, "utf8")
        .digest("base64");
      headers["Authorization"] = `SharedKey ${accountName}:${sig}`;
    }

    await assertSafeEgressUrl(url);
    const resp = await fetch(url, {
      method,
      headers,
      body: fetchBody
        ? Buffer.isBuffer(fetchBody)
          ? new Uint8Array(fetchBody)
          : fetchBody
        : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    const respContentType = resp.headers.get("content-type") ?? "";
    let data: any;
    if (respContentType.includes("json")) {
      try {
        data = await resp.json();
      } catch {
        data = await resp.text();
      }
    } else if (respContentType.includes("xml") || resp.status >= 400) {
      const text = await resp.text();
      data = text.startsWith("<")
        ? { _raw: text }
        : { _raw: text.slice(0, 5000) };
      const codeMatch = text.match(/<Code>([^<]+)<\/Code>/);
      const msgMatch = text.match(/<Message>([^<]+)<\/Message>/);
      if (codeMatch)
        data = {
          error: true,
          code: codeMatch[1],
          message: msgMatch?.[1] ?? "Azure Blob request failed",
        };
    } else {
      if (
        method === "GET" &&
        !path.includes("comp=list") &&
        !path.includes("restype=container")
      ) {
        const text = await resp.text();
        data = {
          body: text.slice(0, 100000),
          content_type: resp.headers.get("content-type") ?? "",
          content_length: Number(
            resp.headers.get("content-length") ?? text.length,
          ),
        };
      } else {
        const text = await resp.text();
        data = text.startsWith("<")
          ? { _raw: text }
          : text
            ? { _raw: text.slice(0, 5000) }
            : { success: true };
      }
    }
    if (resp.ok && method === "PUT") {
      data = {
        success: true,
        etag: resp.headers.get("etag")?.replace(/"/g, ""),
        url: url.split("?")[0],
      };
    }
    if (resp.ok && method === "DELETE") {
      data = { success: true };
    }
    // Normalize Azure XML list responses
    if (resp.ok && data?._raw && typeof data._raw === "string") {
      const raw = data._raw;
      if (raw.includes("<Blobs>")) {
        // List blobs response
        const blobs: any[] = [];
        const blobRe = /<Blob><Name>([^<]*)<\/Name>[\s\S]*?<\/Blob>/g;
        let m;
        while ((m = blobRe.exec(raw)) !== null) {
          const chunk = m[0];
          const size = chunk.match(/<Content-Length>(\d+)<\/Content-Length>/);
          const lastMod = chunk.match(
            /<Last-Modified>([^<]+)<\/Last-Modified>/,
          );
          const ct = chunk.match(/<Content-Type>([^<]+)<\/Content-Type>/);
          const etag = chunk.match(/<Etag>([^<]+)<\/Etag>/);
          blobs.push({
            name: m[1],
            size: size ? Number(size[1]) : 0,
            last_modified: lastMod?.[1] ?? "",
            content_type: ct?.[1] ?? "",
            etag: etag?.[1]?.replace(/"/g, "") ?? "",
          });
        }
        data = { blobs, count: blobs.length };
      } else if (raw.includes("<Containers>")) {
        // List containers response
        const containers: any[] = [];
        const contRe = /<Container><Name>([^<]*)<\/Name>[\s\S]*?<\/Container>/g;
        let m;
        while ((m = contRe.exec(raw)) !== null) {
          const chunk = m[0];
          const lastMod = chunk.match(
            /<Last-Modified>([^<]+)<\/Last-Modified>/,
          );
          const access = chunk.match(/<PublicAccess>([^<]+)<\/PublicAccess>/);
          containers.push({
            name: m[1],
            last_modified: lastMod?.[1] ?? "",
            public_access: access?.[1] ?? "none",
          });
        }
        data = { containers, count: containers.length };
      }
    }
    return {
      status: resp.status,
      data,
      log: {
        ...logContext,
        url: redactUrl(url),
        requestHeaders: headers,
        responseHeaders: Object.fromEntries(resp.headers.entries()),
      },
    };
  }

  // HTTP API execution
  const baseUrl = integrationConfig?.base_url;
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

  const queryString = Object.entries(queryParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const url =
    baseUrl +
    path +
    (queryString ? (path.includes("?") ? "&" : "?") + queryString : "");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...inputHeaders,
    ...(integrationConfig.headers ?? {}),
    ...(reqConfig?.headers ?? {}),
  };
  // Clean non-HTTP headers
  delete headers._executor;
  delete headers.db_type;
  delete headers.host;
  delete headers.port;
  delete headers.database;
  delete headers.ssl;

  await applyAuthHeaders(integrationConfig, headers, {
    supabase,
    integrationId: integration?.id ?? (ref as any)?.integration_id ?? null,
  });

  // Resolve file content for uploads — download URLs or decode base64 to binary
  let fetchBody: string | Buffer | FormData | Uint8Array | undefined =
    method !== "GET" && method !== "HEAD" && body ? body : undefined;
  // Multipart uploads (Box, Google Drive) whose JSON template names a form
  // attachment: the real multipart body with the file's bytes.
  const contentTypeKey = Object.keys(headers).find((k) => k.toLowerCase() === "content-type");
  const multipart = fetchBody && contentTypeKey && /^multipart\/(form-data|related)/i.test(headers[contentTypeKey])
    ? await (await import("@/lib/services/form-files")).buildFormFileMultipart(String(fetchBody), headers[contentTypeKey], integrationTenantId)
    : null;
  if (multipart) {
    fetchBody = multipart.body;
    if (multipart.contentType) headers[contentTypeKey!] = multipart.contentType;
    else delete headers[contentTypeKey!];
  } else if (fetchBody && (method === "PUT" || method === "POST")) {
    const bodyStr = String(fetchBody);
    // A form attachment (file input): its bytes, for this reference's tenant only.
    const { readFormFileBody } = await import("@/lib/services/form-files");
    const formFile = await readFormFileBody(bodyStr, integrationTenantId);
    if (formFile) {
      fetchBody = Buffer.from(formFile.bytes);
      headers["Content-Type"] = formFile.mime_type;
    } else if (bodyStr.startsWith("http://") || bodyStr.startsWith("https://")) {
      try {
        await assertSafeEgressUrl(bodyStr);
        const fileResp = await fetch(bodyStr, {
          signal: AbortSignal.timeout(timeout),
        });
        if (fileResp.ok) {
          fetchBody = Buffer.from(await fileResp.arrayBuffer());
          const fileContentType = fileResp.headers.get("content-type");
          if (fileContentType)
            headers["Content-Type"] = fileContentType.split(";")[0].trim();
        }
      } catch {
        /* blocked or not downloadable — send as-is */
      }
    } else if (
      /^[A-Za-z0-9+/]+=*$/.test(bodyStr.slice(0, 200).replace(/\s/g, "")) &&
      bodyStr.length > 100
    ) {
      // Looks like base64 — decode to binary
      const buf = Buffer.from(bodyStr, "base64");
      if (buf.byteLength > 0 && buf.byteLength < bodyStr.length) {
        fetchBody = buf;
      }
    }
  }

  await assertSafeEgressUrl(url);
  const resp = await fetch(url, {
    method,
    headers,
    body: fetchBody
      ? Buffer.isBuffer(fetchBody)
        ? new Uint8Array(fetchBody)
        : (fetchBody as BodyInit)
      : undefined,
    signal: AbortSignal.timeout(timeout),
  });

  const contentType = resp.headers.get("content-type") ?? "";
  let data: any;
  if (contentType.includes("json")) {
    try {
      data = await resp.json();
    } catch {
      data = await resp.text();
    }
  } else {
    const text = await resp.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text.slice(0, 5000) };
    }
  }

  return {
    status: resp.status,
    data,
    log: {
      ...logContext,
      url: redactUrl(url),
      requestHeaders: headers,
      responseHeaders: Object.fromEntries(resp.headers.entries()),
    },
  };
}

async function executeDatabaseReference(
  integrationConfig: any,
  path: string,
  body: string,
  method: string,
  inputs: any[],
  resolvedParams: Record<string, any>,
  logContext: {
    integrationId: string | null;
    tenantId: string | null;
    method: string | null;
  },
): Promise<ExecuteReferenceResult> {
  const {
    executeMongoOperation,
    executeQuery,
    executeStoredProcedure,
    parseDbConfig,
  } = await import("@/lib/db-connector");

  const connConfig = parseDbConfig({
    ...integrationConfig,
    auth_config: {
      ...(integrationConfig.auth_config ?? {}),
      username:
        integrationConfig.db_config?.username ??
        integrationConfig.auth_config?.username ??
        "",
      password:
        integrationConfig.db_config?.password ??
        integrationConfig.auth_config?.password ??
        "",
    },
  });
  if (!connConfig)
    throw new Error("Database integration is missing connection details");
  const dbType = connConfig.type;
  const database = connConfig.database;

  const replaceTemplateTokens = (value: any): any => {
    if (typeof value === "string") {
      // A string that is exactly one {{key}} keeps the value's type (an
      // object stays an object for Mongo filters); otherwise text/JSON.
      const whole = /^\{\{(\w+)\}\}$/.exec(value);
      if (whole && resolvedParams[whole[1]] != null && typeof resolvedParams[whole[1]] === "object")
        return resolvedParams[whole[1]];
      return value.replace(/\{\{(\w+)\}\}/g, (_match, key) =>
        referenceInputText(resolvedParams[key]),
      );
    }
    if (Array.isArray(value)) return value.map(replaceTemplateTokens);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [
          key,
          replaceTemplateTokens(nested),
        ]),
      );
    }
    return value;
  };

  let parsedBody: any = null;
  if (body) {
    try {
      parsedBody = replaceTemplateTokens(JSON.parse(body));
    } catch {
      parsedBody = null;
    }
  }

  if (dbType === "mongodb") {
    const mongoResult = await executeMongoOperation(
      connConfig,
      parsedBody ?? {},
    );
    return {
      status: 200,
      data: mongoResult,
      log: { ...logContext, url: `db://mongodb/${database}` },
    };
  }

  let sql = typeof parsedBody?.sql === "string" ? parsedBody.sql : "";

  if (!sql && path) {
    const cleanPath =
      path.startsWith("/") && path.includes("_internal") ? "" : path;
    if (
      cleanPath &&
      /^\s*(SELECT|INSERT|UPDATE|DELETE|EXEC|CALL|WITH|CREATE|ALTER|DROP|DECLARE|SHOW|BEGIN)\b/i.test(
        cleanPath,
      )
    ) {
      sql = cleanPath;
    }
  }

  if (
    !sql &&
    typeof body === "string" &&
    /^\s*(SELECT|INSERT|UPDATE|DELETE|EXEC|CALL|WITH|BEGIN)\b/i.test(body)
  ) {
    sql = body;
  }

  const explicitParams =
    parsedBody?.params != null
      ? replaceTemplateTokens(
          typeof parsedBody.params === "string"
            ? (() => {
                try {
                  return JSON.parse(parsedBody.params);
                } catch {
                  return parsedBody.params;
                }
              })()
            : parsedBody.params,
        )
      : undefined;

  const procedureName =
    typeof parsedBody?.procedure === "string"
      ? parsedBody.procedure.trim()
      : "";
  if (procedureName) {
    const procParams =
      explicitParams &&
      typeof explicitParams === "object" &&
      !Array.isArray(explicitParams)
        ? explicitParams
        : resolvedParams;
    const result = await executeStoredProcedure(
      connConfig,
      procedureName,
      procParams,
    );
    return {
      status: 200,
      data: result.output
        ? { rows: result.rows ?? [], output: result.output }
        : (result.rows ?? []),
      log: { ...logContext, url: `db://${dbType}/${database}` },
    };
  }

  if (!sql.trim())
    throw new Error(
      "No SQL query found. Ensure the reference path template contains a valid SQL statement.",
    );

  const isStoredProc =
    method === "EXEC" || /^\s*(EXEC|EXECUTE|CALL)\b/i.test(sql);
  if (isStoredProc) {
    let procName = sql.replace(/^\s*(EXEC|EXECUTE|CALL)\s+/i, "").trim();
    const paramAssignmentIdx = procName.search(/\s+@\w+\s*=/);
    if (paramAssignmentIdx > 0)
      procName = procName.slice(0, paramAssignmentIdx).trim();
    const procParams = Array.isArray(explicitParams)
      ? Object.fromEntries(
          explicitParams.map((value, index) => [`p${index + 1}`, value]),
        )
      : explicitParams && typeof explicitParams === "object"
        ? explicitParams
        : resolvedParams;
    const result = await executeStoredProcedure(
      connConfig,
      procName,
      procParams,
    );
    return {
      status: 200,
      data: result.output
        ? { rows: result.rows ?? [], output: result.output }
        : (result.rows ?? []),
      log: { ...logContext, url: `db://${dbType}/${database}` },
    };
  }

  let resolvedQuery = sql;
  let queryValues: any = explicitParams;

  if (dbType === "mssql" && !queryValues) {
    for (const [key, val] of Object.entries(resolvedParams)) {
      let escaped: string;
      if (val === null || val === undefined) escaped = "NULL";
      else if (typeof val === "number" && isFinite(val)) escaped = String(val);
      else {
        const str = String(val);
        escaped = /^-?\d+$/.test(str) ? str : `'${str.replace(/'/g, "''")}'`;
      }
      resolvedQuery = resolvedQuery.replace(
        new RegExp(`@${key}\\b`, "g"),
        escaped,
      );
    }
  } else if (dbType === "postgres" && !queryValues) {
    const pgParamValues: any[] = [];
    let idx = 0;
    resolvedQuery = resolvedQuery.replace(
      /@(\w+)/g,
      (_match: string, name: string) => {
        idx++;
        pgParamValues.push(resolvedParams[name] ?? null);
        return `$${idx}`;
      },
    );
    queryValues = pgParamValues;
  }

  const result = await executeQuery(connConfig, resolvedQuery, queryValues);
  const rows = result.rows ?? (Array.isArray(result) ? result : []);
  const affectedRows =
    (result as any).rowCount ??
    (result as any).rowsAffected?.[0] ??
    rows.length;

  // For write operations (INSERT/UPDATE/DELETE), return affected_rows
  const isWriteOp = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql);
  if (isWriteOp) {
    return {
      status: 200,
      data: {
        affected_rows: affectedRows,
        rows: rows.length > 0 ? rows : undefined,
      },
      log: { ...logContext, url: `db://${dbType}/${database}` },
    };
  }

  // If the query is a single-row fetch (SELECT TOP 1, LIMIT 1, or WHERE pk = value with 1 result),
  // return the row as an object instead of a 1-element array
  const isSingleRowQuery =
    /\b(TOP\s+1|LIMIT\s+1)\b/i.test(sql) ||
    (rows.length === 1 && /\bWHERE\b/i.test(sql) && !/\bOFFSET\b/i.test(sql));
  if (isSingleRowQuery && rows.length <= 1) {
    return {
      status: 200,
      data: rows[0] ?? null,
      log: { ...logContext, url: `db://${dbType}/${database}` },
    };
  }

  return {
    status: 200,
    data: rows,
    log: { ...logContext, url: `db://${dbType}/${database}` },
  };
}
