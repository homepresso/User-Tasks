import { NextRequest, NextResponse } from "next/server"
import { createClient, getCachedUser } from "@/lib/supabase/server"
import { getCurrentTenantId, getOwnedIntegration } from "@/lib/integrations/auth"
import { getUserPermissions } from "@/lib/permissions-server"
import {
  testConnection,
  executeQuery,
  listTables,
  describeTable,
  listStoredProcedures,
  describeProcedure,
  executeStoredProcedure,
  parseDbConfig,
} from "@/lib/db-connector"

// Running SQL / stored procedures against a connected DB is a privileged action;
// introspection (test/list/describe) is lower-risk but still integration-scoped.
const POWERFUL_ACTIONS = new Set(["query", "exec_procedure"])

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Auth check
  const user = await getCachedUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { action, integrationId, query, params, schema, table, procedureName, procedureParams } = body

  if (!integrationId) {
    return NextResponse.json({ error: "integrationId is required" }, { status: 400 })
  }

  // Authorization: the integration must belong to the caller's tenant, and the
  // caller must hold the appropriate integration permission. Previously this
  // route fetched the integration by id with no tenant filter and no permission
  // gate, letting any authenticated user run arbitrary SQL against any tenant's DB.
  const perms = await getUserPermissions()
  const requiredPerm = POWERFUL_ACTIONS.has(action) ? "integrations.edit" : "integrations.view"
  if (!perms.has(requiredPerm)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let integration
  try {
    const tenantId = await getCurrentTenantId(supabase, user.id)
    integration = await getOwnedIntegration(supabase, tenantId, integrationId)
  } catch {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 })
  }

  const dbConfig = parseDbConfig((integration as any).config)
  if (!dbConfig) {
    return NextResponse.json(
      { error: "Invalid database configuration" },
      { status: 400 }
    )
  }

  try {
    switch (action) {
      case "test": {
        const result = await testConnection(dbConfig)

        // Save test result
        await supabase
          .from("integrations")
          .update({
            last_tested_at: new Date().toISOString(),
            last_test_status: result.success ? "success" : "error",
            last_test_message: result.message,
          })
          .eq("id", integrationId)

        return NextResponse.json(result)
      }

      case "query": {
        if (!query) {
          return NextResponse.json(
            { error: "Query is required" },
            { status: 400 }
          )
        }
        const result = await executeQuery(dbConfig, query, params)
        return NextResponse.json(result)
      }

      case "tables": {
        const tables = await listTables(dbConfig)
        return NextResponse.json({ tables })
      }

      case "describe": {
        if (!schema || !table) {
          return NextResponse.json(
            { error: "Schema and table are required" },
            { status: 400 }
          )
        }
        const columns = await describeTable(dbConfig, schema, table)
        return NextResponse.json({ columns })
      }

      case "procedures": {
        const procedures = await listStoredProcedures(dbConfig)
        return NextResponse.json({ procedures })
      }

      case "describe_procedure": {
        if (!schema || !procedureName) {
          return NextResponse.json(
            { error: "Schema and procedureName are required" },
            { status: 400 }
          )
        }
        const procDetails = await describeProcedure(dbConfig, schema, procedureName)
        return NextResponse.json({ parameters: procDetails })
      }

      case "exec_procedure": {
        if (!procedureName) {
          return NextResponse.json(
            { error: "procedureName is required" },
            { status: 400 }
          )
        }
        const procResult = await executeStoredProcedure(
          dbConfig,
          procedureName,
          procedureParams ?? {}
        )
        return NextResponse.json(procResult)
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error: any) {
    const safeMessage = error.message?.includes('password')
      ? 'Database operation failed'
      : `Database error: ${error.message}`
    return NextResponse.json({ error: safeMessage }, { status: 500 })
  }
}
