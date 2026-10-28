# Release notes: realtime provider

Live updates can now run without Supabase Realtime. Nothing changes unless
you opt in: the default stays Supabase Realtime.

## Added

- **`REALTIME_PROVIDER=sse`.** The app pushes live updates (task lists, the
  task queue, tasks you assigned, task timelines, the notification bell and
  the live log tail) over Server-Sent Events from
  `/api/internal/realtime`, fed by Postgres `LISTEN/NOTIFY`. One connection
  per browser tab; each app instance listens on its own, so multiple
  instances work without a broker. Changes carry ids only and go only to
  users who could read the row; pages re-read through the normal APIs. See
  [Infrastructure and providers](infrastructure.md#realtime).
- **Migration `20261105000000_realtime_notify.sql`** adds statement-level
  NOTIFY triggers on the realtime tables. They stay idle unless an SSE
  listener is active, and the `supabase_realtime` publication is unchanged.
- **New variables:** `REALTIME_DATABASE_URL` (session-mode connection for
  LISTEN; falls back to `DATABASE_URL`, then `SUPABASE_DB_URL`, then to
  polling the tables every 2 s).

## Changed

- Every live-updating hook now subscribes through one `useRealtime` hook and
  the realtime provider; with the default provider the Supabase channels and
  filters are the same as before (the live log tail now uses one channel per
  source instead of one shared channel).
- The browser learns the realtime provider from the runtime public config
  (`realtimeProvider`, only present when it isn't `supabase`); in `sse` mode
  the browser never loads supabase-js for realtime.

## Upgrade

Apply the migration. To switch, set `REALTIME_PROVIDER=sse` (and
`REALTIME_DATABASE_URL` if `DATABASE_URL` isn't set) and restart; Supabase
Realtime can then be turned off for the project.
