import { getServiceDb } from '@/lib/providers/db'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')
  const tenantId = request.nextUrl.searchParams.get('tenant_id')
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })

  const supabase = getServiceDb()

  const { data } = await supabase.from('tenants').select('id').eq('slug', slug).is('deleted_at', null)
  const existing = (data ?? []).filter((t: any) => t.id !== tenantId)

  return NextResponse.json({ available: existing.length === 0, slug })
}
