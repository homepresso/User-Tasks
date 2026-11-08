/** Poll interval for a run's process view: fast while it runs, slower while it waits on people, off once finished. */
export function processViewPollMs(status: unknown): number | false {
  if (status === 'running' || status === 'pending' || status === 'queued') return 2_000
  if (status === 'waiting_for_event' || status === 'waiting' || status === 'paused') return 5_000
  return false
}
