# Choosing realtime

Realtime pushes live updates to open pages: the task list and queue, a
task's subtasks and timeline, the notification bell and the live log tail.
Every change names only the table, the operation and the row ids. The page
then re-reads what it shows through the normal APIs, so nobody sees a row
they couldn't read.

| Option | `REALTIME_PROVIDER` | On-prem | AWS | Azure | Google Cloud | Switch |
|---|---|---|---|---|---|---|
| Supabase Realtime (`postgres_changes`) | `supabase` (default) | — | — | — | — | config |
| Built-in Server-Sent Events over LISTEN/NOTIFY | `sse` | yes | yes | yes | yes | config |

## When to pick which

- **Supabase Realtime** when the database is on Supabase. It is part of
  the same Supabase project.
- **SSE** everywhere else. It needs no broker and no extra service, works
  with any number of app instances, and works with the Supabase database
  too. If you plan to move the database later, switching realtime early is
  a good first step.

## Rules

- **SSE works with any database.** It needs one session-mode connection
  per app instance for `LISTEN`: `REALTIME_DATABASE_URL`, else
  `DATABASE_URL`. That can be a direct connection or Supabase's session
  pooler on port 5432, but not a transaction-mode pooler.
- Apply migration `20261105000000_realtime_notify.sql` first. It is safe
  on every install.
- Without a connection string, SSE falls back to polling every 2 seconds.
- Open tabs keep the old provider until they reload.
- Proxies must allow long-lived responses. A heartbeat goes out every 15
  seconds, and the browser reconnects with `Last-Event-ID`.

```bash
usertasks-admin switch realtime --to sse --yes
```

Reference: [Realtime](../infrastructure.md#realtime).
