"use client"

import { ProcessesHubView } from '@/components/reports/lazy-charts'

/**
 * Level 1 of the workflow reports drill-down — the "Processes Hub".
 *
 * Shows a top-row of KPI tiles (total workflows, active instances, process
 * errors, active tasks, avg duration), a "Processes Started" trend chart,
 * and a fully searchable / filterable / sortable table of every workflow
 * with aggregated stats per workflow.
 *
 * Clicking a row drills into Level 2: /reports/workflows/[workflowId].
 *
 * This page replaces the old aggregate-only WorkflowReportView which was
 * useful but didn't give users a way to pivot into a single workflow.
 */
export default function WorkflowReportPage() {
  // Data (SQL aggregates, no per-run traces) is loaded by the hub itself.
  return <ProcessesHubView />
}
