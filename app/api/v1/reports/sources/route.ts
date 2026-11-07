import { createClient, getCachedUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, requireApiPermission } from '@/lib/api-auth'
import { listTenantReportSources, resolveTenantReportSource } from '@/lib/report-source-registry'
import { workflowIdOfSourceInputs } from '@/lib/report-workflow-variables'
import { getUserPermissions } from '@/lib/permissions-server'

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

    // ?workflow_id=: Workflow runs and Tasks scoped to that workflow, with its
    // variable columns (vars.* / fields.*).
    const workflowParam = request.nextUrl.searchParams.get('workflow_id')
    if (workflowParam) {
      const workflowId = workflowIdOfSourceInputs({ workflow_id: workflowParam })
      if (!workflowId) return NextResponse.json({ error: 'workflow_id must be a workflow id' }, { status: 400 })
      // A workflow's variable columns come from its definition and runs: View workflows, as for the values.
      const permissions = apiAuth.success ? apiAuth.permissions : await getUserPermissions()
      if (permissions && !new Set(permissions).has('workflows.view')) {
        return NextResponse.json({ error: "Workflow variable columns need the 'workflows.view' permission" }, { status: 403 })
      }
      try {
        const scoped = await Promise.all(sources.map((source) => source.workflowScoped
          ? resolveTenantReportSource(supabase, tenantId!, source.key, { workflow_id: workflowId })
          : source))
        return NextResponse.json({ sources: scoped.filter(Boolean) })
      } catch (error: any) {
        return NextResponse.json({ error: error?.message ?? 'Workflow not found' }, { status: 404 })
      }
    }

    return NextResponse.json({ sources })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load data sources' }, { status: 500 })
  }
}
