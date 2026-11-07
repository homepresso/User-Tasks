-- Workflow variables in reports: a bounded, redacted copy of a run's
-- variables, written by the engine when the run completes, fails or pauses
-- (lib/workflow-run-variables.ts): start-form inputs, task form values
-- (task_data.*), Form submitted values (form.*) and step / Set Variable
-- outputs — never system keys, credential-like keys, file bytes or lists of
-- objects; capped at ~32 KB per run.
--
-- Reports read it as `vars.<name>` columns of the "Workflow runs" source
-- (filters on text use variables->>'name'; numeric comparisons, grouping and
-- aggregation run in the report service), so no index beyond the existing
-- (workflow_id, started_at) one is needed (no GIN index: reports never use containment).
--
-- Nothing is backfilled: runs that finished before this migration (and before
-- the code that writes the column is deployed) have no stored variables and
-- show blanks in variable columns. The column follows the run row's
-- lifecycle (deleted with the run / its workflow).
--
-- Adds a nullable column only: safe to apply before or after the code (the
-- engine drops the write until the column exists).
ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS variables jsonb;

COMMENT ON COLUMN public.workflow_runs.variables IS
  'Reportable run variables (bounded, redacted copy written on completion / failure / pause; lib/workflow-run-variables.ts).';
