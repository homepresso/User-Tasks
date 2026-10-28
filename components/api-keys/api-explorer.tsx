"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Play,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ExplorerEndpoint,
  ExplorerGroup,
  ExplorerParam,
} from "@/lib/api-schemas/explorer";
import explorerGroups from "@/lib/api-schemas/explorer.generated.json";

// ─── Endpoint Definitions ───
// Generated from the /api/v1 endpoint registry (lib/api-schemas) by
// `npm run openapi:gen` (checked by openapi:check), so every documented
// endpoint appears here, in the public explorer (/docs/api-explorer) and in
// the Postman export; the OData service (/api/odata) is appended. Shipped as
// JSON so the browser never loads the zod registry.

export type EndpointParam = ExplorerParam;
export type Endpoint = ExplorerEndpoint;

export const ENDPOINT_GROUPS = explorerGroups as ExplorerGroup[];

const METHOD_COLORS: Record<string, string> = {
  GET: "#22C55E",
  POST: "#3B82F6",
  PUT: "#F59E0B",
  PATCH: "#A855F7",
  DELETE: "#EF4444",
};

export function ApiExplorer({
  apiKeys,
}: {
  apiKeys: {
    id: string;
    name: string;
    key_prefix: string;
    key_plain?: string;
    is_revoked: boolean;
    expires_at: string | null;
  }[];
}) {
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(
    null,
  );
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [response, setResponse] = useState<{
    status: number;
    body: any;
    duration: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(ENDPOINT_GROUPS.map((g) => g.label)),
  );
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [exportedPostman, setExportedPostman] = useState(false);

  const activeKeys = apiKeys.filter(
    (k) =>
      !k.is_revoked && (!k.expires_at || new Date(k.expires_at) > new Date()),
  );
  const selectedKey = activeKeys.find((k) => k.id === selectedKeyId);

  const selectEndpoint = useCallback((ep: Endpoint) => {
    setSelectedEndpoint(ep);
    setParamValues({});
    setResponse(null);
  }, []);

  function exportPostmanCollection() {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const keyToken = selectedKey?.key_plain ?? "YOUR_API_KEY";
    const collection = {
      info: {
        name: "UserTasks API",
        description:
          "Auto-generated Postman collection from UserTasks API Explorer",
        schema:
          "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      auth: {
        type: "bearer",
        bearer: [{ key: "token", value: keyToken, type: "string" }],
      },
      item: ENDPOINT_GROUPS.map((group) => ({
        name: group.label,
        item: group.endpoints.map((ep) => {
          const queryParams = ep.params
            .filter((p) => p.type === "query")
            .map((p) => ({
              key: p.name,
              value: "",
              description: p.description ?? "",
            }));
          const pathParams = ep.params.filter((p) => p.type === "path");
          let url = `${baseUrl}${ep.path}`;
          for (const p of pathParams)
            url = url.replace(`{${p.name}}`, `{{${p.name}}}`);
          const bodyParams = ep.params.filter((p) => p.type === "body");
          const body =
            bodyParams.length > 0
              ? {
                  mode: "raw" as const,
                  raw: JSON.stringify(
                    Object.fromEntries(
                      bodyParams.map((p) => [p.name, p.placeholder ?? ""]),
                    ),
                    null,
                    2,
                  ),
                  options: { raw: { language: "json" } },
                }
              : undefined;
          return {
            name: ep.label,
            request: {
              method: ep.method,
              header: [{ key: "Content-Type", value: "application/json" }],
              url: {
                raw:
                  url +
                  (queryParams.length
                    ? "?" + queryParams.map((q) => `${q.key}=`).join("&")
                    : ""),
                host: [baseUrl],
                path: ep.path.split("/").filter(Boolean),
                query: queryParams,
              },
              description: ep.description,
              body,
            },
          };
        }),
      })),
    };
    const blob = new Blob([JSON.stringify(collection, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "UserTasks_API.postman_collection.json";
    a.click();
    URL.revokeObjectURL(url);
    setExportedPostman(true);
    setTimeout(() => setExportedPostman(false), 2000);
  }

  function toggleGroup(label: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function buildUrl(ep: Endpoint): string {
    let path = ep.path;
    // Replace path params
    for (const p of ep.params.filter((p) => p.type === "path")) {
      path = path.replace(`{${p.name}}`, paramValues[p.name] || `{${p.name}}`);
    }
    // Add query params
    const queryParams = ep.params.filter(
      (p) => p.type === "query" && paramValues[p.name],
    );
    if (queryParams.length > 0) {
      const qs = queryParams
        .map((p) => `${p.name}=${encodeURIComponent(paramValues[p.name])}`)
        .join("&");
      path += `?${qs}`;
    }
    return path;
  }

  function buildBody(ep: Endpoint): Record<string, any> | null {
    if (ep.method === "GET") return null;
    const bodyParams = ep.params.filter(
      (p) => p.type === "body" && paramValues[p.name],
    );
    if (bodyParams.length === 0) return null;

    const body: Record<string, any> = {};
    for (const p of bodyParams) {
      const val = paramValues[p.name];
      // Try to parse JSON values
      if (val.startsWith("{") || val.startsWith("[")) {
        try {
          body[p.name] = JSON.parse(val);
          continue;
        } catch {}
      }
      // Boolean
      if (val === "true") {
        body[p.name] = true;
        continue;
      }
      if (val === "false") {
        body[p.name] = false;
        continue;
      }
      // Number
      if (/^\d+$/.test(val)) {
        body[p.name] = Number(val);
        continue;
      }
      body[p.name] = val;
    }
    return body;
  }

  function buildCurl(ep: Endpoint): string {
    const url = buildUrl(ep);
    const token = selectedKey?.key_plain || "<your-api-key>";
    let cmd = `curl -X ${ep.method}`;
    cmd += ` \\\n  -H "Authorization: Bearer ${token}"`;
    cmd += ` \\\n  -H "Content-Type: application/json"`;
    const body = buildBody(ep);
    if (body) {
      cmd += ` \\\n  -d '${JSON.stringify(body, null, 2)}'`;
    }
    cmd += ` \\\n  ${window.location.origin}${url}`;
    return cmd;
  }

  async function executeRequest() {
    if (!selectedEndpoint || !selectedKey?.key_plain) return;
    setLoading(true);
    setResponse(null);

    const url = buildUrl(selectedEndpoint);
    const body = buildBody(selectedEndpoint);
    const start = Date.now();

    try {
      const res = await fetch(url, {
        method: selectedEndpoint.method,
        headers: {
          Authorization: `Bearer ${selectedKey.key_plain}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await res.json().catch(() => null);
      setResponse({
        status: res.status,
        body: data,
        duration: Date.now() - start,
      });
    } catch (e: any) {
      setResponse({
        status: 0,
        body: { error: e.message },
        duration: Date.now() - start,
      });
    } finally {
      setLoading(false);
    }
  }

  function copyCurl() {
    if (!selectedEndpoint) return;
    navigator.clipboard.writeText(buildCurl(selectedEndpoint));
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  }

  return (
    <div className="space-y-4">
      {/* Key selector */}
      <div>
        <label className="block text-xs font-medium mb-1">API Key</label>
        <select
          value={selectedKeyId}
          onChange={(e) => setSelectedKeyId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{
            backgroundColor: "var(--theme-card-bg)",
            borderColor: "var(--theme-surface-border)",
            color: "var(--theme-card-text)",
          }}
        >
          <option value="">Select an API key...</option>
          {activeKeys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name} ({k.key_prefix}...)
              {!k.key_plain && " — key hidden, recreate to use explorer"}
            </option>
          ))}
        </select>
        {selectedKeyId && !selectedKey?.key_plain && (
          <p
            className="text-[10px] mt-1"
            style={{ color: "var(--theme-warning, #F59E0B)" }}
          >
            This key was created before reveal was available. Delete and
            recreate it to use the explorer.
          </p>
        )}
      </div>

      <div className="flex justify-end mb-2">
        <Button
          variant="outline"
          size="sm"
          onClick={exportPostmanCollection}
          className="!h-7 !text-xs"
        >
          {exportedPostman ? (
            <>
              <Check size={12} className="mr-1" /> Exported
            </>
          ) : (
            <>
              <Copy size={12} className="mr-1" /> Download Postman Collection
            </>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 min-h-[500px]">
        {/* Endpoint sidebar */}
        <div
          className="space-y-1 overflow-y-auto pr-1"
          style={{ maxHeight: "calc(100vh - 300px)" }}
        >
          {ENDPOINT_GROUPS.map((group) => (
            <div key={group.label}>
              <button
                onClick={() => toggleGroup(group.label)}
                className="flex items-center gap-1 w-full text-left py-1.5 px-2 text-xs font-semibold uppercase tracking-wider rounded"
                style={{ color: "var(--theme-muted-text)" }}
              >
                {expandedGroups.has(group.label) ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                {group.label}
              </button>
              {expandedGroups.has(group.label) && (
                <div className="space-y-0.5 ml-1 mb-2">
                  {group.endpoints.map((ep) => {
                    const isSelected = selectedEndpoint === ep;
                    return (
                      <button
                        key={ep.path + ep.method}
                        onClick={() => selectEndpoint(ep)}
                        className={cn(
                          "flex items-center gap-2 w-full text-left px-2 py-1.5 rounded text-xs transition-colors",
                          isSelected ? "font-medium" : "hover:opacity-80",
                        )}
                        style={{
                          backgroundColor: isSelected
                            ? "var(--theme-primary-light)"
                            : "transparent",
                          color: isSelected
                            ? "var(--theme-primary-text)"
                            : "var(--theme-card-text)",
                        }}
                      >
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                          style={{
                            backgroundColor: METHOD_COLORS[ep.method] + "20",
                            color: METHOD_COLORS[ep.method],
                          }}
                        >
                          {ep.method}
                        </span>
                        <span className="truncate">{ep.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Request builder */}
        <div className="space-y-4">
          {!selectedEndpoint ? (
            <Card>
              <div className="text-center py-12">
                <Play
                  size={32}
                  className="mx-auto mb-2"
                  style={{ color: "var(--theme-muted-text)" }}
                />
                <p
                  className="text-sm"
                  style={{ color: "var(--theme-muted-text)" }}
                >
                  Select an endpoint from the left to get started
                </p>
              </div>
            </Card>
          ) : (
            <>
              {/* Endpoint header */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded"
                    style={{
                      backgroundColor:
                        METHOD_COLORS[selectedEndpoint.method] + "20",
                      color: METHOD_COLORS[selectedEndpoint.method],
                    }}
                  >
                    {selectedEndpoint.method}
                  </span>
                  <code
                    className="text-sm font-mono"
                    style={{ color: "var(--theme-card-text)" }}
                  >
                    {buildUrl(selectedEndpoint)}
                  </code>
                </div>
                <p
                  className="text-xs"
                  style={{ color: "var(--theme-muted-text)" }}
                >
                  {selectedEndpoint.description}
                </p>
              </div>

              {/* Parameters */}
              {selectedEndpoint.params.length > 0 && (
                <Card className="!p-4">
                  <h4
                    className="text-xs font-semibold uppercase tracking-wider mb-3"
                    style={{ color: "var(--theme-muted-text)" }}
                  >
                    Parameters
                  </h4>
                  <div className="space-y-3">
                    {selectedEndpoint.params.map((p) => (
                      <div key={p.name}>
                        <label className="flex items-center gap-1.5 text-xs font-medium mb-1">
                          <span>{p.name}</span>
                          <span
                            className="text-[9px] font-normal px-1 py-0.5 rounded"
                            style={{
                              backgroundColor: "var(--theme-surface)",
                              color: "var(--theme-muted-text)",
                            }}
                          >
                            {p.type}
                          </span>
                          {p.required && (
                            <span
                              className="text-[9px]"
                              style={{ color: "var(--theme-danger)" }}
                            >
                              required
                            </span>
                          )}
                        </label>
                        {p.options ? (
                          <select
                            value={paramValues[p.name] ?? ""}
                            onChange={(e) =>
                              setParamValues((prev) => ({
                                ...prev,
                                [p.name]: e.target.value,
                              }))
                            }
                            className="w-full rounded-lg border px-3 py-1.5 text-xs font-mono"
                            style={{
                              backgroundColor: "var(--theme-card-bg)",
                              borderColor: "var(--theme-surface-border)",
                              color: "var(--theme-card-text)",
                            }}
                          >
                            <option value="">Select...</option>
                            {p.options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            value={paramValues[p.name] ?? ""}
                            onChange={(e) =>
                              setParamValues((prev) => ({
                                ...prev,
                                [p.name]: e.target.value,
                              }))
                            }
                            placeholder={p.placeholder}
                            className="!text-xs font-mono"
                          />
                        )}
                        {p.description && (
                          <p
                            className="text-[10px] mt-0.5"
                            style={{ color: "var(--theme-muted-text)" }}
                          >
                            {p.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={executeRequest}
                  disabled={loading || !selectedKey?.key_plain}
                  title={
                    !selectedKey?.key_plain
                      ? "Select an API key with a visible key"
                      : undefined
                  }
                >
                  {loading ? (
                    <Loader2 size={14} className="mr-1 animate-spin" />
                  ) : (
                    <Play size={14} className="mr-1" />
                  )}
                  Send Request
                </Button>
                <Button size="sm" variant="outline" onClick={copyCurl}>
                  {copiedCurl ? (
                    <Check size={14} className="mr-1" />
                  ) : (
                    <Copy size={14} className="mr-1" />
                  )}
                  Copy cURL
                </Button>
              </div>

              {/* Response */}
              {response && (
                <Card className="!p-0 overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-2 border-b"
                    style={{ borderColor: "var(--theme-surface-border)" }}
                  >
                    <div className="flex items-center gap-2">
                      {response.status >= 200 && response.status < 300 ? (
                        <CheckCircle2
                          size={14}
                          style={{ color: "var(--theme-success, #22C55E)" }}
                        />
                      ) : (
                        <AlertCircle
                          size={14}
                          style={{ color: "var(--theme-danger, #EF4444)" }}
                        />
                      )}
                      <span
                        className={cn(
                          "text-xs font-bold",
                          response.status >= 200 && response.status < 300
                            ? "text-green-500"
                            : "text-red-500",
                        )}
                      >
                        {response.status || "Error"}
                      </span>
                      <span
                        className="text-[10px]"
                        style={{ color: "var(--theme-muted-text)" }}
                      >
                        {response.status >= 200 && response.status < 300
                          ? "OK"
                          : response.status >= 400 && response.status < 500
                            ? "Client Error"
                            : response.status >= 500
                              ? "Server Error"
                              : "Network Error"}
                      </span>
                    </div>
                    <div
                      className="flex items-center gap-1 text-[10px]"
                      style={{ color: "var(--theme-muted-text)" }}
                    >
                      <Clock size={10} />
                      {response.duration}ms
                    </div>
                  </div>
                  <pre
                    className="p-4 text-xs font-mono overflow-auto whitespace-pre-wrap"
                    style={{
                      maxHeight: 400,
                      color: "var(--theme-card-text)",
                      backgroundColor: "var(--theme-surface)",
                    }}
                  >
                    {response.body
                      ? JSON.stringify(response.body, null, 2)
                      : "No response body"}
                  </pre>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
