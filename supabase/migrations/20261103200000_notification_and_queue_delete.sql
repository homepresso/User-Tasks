-- Deleting a notification from the bell did nothing: `notifications` had
-- SELECT / INSERT / UPDATE policies but no DELETE policy, so the browser's
-- `.delete()` matched 0 rows and PostgREST reported success.
--
-- A signed-in user may delete their OWN notifications, in workspaces they are
-- an active member of (same initplan style as 20261027000000_rls_initplan.sql).
-- Nobody can delete another user's notifications, and a notification left in
-- a workspace the user no longer belongs to stays put (retention cleans it).
--
-- workflow_queue deliberately gets no DELETE policy: queue jobs are deleted
-- server-side by the deleteQueueJob server action (app/actions/workflow-queue.ts),
-- which checks workflows.activate and refuses jobs a worker holds.

DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_delete ON public.notifications FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
  );
