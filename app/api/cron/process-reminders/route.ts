import { NextRequest, NextResponse } from "next/server"
import { requireServiceAuth } from "@/lib/cron-auth"
import { processTaskReminders } from "@/lib/jobs/reminders"

/** Cron endpoint: process task reminders (logic in lib/jobs/reminders.ts). */
export async function POST(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  try {
    return NextResponse.json(await processTaskReminders())
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

// Vercel crons issue GET; expose the same handler so the scheduled job reaches it.
export { POST as GET }
