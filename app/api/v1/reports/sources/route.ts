import { createClient, getCachedUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, requireApiPermission } from '@/lib/api-auth'
import { listTenantReportSources } from '@/lib/report-source-registry'

export async function GET(request: NextRequest) {
  try {
    // Try API key auth first, fall back to session auth
    const apiAuth = await validateApiKey(request)
    let supabase: any
    let tenantIdOverride: string | undefined

    if (apiAuth.success) {
      const forbidden = requireApiPermission(apiAuth, 'reports.view')
      if (forbidden) return forbidden
      supabase = apiAuth.supabase
      tenantIdOverride = apiAuth.tenantId
    } else {
      supabase = await createClient()
      const user = await getCachedUser()
      if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    let tenantId = tenantIdOverride
    if (!tenantId) {
      const user = await getCachedUser()
      const { data: profile } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user?.id).single()
      tenantId = profile?.current_tenant_id ?? profile?.tenant_id
    }
    if (!tenantId) return NextResponse.json({ sources: [] })

    const sources = await listTenantReportSources(supabase, tenantId)

    return NextResponse.json({ sources })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load data sources' }, { status: 500 })
  }
}
