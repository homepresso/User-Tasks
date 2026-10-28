import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err, parsePagination } from '@/lib/api-auth'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'agents.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const { limit, offset } = parsePagination(request.nextUrl.searchParams)
  const activeOnly = request.nextUrl.searchParams.get('active')

  let q = supabase.from('agents' as any).select('id, name, description, model, is_active, tools, role, task, boundaries, output_config, created_at, updated_at', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })

  if (activeOnly === 'true') q = q.eq('is_active', true)
  if (limit) q = q.limit(limit)
  if (offset) q = q.range(offset, offset + (limit ?? 50) - 1)

  const { data, count, error } = await q
  if (error) return err(error.message, 500)
  return ok({ agents: data ?? [], total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'agents.create')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const body = await request.json()
  const { name, description, model, system_prompt, role, task, boundaries, tools, output_config, integration_id, temperature, max_tokens, max_iterations } = body

  if (!name) return err('name is required')

  const { data, error } = await (supabase as any).from('agents').insert({
    tenant_id: tenantId,
    name,
    description: description ?? null,
    model: model ?? 'gpt-4o',
    system_prompt: system_prompt ?? '',
    role: role ?? '',
    task: task ?? '',
    boundaries: boundaries ?? '',
    tools: tools ?? [],
    output_config: normalizeAgentOutputConfig(output_config ?? { variables: [] }),
    integration_id: integration_id ?? null,
    temperature: temperature ?? 0.7,
    max_tokens: max_tokens ?? 4096,
    max_iterations: max_iterations ?? 10,
    is_active: true,
  }).select('*').single()

  if (error) return err(error.message, 500)
  return ok({ agent: data }, 201)
}
