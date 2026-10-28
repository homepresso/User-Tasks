'use client'

import { createContext, useContext, useMemo } from 'react'
import type { Permission } from './permissions'

interface PermissionsContextValue {
  permissions: Set<string>
  userId: string | null
  can: (permission: Permission) => boolean
  canAny: (...permissions: Permission[]) => boolean
}

const PermissionsContext = createContext<PermissionsContextValue>({
  permissions: new Set(),
  userId: null,
  can: () => false,
  canAny: () => false,
})

export function PermissionsProvider({
  permissions: permArray,
  userId,
  children,
}: {
  permissions: string[]
  userId?: string | null
  children: React.ReactNode
}) {
  const value = useMemo(() => {
    const perms = new Set(permArray)
    return {
      permissions: perms,
      userId: userId ?? null,
      can: (p: Permission) => perms.has(p),
      canAny: (...ps: Permission[]) => ps.some(p => perms.has(p)),
    }
  }, [permArray, userId])

  return (
    <PermissionsContext value={value}>
      {children}
    </PermissionsContext>
  )
}

export function usePermissions() {
  return useContext(PermissionsContext)
}
