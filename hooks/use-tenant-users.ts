import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'

export function useTenantUsers() {
  return useQuery({
    queryKey: ['tenant-users'],
    queryFn: () => serverQuery('settings.tenantUsers'),
  })
}
