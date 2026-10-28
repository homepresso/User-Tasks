import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, requireServiceAuth } from '@/lib/cron-auth'
import { processDeploymentQueue } from '@/lib/github-sync/deploy'

export const maxDuration = 300

/** GitHub sync deployment worker — claims pending github_deployments rows. */
export async function POST(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized
  const supabase = createServiceClient()
  const workerId = `deploy-${Math.random().toString(36).slice(2, 10)}`
  const processed = await processDeploymentQueue(supabase as any, workerId)
  return NextResponse.json({ ok: true, processed })
}

export { POST as GET }
