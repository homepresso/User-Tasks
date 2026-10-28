import { useQuery, useQueryClient } from "@tanstack/react-query"
import { listMyNotifications } from "@/app/actions/notifications"
import { unwrapAction } from "@/lib/action-result"
import type { Database } from "@/lib/database.types"
import { useRealtime, useRealtimeUserId } from "@/hooks/use-realtime"

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"]

export function useNotifications() {
  const queryClient = useQueryClient()
  const userId = useRealtimeUserId()

  const query = useQuery({
    queryKey: ["notifications"],
    // Read server-side (the user's own 30 newest); realtime below still
    // invalidates this query on changes.
    queryFn: async () => unwrapAction(await listMyNotifications()) as NotificationRow[],
  })

  // Scoped to THIS user's notifications — everyone else's traffic is noise.
  useRealtime("notifications", userId ? { column: "user_id", value: userId } : null, () =>
    queryClient.invalidateQueries({ queryKey: ["notifications"] }))

  const unreadCount =
    query.data?.filter((n: any) => !n.is_read).length ?? 0

  return { ...query, unreadCount }
}
