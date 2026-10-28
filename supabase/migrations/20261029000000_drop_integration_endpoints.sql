-- Perf phase 6: drop the legacy integration_endpoints table.
--
-- Endpoints were the pre-references way to describe calls on an integration;
-- nothing in the engine, API, MCP or UI reads them any more (references and
-- objects replaced them). integration_references.endpoint_id pointed at the
-- table (ON DELETE SET NULL) and was never set by current code; it goes too.
-- Dropping the table also drops its policies, trigger, index and grants.

ALTER TABLE IF EXISTS public.integration_references
  DROP CONSTRAINT IF EXISTS integration_references_endpoint_id_fkey;
ALTER TABLE IF EXISTS public.integration_references
  DROP COLUMN IF EXISTS endpoint_id;

DROP TABLE IF EXISTS public.integration_endpoints CASCADE;
