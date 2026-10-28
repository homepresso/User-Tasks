# Month-end close checklist

A scheduled month-end close: open the period, issue every checklist task, collect evidence and keep a close log.

## What's inside

- **Month-end close** workflow (scheduled: 06:00 on the first of the month)
- **Close task** sub-workflow (one run per checklist task: assignment, evidence rule, logging)
- **Close checklist** data table with twelve sample tasks, and the **Close log** table
- **ERP** REST integration with *Open close period*
- One email template: close started

## After installing

1. Complete setup: the ERP base URL and API token, and the controller who receives the tasks.
2. Replace the sample checklist rows with your close tasks.
3. To re-run a period by hand, start **Month-end close** with `period`:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"period":"2026-09","entity":"NZ01"}}'
```
