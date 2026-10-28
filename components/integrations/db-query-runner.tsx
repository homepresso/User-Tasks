"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Play, Table, RefreshCw, ChevronRight, ChevronDown } from "lucide-react"

interface DbQueryRunnerProps {
  integrationId: string
}

interface QueryResult {
  rows: Record<string, any>[]
  fields: { name: string }[]
  rowCount: number
  duration: number
}

interface TableInfo {
  schema: string
  name: string
}

interface ColumnInfo {
  column: string
  type: string
  nullable: boolean
  default_value: string | null
}

interface ProcedureInfo {
  schema: string
  name: string
  type: string
}

export function DbQueryRunner({ integrationId }: DbQueryRunnerProps) {
  const [query, setQuery] = useState("SELECT 1 AS test")
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [tables, setTables] = useState<TableInfo[] | null>(null)
  const [procedures, setProcedures] = useState<ProcedureInfo[] | null>(null)
  const [loadingTables, setLoadingTables] = useState(false)
  const [expandedTable, setExpandedTable] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"tables" | "procedures">("tables")
  const [tableColumns, setTableColumns] = useState<
    Record<string, ColumnInfo[]>
  >({})
  const [procParams, setProcParams] = useState<Record<string, any[]>>({})

  async function runQuery() {
    setRunning(true)
    setError(null)
    setResult(null)

    try {
      const resp = await fetch("/api/db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "query",
          integrationId,
          query,
        }),
      })
      const data = await resp.json()
      if (data.error) {
        setError(data.error)
      } else {
        setResult(data)
      }
    } catch (e: any) {
      setError(e.message)
    }

    setRunning(false)
  }

  async function loadTables() {
    setLoadingTables(true)
    try {
      const [tablesResp, procsResp] = await Promise.all([
        fetch("/api/db", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "tables", integrationId }),
        }),
        fetch("/api/db", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "procedures", integrationId }),
        }),
      ])
      const tablesData = await tablesResp.json()
      const procsData = await procsResp.json()
      if (tablesData.tables) setTables(tablesData.tables)
      if (procsData.procedures) setProcedures(procsData.procedures)
    } catch (e) {
      /* ignore */
    }
    setLoadingTables(false)
  }

  async function loadProcParams(schema: string, name: string) {
    const key = `${schema}.${name}`
    if (procParams[key]) {
      setExpandedTable(expandedTable === key ? null : key)
      return
    }
    try {
      const resp = await fetch("/api/db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "describe_procedure", integrationId, schema, procedureName: name }),
      })
      const data = await resp.json()
      if (data.parameters) {
        setProcParams((prev) => ({ ...prev, [key]: data.parameters }))
        setExpandedTable(key)
      }
    } catch (e) { /* ignore */ }
  }

  function selectProcedure(schema: string, name: string) {
    setQuery(`EXEC ${schema}.${name}`)
  }

  async function loadColumns(schema: string, table: string) {
    const key = `${schema}.${table}`
    if (tableColumns[key]) {
      setExpandedTable(expandedTable === key ? null : key)
      return
    }

    try {
      const resp = await fetch("/api/db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "describe",
          integrationId,
          schema,
          table,
        }),
      })
      const data = await resp.json()
      if (data.columns) {
        setTableColumns((prev) => ({ ...prev, [key]: data.columns }))
        setExpandedTable(key)
      }
    } catch (e) {
      /* ignore */
    }
  }

  function selectTable(schema: string, table: string) {
    setQuery(`SELECT * FROM ${schema}.${table} LIMIT 100`)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Table browser (left) */}
        <div
          className="rounded-lg border p-3 overflow-y-auto max-h-[500px]"
          style={{
            backgroundColor: "var(--theme-card-bg)",
            borderColor: "var(--theme-surface-border)",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab("tables")}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors"
                style={{
                  backgroundColor: activeTab === "tables" ? "var(--theme-primary-light)" : "transparent",
                  color: activeTab === "tables" ? "var(--theme-primary-text)" : "var(--theme-muted-text)",
                }}
              >
                Tables & Views
              </button>
              <button
                onClick={() => setActiveTab("procedures")}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors"
                style={{
                  backgroundColor: activeTab === "procedures" ? "var(--theme-primary-light)" : "transparent",
                  color: activeTab === "procedures" ? "var(--theme-primary-text)" : "var(--theme-muted-text)",
                }}
              >
                Procedures
              </button>
            </div>
            <button
              onClick={loadTables}
              disabled={loadingTables}
              className="p-1 hover:opacity-70"
              style={{ color: "var(--theme-muted-text)" }}
            >
              <RefreshCw size={12} className={loadingTables ? "animate-spin" : ""} />
            </button>
          </div>

          {!tables ? (
            <Button
              variant="outline"
              size="sm"
              onClick={loadTables}
              className="w-full text-xs"
            >
              <Table size={12} className="mr-1" /> Load All
            </Button>
          ) : activeTab === "procedures" ? (
            /* Procedures tab */
            !procedures?.length ? (
              <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>No procedures found</p>
            ) : (
              <div className="space-y-0.5">
                {procedures.map((p) => {
                  const key = `${p.schema}.${p.name}`
                  const isExpanded = expandedTable === key
                  const params = procParams[key]
                  const icon = p.type === "procedure" ? "⚙️" : "ƒ"
                  return (
                    <div key={key}>
                      <button
                        className="flex items-center gap-1 w-full text-left text-xs py-1 px-1.5 rounded hover:opacity-80"
                        onClick={() => loadProcParams(p.schema, p.name)}
                        onDoubleClick={() => selectProcedure(p.schema, p.name)}
                      >
                        {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        <span className="text-[10px]">{icon}</span>
                        <span className="truncate">
                          {p.schema !== "dbo" && p.schema !== "public" && (
                            <span style={{ color: "var(--theme-muted-text)" }}>{p.schema}.</span>
                          )}
                          {p.name}
                        </span>
                      </button>
                      {isExpanded && params && (
                        <div className="ml-5 space-y-0.5 py-1">
                          {params.length === 0 ? (
                            <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>No parameters</p>
                          ) : (
                            params.map((param: any, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-[10px] px-1.5 py-0.5">
                                <span className="font-medium">{param.name ?? param.arguments ?? `$${i + 1}`}</span>
                                <span className="font-mono" style={{ color: "var(--theme-muted-text)" }}>
                                  {param.type ?? param.return_type ?? ""}
                                </span>
                                {param.mode && <span className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>{param.mode}</span>}
                              </div>
                            ))
                          )}
                          <button
                            className="text-[10px] px-1.5 py-0.5 hover:underline"
                            style={{ color: "var(--theme-primary-text)" }}
                            onClick={() => selectProcedure(p.schema, p.name)}
                          >
                            EXEC {p.name}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          ) : tables.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
              No tables found
            </p>
          ) : (
            <div className="space-y-0.5">
              {tables.map((t) => {
                const key = `${t.schema}.${t.name}`
                const isExpanded = expandedTable === key
                const cols = tableColumns[key]

                return (
                  <div key={key}>
                    <button
                      className="flex items-center gap-1 w-full text-left text-xs py-1 px-1.5 rounded hover:opacity-80"
                      onClick={() => loadColumns(t.schema, t.name)}
                      onDoubleClick={() => selectTable(t.schema, t.name)}
                    >
                      {isExpanded ? (
                        <ChevronDown size={10} />
                      ) : (
                        <ChevronRight size={10} />
                      )}
                      <Table size={10} style={{ color: "var(--theme-primary-text)" }} />
                      <span className="truncate">
                        {t.schema !== "public" && (
                          <span style={{ color: "var(--theme-muted-text)" }}>
                            {t.schema}.
                          </span>
                        )}
                        {t.name}
                      </span>
                    </button>

                    {isExpanded && cols && (
                      <div className="ml-5 space-y-0.5 py-1">
                        {cols.map((col) => (
                          <div
                            key={col.column}
                            className="flex items-center gap-2 text-[10px] px-1.5 py-0.5"
                          >
                            <span className="font-medium">{col.column}</span>
                            <span
                              className="font-mono"
                              style={{ color: "var(--theme-muted-text)" }}
                            >
                              {col.type}
                            </span>
                            {!col.nullable && (
                              <span className="text-red-400">NOT NULL</span>
                            )}
                          </div>
                        ))}
                        <button
                          className="text-[10px] px-1.5 py-0.5 hover:underline"
                          style={{ color: "var(--theme-primary-text)" }}
                          onClick={() => selectTable(t.schema, t.name)}
                        >
                          SELECT * FROM {t.name}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Query editor + results (right) */}
        <div className="lg:col-span-3 space-y-3">
          {/* Query editor */}
          <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: "var(--theme-surface-border)" }}
          >
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-32 px-4 py-3 font-mono text-sm resize-none outline-none"
              style={{
                backgroundColor: "var(--theme-card-bg)",
                color: "var(--theme-card-text)",
              }}
              placeholder="Enter SQL query..."
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  runQuery()
                }
              }}
            />
            <div
              className="flex items-center justify-between px-3 py-2 border-t"
              style={{
                backgroundColor: "var(--theme-surface)",
                borderColor: "var(--theme-surface-border)",
              }}
            >
              <span
                className="text-[10px]"
                style={{ color: "var(--theme-muted-text)" }}
              >
                Cmd+Enter to run
              </span>
              <Button
                size="sm"
                onClick={runQuery}
                disabled={running || !query.trim()}
              >
                <Play size={12} className="mr-1" />
                {running ? "Running..." : "Run Query"}
              </Button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 text-red-600 p-3 text-sm">
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div
              className="rounded-lg border overflow-hidden"
              style={{ borderColor: "var(--theme-surface-border)" }}
            >
              <div
                className="flex items-center justify-between px-3 py-2 border-b text-xs"
                style={{
                  backgroundColor: "var(--theme-surface)",
                  borderColor: "var(--theme-surface-border)",
                  color: "var(--theme-muted-text)",
                }}
              >
                <span>
                  {result.rowCount} row{result.rowCount !== 1 ? "s" : ""}{" "}
                  returned
                </span>
                <span>{result.duration}ms</span>
              </div>
              <div className="overflow-x-auto max-h-[400px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ backgroundColor: "var(--theme-surface)" }}>
                      {result.fields.map((f) => (
                        <th
                          key={f.name}
                          className="px-3 py-2 text-left font-medium whitespace-nowrap"
                          style={{ color: "var(--theme-muted-text)" }}
                        >
                          {f.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr
                        key={i}
                        style={{
                          borderTop:
                            "1px solid var(--theme-surface-border)",
                        }}
                      >
                        {result.fields.map((f) => (
                          <td
                            key={f.name}
                            className="px-3 py-1.5 whitespace-nowrap font-mono"
                          >
                            {row[f.name] === null ? (
                              <span style={{ color: "var(--theme-muted-text)", opacity: 0.5 }}>
                                NULL
                              </span>
                            ) : (
                              String(row[f.name])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
