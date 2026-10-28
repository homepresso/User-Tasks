import { NextResponse } from 'next/server'
import { buildStaticMcpCategorySummary } from '@/lib/mcp/metadata'

// Keeps `lib/mcp/metadata` (which transitively imports every
// connector SDK via the tool registry) off the client bundle.
// The Settings → MCP page fetches the summary here instead of
// importing `buildStaticMcpCategorySummary` directly.
export const runtime = 'nodejs'
export const dynamic = 'force-static'

export async function GET() {
  return NextResponse.json({ categories: buildStaticMcpCategorySummary() })
}
