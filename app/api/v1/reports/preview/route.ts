import { createClient, getCachedUser } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, requireApiPermission } from "@/lib/api-auth";
import { normalizeReportConfig } from "@/lib/report-config";
import { executeReportPreview } from "@/lib/mcp/tools/reports";
import { executeReportCharts } from "@/lib/report-charts-server";
import { validTimeZone } from "@/lib/report-charts";
import { getUserPermissions } from "@/lib/permissions-server";

export async function POST(request: NextRequest) {
  try {
    const apiAuth = await validateApiKey(request);
    let supabase: any;

    if (apiAuth.success) {
      const forbidden = requireApiPermission(apiAuth, "reports.view");
      if (forbidden) return forbidden;
      supabase = apiAuth.supabase;
    } else {
      supabase = await createClient();
      const user = await getCachedUser();
      if (!user)
        return NextResponse.json(
          { error: "Not authenticated" },
          { status: 401 },
        );
    }

    const body = normalizeReportConfig(await request.json());
    const dataSource = String(body.data_source ?? "").trim();
    if (!dataSource) {
      return NextResponse.json(
        { error: "Missing data source" },
        { status: 400 },
      );
    }

    let tenantId = apiAuth.success ? apiAuth.tenantId : undefined;
    let profileTimezone: string | null = null;
    if (!tenantId) {
      const user = await getCachedUser();
      const { data: profile } = await supabase
        .from("users")
        .select("current_tenant_id, tenant_id, timezone")
        .eq("id", user?.id)
        .single();
      tenantId = profile?.current_tenant_id ?? profile?.tenant_id;
      profileTimezone = profile?.timezone ?? null;
    }
    if (!tenantId)
      return NextResponse.json({ error: "No tenant" }, { status: 403 });

    // Session callers: their roles in the current workspace (agent runs
    // need agents.view, workflow variable columns workflows.view).
    const permissions = apiAuth.success ? apiAuth.permissions : await getUserPermissions();
    // An API key's data table scope applies to reports too (as on data_rows_*).
    const scopedTableIds = apiAuth.success ? apiAuth.scopes?.table_ids : undefined;
    // Summary chart time buckets: ?timezone= (the viewer's browser zone),
    // else the user's profile zone, else UTC.
    const timezone =
      validTimeZone(request.nextUrl.searchParams.get("timezone")) ??
      validTimeZone(profileTimezone) ??
      "UTC";

    try {
      const [preview, charts] = await Promise.all([
        executeReportPreview(supabase, tenantId, body as any, scopedTableIds, permissions),
        body.charts?.length
          ? executeReportCharts(supabase, tenantId, body as any, { scopedTableIds, permissions, timezone })
          : Promise.resolve(null),
      ]);
      return NextResponse.json({
        data: preview.data,
        total: preview.total,
        available_columns: preview.available_columns,
        joins: preview.joins,
        ...(charts ? { charts, timezone } : {}),
      });
    } catch (error: any) {
      return NextResponse.json(
        { error: error?.message ?? "Query failed" },
        { status: 400 },
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to preview report" },
      { status: 500 },
    );
  }
}
