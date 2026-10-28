# Choosing a cache

The cache store holds small, short-lived state that every app instance has
to agree on: rate limits (API keys, the OAuth token endpoint, sign-in and
reset, agent runs, signups), invalidations (a revoked key or token, a
changed setting) and idempotency claims for task ingestion. None of it is
the source of truth: losing the store resets rate-limit windows and makes
caches reload, nothing more.

| Option | `CACHE_PROVIDER` | On-prem | AWS | Azure | Google Cloud | Switch |
|---|---|---|---|---|---|---|
| In-process memory | `memory` (default) | yes | yes | yes | yes | config |
| PostgreSQL (UNLOGGED table in the app database) | `postgres` | yes | yes | yes | yes | config |
| Redis, Valkey, KeyDB, Dragonfly | `redis` | yes | native: ElastiCache / MemoryDB with IAM auth (`CACHE_REDIS_AUTH=aws_iam`), or an AUTH token | native: Azure Cache for Redis / Azure Managed Redis with Entra ID | native: Memorystore (IAM for Valkey) | config |

## When to pick which

- **Memory** for a single app instance.
- **Postgres** as soon as there is more than one instance (or a separate
  worker). There's nothing extra to run, and it's the right default for
  most installs.
- **Redis / Valkey** when you already run one, or at high request rates.

## Rules

- **With `memory`, each replica counts on its own:** N replicas allow up
  to N times every limit, and other replicas see a revoked credential only
  when their credential cache expires (60 seconds).
- Redis Cluster mode is not supported. Use a non-clustered (primary and
  replica) instance.
- If a shared store is unreachable, rate limits fall back to per-instance
  counting and credentials are re-checked against the database.
- Several installs can share one Redis with different `CACHE_KEY_PREFIX`
  values.

```bash
usertasks-admin switch cache --to postgres --yes
usertasks-admin switch cache --to redis --set redis_url=rediss://cache.internal:6379 --yes
```

Reference: [Cache](../infrastructure.md#cache).
