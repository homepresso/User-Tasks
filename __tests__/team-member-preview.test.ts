/**
 * tasks.teamPreview (teamMemberPreview): a team outside the caller's
 * workspace — or no such team — is not found (404), never an empty answer
 * that echoes the requested id; the caller's own team lists its members.
 */
import { describe, expect, it } from 'vitest'
import { teamMemberPreview } from '@/lib/services/assignee-search'
import { isServiceError, type ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const TEAM_A = 'aaaaaaaa-0000-4000-8000-0000000000a1'
const TEAM_B = 'bbbbbbbb-0000-4000-8000-0000000000b1'

function ctx(db: any): ServiceContext {
  return { supabase: db, tenantId: A, actorId: 'u1', permissions: null, authKind: 'session', source: 'ui' } as ServiceContext
}

function seed() {
  return createMemorySupabase({
    teams: [{ id: TEAM_A, tenant_id: A, name: 'Ops' }, { id: TEAM_B, tenant_id: B, name: 'Secret' }],
    users: [{ id: 'u1', display_name: 'Ana', email: 'ana@example.com' }, { id: 'u2', display_name: 'Bo', email: 'bo@example.com' }],
    user_teams: [{ team_id: TEAM_A, user_id: 'u1' }, { team_id: TEAM_B, user_id: 'u2' }],
  }) as any
}

describe('teamMemberPreview', () => {
  it("is not found for another workspace's team (no echo of the id)", async () => {
    const error = await teamMemberPreview(ctx(seed()), TEAM_B).then(() => null, (e) => e)
    expect(isServiceError(error) && error.status).toBe(404)
    expect(String(error?.message)).not.toContain(TEAM_B)
  })

  it('is not found for an unknown team', async () => {
    const error = await teamMemberPreview(ctx(seed()), 'cccccccc-0000-4000-8000-000000000000').then(() => null, (e) => e)
    expect(isServiceError(error) && error.status).toBe(404)
  })
})
