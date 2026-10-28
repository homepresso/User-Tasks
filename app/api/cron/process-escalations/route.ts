import { NextRequest, NextResponse } from "next/server"
import { requireServiceAuth } from "@/lib/cron-auth"
import { processTaskEscalations } from "@/lib/jobs/escalations"

/** Cron endpoint: process task escalations (logic in lib/jobs/escalations.ts). */
export async function POST(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  try {
    return NextResponse.json(await processTaskEscalations())
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

// Vercel crons issue GET; expose the same handler so the scheduled job reaches it.
export { POST as GET }
