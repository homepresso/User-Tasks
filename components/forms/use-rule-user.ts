'use client'

import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { isAnonymousSource, useFormLookupSource } from './lookup-field'

/**
 * The signed-in person as form rules read them — `user.id`, `user.email`,
 * `user.name`, `user.roles` and `user.teams` (role / team names, slugs and
 * ids; lib/services/form-rule-user.ts). One cached read per page (shared
 * with the rules runtime). Public form links: null (no one is signed in —
 * `user.roles` reads as empty). The server never takes this from the
 * browser: it judges rules with its own view of the person.
 */
export type RuleUser = { id: string | null; email: string | null; name: string | null; roles?: string[]; teams?: string[] } | null

export function useRuleUser(enabled: boolean): RuleUser {
  const source = useFormLookupSource()
  const { data = null } = useQuery({
    queryKey: ['form-rule-user'],
    enabled: enabled && !isAnonymousSource(source),
    staleTime: 5 * 60_000,
    queryFn: async () => ((await serverRead('forms.ruleUser')).data ?? null) as RuleUser,
  })
  return data
}
