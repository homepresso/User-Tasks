# Test images for scripts/install-e2e.sh, derived from an installed release image:
#   new:          + one additive migration (VARIANT=new)
#   bad-start:    + the migration, and a server that exits at once (health check fails → code rollback)
#   bad-migrate:  + a migration that fails (nothing is switched)
ARG BASE
FROM ${BASE} AS new
COPY --chown=nextjs:nodejs 20991231000000_install_upgrade_fixture.sql /app/supabase/migrations/

FROM new AS bad-start
CMD ["node", "-e", "console.error('install-e2e: this image fails on purpose'); process.exit(1)"]

FROM new AS bad-migrate
COPY --chown=nextjs:nodejs 20991231000100_install_upgrade_failing.sql /app/supabase/migrations/
