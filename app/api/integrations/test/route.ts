import { NextRequest, NextResponse } from "next/server"
import { createClient, getCachedUser } from "@/lib/supabase/server"
import { getUserPermissions } from "@/lib/permissions-server"
import { assertSafeEgressHost, extractDbHost, EgressBlockedError } from "@/lib/egress-guard"
import { connectorFetch } from "@/lib/integrations/http"
import { resolveSecretPlaceholders } from "@/lib/services/_shared"
import { isSupportedDbType, testConnection as testDbConnection } from "@/lib/db-connector"
import type { DbConnectionConfig } from "@/lib/db-connector"
import { decryptSensitiveFields } from "@/lib/secret-fields"
import { applyAuthHeaders } from "@/lib/integrations/attach-auth"
import { resolveTransportFetch } from "@/lib/integrations/transports"
import { getCurrentTenantId, getOwnedIntegration } from "@/lib/integrations/auth"

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // This endpoint opens server-side connections to caller-supplied targets —
  // gate it on the same permission as the MCP integrations_test tool.
  const perms = await getUserPermissions()
  if (!perms.has("integrations.test") && !perms.has("integrations.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json()
  const { type, integrationId } = body
  // Edit UIs round-trip stored (encrypted-at-rest) credential values into this
  // test endpoint — decrypt server-side; plaintext passes through unchanged.
  const tenantId = await getCurrentTenantId(supabase, user.id)
  // Saved integrations: '__SECRET__' masks (what the edit UI holds) are
  // restored from the stored config of the caller's own integration.
  let rawConfig = body.config ?? {}
  if (integrationId) {
    const stored = await getOwnedIntegration(supabase, tenantId, String(integrationId), 'config').catch(() => null) as any
    if (stored?.config) rawConfig = resolveSecretPlaceholders(rawConfig, stored.config)
  }
  const config = decryptSensitiveFields(rawConfig)

  try {
    if (type === "database") {
      // Test database connection directly with provided config
      const dbType = config.db_type ?? "postgres"
      if (!isSupportedDbType(dbType)) {
        return NextResponse.json({
          success: false,
          message: `${dbType} is not a supported database runtime. Supported types are postgres, mssql, mysql, oracle, snowflake, and mongodb.`,
        })
      }

      const isMssql = dbType === "mssql"
      const defaultPort = isMssql ? 1433 : 5432
      // Azure SQL always requires encryption
      const isAzure = config.host?.includes(".database.windows.net") || config.host?.includes(".database.azure.com")

      const dbConfig: DbConnectionConfig = {
        type: dbType,
        host: config.host,
        port: Number(config.port) || defaultPort,
        database: config.database,
        username: config.username ?? "",
        password: config.password ?? "",
        ssl: config.ssl ?? isAzure,
        trustServerCertificate: config.trustServerCertificate ?? !isAzure,
        encrypt: config.encrypt ?? isAzure,
        instanceName: config.instanceName || undefined,
        authMethod: config.auth_method ?? "sql",
        entraClientId: config.entra_client_id,
        entraClientSecret: config.entra_client_secret,
        entraTenantId: config.entra_tenant_id,
        connectionString: config.connection_string,
        schema: config.schema,
        warehouse: config.warehouse,
        role: config.role,
        account: config.account,
        service: config.service,
        connectionType: config.connection_type,
        tnsString: config.tns_string,
      }

      if ((!dbConfig.host && dbType !== "mongodb" && dbType !== "snowflake") || !dbConfig.database) {
        return NextResponse.json({
          success: false,
          message: "Database connection details are incomplete",
        })
      }

      // SSRF guard: check the explicit host and any host embedded in a
      // connection string before the driver dials out.
      const hostsToCheck = [dbConfig.host, extractDbHost(dbConfig.connectionString ?? "")].filter(Boolean) as string[]
      for (const h of hostsToCheck) await assertSafeEgressHost(h)

      const result = await testDbConnection(dbConfig)
      return NextResponse.json(result)
    } else {
      // Test REST API / GraphQL / Webhook
      const baseUrl = config.base_url
      if (!baseUrl) {
        return NextResponse.json({
          success: false,
          message: "Base URL is required",
        })
      }

      const headers: Record<string, string> = {}
      // OAuth tokens are stored on a connector linked to a saved integration.
      // Verify that integration belongs to the caller's active tenant before
      // allowing the shared REST broker to resolve its connector.
      if (config.auth_type === 'oauth2') {
        if (!integrationId) {
          return NextResponse.json({ success: false, message: 'Save and connect this OAuth integration before testing.' })
        }
        await getOwnedIntegration(supabase, tenantId, String(integrationId), 'id')
      }
      // Token stores are scoped to the caller's tenant (auth_config.connector_id comes from the request body).
      const query: Record<string, string> = {}
      await applyAuthHeaders(config, headers, { supabase, integrationId: integrationId ? String(integrationId) : null, tenantId }, query)

      const target = new URL(baseUrl)
      for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v)
      // Windows (NTLM / Kerberos) and extension transports: the same fetch the runtime uses.
      const fetchImpl = await resolveTransportFetch({ tenantId, integrationConfig: config })
      const resp = await connectorFetch(target.toString(), { headers }, { timeoutMs: 10_000, maxAttempts: 1, fetchImpl })
      await resp.body?.cancel().catch(() => {})

      return NextResponse.json({
        success: resp.ok,
        message: resp.ok
          ? `${resp.status} OK — Connection successful`
          : `${resp.status} ${resp.statusText}`,
        serverVersion: resp.headers.get("server") ?? undefined,
      })
    }
  } catch (error: any) {
    const message = error.message ?? "Connection failed"
    return NextResponse.json(
      { success: false, message },
      { status: error instanceof EgressBlockedError ? 403 : 200 },
    )
  }
}
