/**
 * Memory Docker needs to build the UserTasks image (`npm run stack -- up`,
 * `docker compose build`), in GB. `next build`'s Turbopack compile peaked at
 * 10.1–11.0 GB (resident) on a 10-core machine, and was killed inside Docker
 * with 4 GB free even on 2 cores: see docs/deployment-profiles.md#memory.
 * Used by the stack's pre-build check (scripts/stack-helpers.ts), the
 * requirements and troubleshooting docs and the /open-source page.
 */
export const DOCKER_BUILD_MEMORY_GB = 10
