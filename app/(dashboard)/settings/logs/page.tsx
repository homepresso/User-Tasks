import { LogsView } from './logs-view'

/**
 * Live Logs viewer — real-time tail across every observability table
 * in the app. See hooks/use-live-logs.ts for the stream logic.
 *
 * Page shell is trivial; all interactivity lives in the client
 * component. Opens paused so landing on /settings/logs doesn't
 * unnecessarily open a realtime websocket.
 */
export default function LogsPage() {
  return <LogsView />
}
