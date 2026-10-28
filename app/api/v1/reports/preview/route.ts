import { createClient, getCachedUser } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, requireApiPermission } from "@/lib/api-auth";
import { normalizeReportConfig } from "@/lib/report-config";
import { executeReportPreview } from "@/lib/mcp/tools/reports";

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
    if (!tenantId) {
      const user = await getCachedUser();
      const { data: profile } = await supabase
        .from("users")
        .select("current_tenant_id, tenant_id")
        .eq("id", user?.id)
        .single();
      tenantId = profile?.current_tenant_id ?? profile?.tenant_id;
    }
    if (!tenantId)
      return NextResponse.json({ error: "No tenant" }, { status: 403 });

    try {
      const preview = await executeReportPreview(
        supabase,
        tenantId,
        body as any,
      );
      return NextResponse.json({
        data: preview.data,
        total: preview.total,
        available_columns: preview.available_columns,
        joins: preview.joins,
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
