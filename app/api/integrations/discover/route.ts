import { NextRequest, NextResponse } from 'next/server'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { discoverObjects, discoverParameters, discoverColumns, discoverPrimaryKey, discoverIdentityColumn, parseDbConfig } from '@/lib/db-connector'
import { getCurrentTenantId, getOwnedIntegration } from '@/lib/integrations/auth'
import { getUserPermissions } from '@/lib/permissions-server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Schema discovery reads the connected database: same gate as /api/db introspection.
  const perms = await getUserPermissions()
  if (!perms.has('integrations.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { integration_id, action, schema, name } = await request.json()
  if (!integration_id) return NextResponse.json({ error: 'integration_id required' }, { status: 400 })

  let integration
  try {
    const tenantId = await getCurrentTenantId(supabase, user.id)
    integration = await getOwnedIntegration(supabase, tenantId, integration_id, 'config')
  } catch {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  const dbConfig = parseDbConfig((integration as any).config as any)
  if (!dbConfig) return NextResponse.json({ error: 'Not a database integration' }, { status: 400 })

  try {
    switch (action) {
      case 'objects': {
        const objects = await discoverObjects(dbConfig)
        return NextResponse.json({ objects })
      }
      case 'parameters': {
        if (!schema || !name) return NextResponse.json({ error: 'schema and name required' }, { status: 400 })
        const params = await discoverParameters(dbConfig, schema, name)
        return NextResponse.json({ parameters: params })
      }
      case 'columns': {
        if (!schema || !name) return NextResponse.json({ error: 'schema and name required' }, { status: 400 })
        const cols = await discoverColumns(dbConfig, schema, name)
        return NextResponse.json({ columns: cols })
      }
      case 'primary_key': {
        if (!schema || !name) return NextResponse.json({ error: 'schema and name required' }, { status: 400 })
        const pkCols = await discoverPrimaryKey(dbConfig, schema, name)
        const identityCol = await discoverIdentityColumn(dbConfig, schema, name).catch(() => null)
        return NextResponse.json({ primary_key: pkCols, identity_column: identityCol })
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Discovery failed' }, { status: e?.name === 'EgressBlockedError' ? 400 : 500 })
  }
}
