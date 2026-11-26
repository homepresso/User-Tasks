-- Indexes for foreign keys checked on task / user deletes (QA perf pass 2026-11-24).
--
-- Deleting a task (or a task tree: one FK check per deleted task) runs each
-- referencing table's FK check. notifications.task_id (ON DELETE CASCADE),
-- form_submissions.task_id, workflow_queue.task_id and
-- dead_letter_events.task_id had no index, so each deleted task scanned
-- those tables. Measured on the QA stack with 200,000 notifications:
-- deleting a 121-task tree took 2.72 s (1.90 s in the notifications check
-- alone, linear in the table: ~19 s at 2M rows); with these indexes 0.35 s.
-- custom_table_rows.created_by: deleting a user scanned every data table
-- row (200k-row table on the QA stack).
--
-- Partial (non-null) indexes keep them small. On large live tables build them
-- CONCURRENTLY instead (the QA stack got them that way). Additive, idempotent.

create index if not exists idx_notifications_task on public.notifications (task_id) where task_id is not null;
create index if not exists idx_form_submissions_task on public.form_submissions (task_id) where task_id is not null;
create index if not exists idx_workflow_queue_task on public.workflow_queue (task_id) where task_id is not null;
create index if not exists idx_dead_letter_events_task on public.dead_letter_events (task_id) where task_id is not null;
create index if not exists idx_custom_table_rows_created_by on public.custom_table_rows (created_by) where created_by is not null;
