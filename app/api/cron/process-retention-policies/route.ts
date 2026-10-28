import { NextRequest, NextResponse } from "next/server"
import { requireServiceAuth } from "@/lib/cron-auth"
import { processRetentionPolicies } from "@/lib/jobs/retention"

/** Daily retention pass (logic in lib/jobs/retention.ts). */
export async function GET(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  try {
    return NextResponse.json(await processRetentionPolicies())
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}

export { GET as POST }
