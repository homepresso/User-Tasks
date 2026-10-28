"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateIntegration } from "@/app/actions/integrations"
import { useRouter } from "next/navigation"
import { Save, Zap, Database, Check, X } from "lucide-react"
import { InlineNotice } from "@/components/ui/inline-notice"

interface DbConnectionFormProps {
  integration: {
    id: string
    config: any
  }
}

const DB_TYPES = [
  {
    value: "postgres",
    label: "PostgreSQL",
    defaultPort: 5432,
    icon: "🐘",
  },
  {
    value: "mssql",
    label: "SQL Server",
    defaultPort: 1433,
    icon: "🔷",
  },
]

export function DbConnectionForm({ integration }: DbConnectionFormProps) {
  const config = integration.config as any
  const dbConfig = config?.db_config ?? {}

  const savedDbType = dbConfig.db_type ?? "postgres"
  const [dbType, setDbType] = useState(savedDbType)

  // Fix port if it doesn't match the db type (e.g. saved as 5432 for mssql)
  const correctPort = (() => {
    const saved = dbConfig.port
    if (savedDbType === "mssql" && (!saved || saved === 5432 || saved === "5432")) return "1433"
    if (savedDbType === "postgres" && (!saved || saved === 1433 || saved === "1433")) return "5432"
    return String(saved ?? (savedDbType === "mssql" ? "1433" : "5432"))
  })()

  const [host, setHost] = useState(dbConfig.host ?? "")
  const [port, setPort] = useState(correctPort)
  const [database, setDatabase] = useState(dbConfig.database ?? "")
  const [username, setUsername] = useState(dbConfig.username ?? "")
  const [password, setPassword] = useState(dbConfig.password ?? "")
  const [ssl, setSsl] = useState(dbConfig.ssl ?? false)
  // MSSQL specific
  const [instanceName, setInstanceName] = useState(dbConfig.instanceName ?? "")
  const [trustCert, setTrustCert] = useState(dbConfig.trustServerCertificate ?? true)
  // Auth method
  const [authMethod, setAuthMethod] = useState(dbConfig.auth_method ?? "sql")
  const [entraClientId, setEntraClientId] = useState(dbConfig.entra_client_id ?? "")
  const [entraClientSecret, setEntraClientSecret] = useState(dbConfig.entra_client_secret ?? "")
  const [entraTenantId, setEntraTenantId] = useState(dbConfig.entra_tenant_id ?? "")
  const [encrypt, setEncrypt] = useState(dbConfig.encrypt ?? false)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
    serverVersion?: string
  } | null>(null)
  const router = useRouter()

  function handleDbTypeChange(type: string) {
    setDbType(type)
    const def = DB_TYPES.find((t) => t.value === type)
    setPort(String(def?.defaultPort ?? 5432))
    if (type === "mssql") {
      setUsername(username || "sa")
      // Auto-enable encrypt if host looks like Azure
      if (host.includes(".database.windows.net")) {
        setEncrypt(true)
        setTrustCert(true)
      }
    }
  }

  function handleHostChange(newHost: string) {
    setHost(newHost)
    // Auto-detect Azure SQL and set appropriate defaults
    if (newHost.includes(".database.windows.net") || newHost.includes(".database.azure.com")) {
      if (dbType === "mssql") {
        setEncrypt(true)
        setTrustCert(true)
      }
      if (port === "5432") setPort("1433")
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await updateIntegration(integration.id, {
        config: {
          ...config,
          db_config: {
            db_type: dbType,
            host,
            port: Number(port),
            database,
            username,
            password,
            ssl,
            instanceName: instanceName || undefined,
            trustServerCertificate: trustCert,
            encrypt,
            auth_method: authMethod,
            entra_client_id: entraClientId || undefined,
            entra_client_secret: entraClientSecret || undefined,
            entra_tenant_id: entraTenantId || undefined,
          },
        },
      })
      router.refresh()
    } catch (e: any) {
      setSaveError(e?.message ?? 'Could not save the connection. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)

    try {
      const resp = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "database",
          config: {
            db_type: dbType,
            host,
            port,
            database,
            username,
            password,
            ssl,
            trustServerCertificate: trustCert,
            encrypt,
            instanceName,
            auth_method: authMethod,
            entra_client_id: entraClientId,
            entra_client_secret: entraClientSecret,
            entra_tenant_id: entraTenantId,
          },
        }),
      })
      const result = await resp.json()
      setTestResult(result)
    } catch (e: any) {
      setTestResult({ success: false, message: e.message })
    }

    setTesting(false)
  }

  const selectedType = DB_TYPES.find((t) => t.value === dbType)

  const [showConnString, setShowConnString] = useState(false)
  const [connString, setConnString] = useState("")

  function parseConnectionString(str: string) {
    const parts: Record<string, string> = {}
    str.split(";").forEach((part) => {
      const eq = part.indexOf("=")
      if (eq > 0) {
        const key = part.slice(0, eq).trim().toLowerCase()
        const val = part.slice(eq + 1).trim().replace(/^"|"$/g, "")
        parts[key] = val
      }
    })

    // Parse Server=tcp:host,port or Server=host,port or Server=host
    const server = parts["server"] ?? parts["data source"] ?? ""
    const serverClean = server.replace(/^tcp:/i, "")
    const [hostPart, portPart] = serverClean.split(",")
    if (hostPart) setHost(hostPart.trim())
    if (portPart) setPort(portPart.trim())

    // Database
    const db = parts["initial catalog"] ?? parts["database"] ?? ""
    if (db) setDatabase(db)

    // User
    const user = parts["user id"] ?? parts["uid"] ?? parts["user"] ?? ""
    if (user) setUsername(user)

    // Password
    const pass = parts["password"] ?? parts["pwd"] ?? ""
    if (pass) setPassword(pass)

    // Encrypt
    if (parts["encrypt"]?.toLowerCase() === "true") setEncrypt(true)

    // TrustServerCertificate
    if (parts["trustservercertificate"]?.toLowerCase() === "false") setTrustCert(false)
    if (parts["trustservercertificate"]?.toLowerCase() === "true") setTrustCert(true)

    // Authentication
    const auth = parts["authentication"] ?? ""
    if (auth.toLowerCase().includes("active directory default")) {
      setAuthMethod("entra_default")
    } else if (auth.toLowerCase().includes("active directory password")) {
      setAuthMethod("entra_password")
    } else if (auth.toLowerCase().includes("active directory service principal")) {
      setAuthMethod("entra_client_secret")
    }

    // Auto-detect MSSQL from Azure host
    if (hostPart?.includes(".database.windows.net")) {
      setDbType("mssql")
      if (!portPart) setPort("1433")
    }

    setShowConnString(false)
    setConnString("")
    setTestResult(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Database size={16} style={{ color: "var(--theme-primary-text)" }} />
          <h4 className="text-sm font-semibold">Database Connection</h4>
        </div>
        <button
          onClick={() => setShowConnString(!showConnString)}
          className="text-[10px] font-medium hover:underline"
          style={{ color: "var(--theme-primary-text)" }}
        >
          {showConnString ? "Cancel" : "Paste connection string"}
        </button>
      </div>

      {showConnString && (
        <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "var(--theme-surface)", border: "1px solid var(--theme-surface-border)" }}>
          <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
            Paste a .NET / ADO.NET connection string to auto-fill all fields
          </p>
          <textarea
            value={connString}
            onChange={(e) => setConnString(e.target.value)}
            placeholder="Server=tcp:server.database.windows.net,1433;Initial Catalog=mydb;Encrypt=True;..."
            rows={3}
            className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
            style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
          />
          <Button size="sm" onClick={() => parseConnectionString(connString)} disabled={!connString.trim()}>
            Parse & Fill
          </Button>
        </div>
      )}

      {/* Database Type Selector */}
      <div>
        <label className="block text-xs font-medium mb-2">
          Database Type
        </label>
        <div className="flex gap-2">
          {DB_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => handleDbTypeChange(type.value)}
              className="flex-1 flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all"
              style={{
                borderColor:
                  dbType === type.value
                    ? "var(--theme-primary)"
                    : "var(--theme-surface-border)",
                backgroundColor:
                  dbType === type.value
                    ? "var(--theme-primary-light)"
                    : "var(--theme-card-bg)",
              }}
            >
              <span className="text-lg">{type.icon}</span>
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Connection fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">
            Host / Server
          </label>
          <Input
            value={host}
            onChange={(e) => handleHostChange(e.target.value)}
            placeholder={
              dbType === "mssql"
                ? "server.database.windows.net"
                : "db.example.com"
            }
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Port</label>
          <Input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder={String(selectedType?.defaultPort ?? 5432)}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">
          Database Name
        </label>
        <Input
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          placeholder={dbType === "mssql" ? "master" : "my_database"}
        />
      </div>

      {/* Auth method (MSSQL only shows Entra options) */}
      {dbType === "mssql" && (
        <div>
          <label className="block text-xs font-medium mb-2">Authentication</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "sql", label: "SQL Login", desc: "Username & password" },
              { value: "entra_password", label: "Entra ID (Password)", desc: "Azure AD user credentials" },
              { value: "entra_client_secret", label: "Entra ID (App)", desc: "Service principal / app registration" },
              { value: "entra_default", label: "Entra ID (Default)", desc: "Managed identity / Azure CLI" },
            ].map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setAuthMethod(m.value)}
                className="rounded-lg border-2 p-2 text-left transition-all"
                style={{
                  borderColor: authMethod === m.value ? "var(--theme-primary)" : "var(--theme-surface-border)",
                  backgroundColor: authMethod === m.value ? "var(--theme-primary-light)" : "transparent",
                }}
              >
                <p className="text-xs font-medium">{m.label}</p>
                <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>{m.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SQL Login credentials */}
      {(authMethod === "sql" || dbType === "postgres") && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Username</label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={dbType === "mssql" ? "sa" : "postgres"}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </div>
      )}

      {/* Entra ID Password (user's Azure AD credentials) */}
      {authMethod === "entra_password" && dbType === "mssql" && (
        <div className="space-y-3 rounded-lg p-3" style={{ backgroundColor: "var(--theme-surface)" }}>
          <p className="text-xs font-medium" style={{ color: "var(--theme-muted-text)" }}>Entra ID (Password)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Azure AD Username</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="user@domain.com" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Password</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Client/App ID <span className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>(optional)</span></label>
              <Input value={entraClientId} onChange={(e) => setEntraClientId(e.target.value)} placeholder="App registration client ID" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Tenant ID <span className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>(optional)</span></label>
              <Input value={entraTenantId} onChange={(e) => setEntraTenantId(e.target.value)} placeholder="Azure AD tenant ID" />
            </div>
          </div>
        </div>
      )}

      {/* Entra ID Service Principal */}
      {authMethod === "entra_client_secret" && dbType === "mssql" && (
        <div className="space-y-3 rounded-lg p-3" style={{ backgroundColor: "var(--theme-surface)" }}>
          <p className="text-xs font-medium" style={{ color: "var(--theme-muted-text)" }}>Entra ID (Service Principal)</p>
          <div>
            <label className="block text-xs font-medium mb-1">Tenant ID</label>
            <Input value={entraTenantId} onChange={(e) => setEntraTenantId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Client / Application ID</label>
            <Input value={entraClientId} onChange={(e) => setEntraClientId(e.target.value)} placeholder="App registration client ID" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Client Secret</label>
            <Input type="password" value={entraClientSecret} onChange={(e) => setEntraClientSecret(e.target.value)} placeholder="App registration secret" />
          </div>
        </div>
      )}

      {/* Entra ID Default Credential */}
      {authMethod === "entra_default" && dbType === "mssql" && (
        <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "var(--theme-surface)" }}>
          <p className="text-xs font-medium" style={{ color: "var(--theme-muted-text)" }}>Entra ID (Default Credential)</p>
          <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
            Uses DefaultAzureCredential which tries these sources in order:
          </p>
          <ol className="text-[10px] list-decimal list-inside space-y-0.5" style={{ color: "var(--theme-muted-text)" }}>
            <li>Environment variables (AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET)</li>
            <li>Managed Identity (when deployed to Azure)</li>
            <li>Azure CLI (<code className="font-mono">az login</code>)</li>
            <li>Visual Studio Code Azure extension</li>
          </ol>
          <p className="text-[10px] font-medium" style={{ color: "var(--theme-primary-text)" }}>
            For local development: run <code className="font-mono bg-white/10 px-1 rounded">az login</code> in your terminal first.
          </p>
        </div>
      )}

      {/* MSSQL-specific options */}
      {dbType === "mssql" && (
        <div className="space-y-3 rounded-lg p-3" style={{ backgroundColor: "var(--theme-surface)" }}>
          <p
            className="text-xs font-medium"
            style={{ color: "var(--theme-muted-text)" }}
          >
            SQL Server Options
          </p>
          <div>
            <label className="block text-xs font-medium mb-1">
              Instance Name{" "}
              <span style={{ color: "var(--theme-muted-text)" }}>
                (optional)
              </span>
            </label>
            <Input
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              placeholder="e.g. SQLEXPRESS"
            />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={encrypt}
              onChange={(e) => setEncrypt(e.target.checked)}
              className="rounded"
            />
            Encrypt connection (required for Azure SQL)
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={trustCert}
              onChange={(e) => setTrustCert(e.target.checked)}
              className="rounded"
            />
            Trust server certificate (skip validation)
          </label>
        </div>
      )}

      {/* Common options */}
      {dbType === "postgres" && (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={ssl}
            onChange={(e) => setSsl(e.target.checked)}
            className="rounded"
          />
          Use SSL connection
        </label>
      )}

      {/* Connection string preview */}
      <div
        className="rounded-lg p-3 text-xs font-mono break-all"
        style={{
          backgroundColor: "var(--theme-surface)",
          color: "var(--theme-muted-text)",
        }}
      >
        {dbType === "mssql" ? (
          <>
            Server={host || "server"}
            {instanceName ? `\\${instanceName}` : ""},
            {port || "1433"};Database={database || "database"};User Id=
            {username || "sa"};Password=****;
            {encrypt ? "Encrypt=True;" : ""}
            {trustCert ? "TrustServerCertificate=True;" : ""}
          </>
        ) : (
          <>
            postgresql://{username || "user"}:****@{host || "host"}:
            {port || "5432"}/{database || "database"}
            {ssl ? "?sslmode=require" : ""}
          </>
        )}
      </div>

      {saveError && (
        <InlineNotice tone="error" message={saveError} onDismiss={() => setSaveError(null)} className="mb-2" />
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save size={14} className="mr-1" />
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleTest}
          disabled={testing || !host || !database}
        >
          <Zap size={14} className="mr-1" />
          {testing ? "Testing..." : "Test Connection"}
        </Button>
      </div>

      {testResult && (
        <div
          className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
            testResult.success
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-600"
          }`}
        >
          {testResult.success ? (
            <Check size={16} className="shrink-0 mt-0.5" />
          ) : (
            <X size={16} className="shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-medium">
              {testResult.success ? "Connected!" : "Connection Failed"}
            </p>
            <p className="text-xs mt-0.5">{testResult.message}</p>
            {testResult.serverVersion && (
              <p className="text-[10px] mt-1 opacity-70 font-mono">
                {testResult.serverVersion}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
