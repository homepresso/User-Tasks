import { NextRequest, NextResponse } from 'next/server'
import { processDeletionQueueBatch } from '@/lib/deletion-queue'
import { requireServiceAuth } from '@/lib/cron-auth'

export async function POST(request: NextRequest) {
  const unauthorized = requireServiceAuth(request)
  if (unauthorized) return unauthorized

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    // empty body is fine
  }

  const result = await processDeletionQueueBatch({
    batchSize: body.batch_size ?? 10,
    workerId: body.worker_id,
  })

  return NextResponse.json(result)
}
