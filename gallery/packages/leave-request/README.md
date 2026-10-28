# Leave request

Leave from request to booking: balance check, leave-type rules, an approval policy, manager and HR review and the HR booking.

## What's inside

- **Leave request** workflow (starts from a form: its inputs are the leave form)
- **Leave approval** decision table (type, days, balance after, notice → auto-approve, approver, HR)
- **Leave types** data table with five sample leave types
- **HR system** integration with *Get leave balance*, *Create leave booking* and *Add team calendar entry*
- Two email templates: approved and declined

## After installing

1. Complete setup: the HR system base URL and API token, and the default manager, HR partner and employee contact.
2. Adjust the leave types and approval rules to your policy.
3. Start a request from **Automations → Workflows → Run**, or from your intranet:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"employee_id":"E-1001","leave_type":"annual","start_date":"2026-12-14","end_date":"2026-12-18","days":5}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Approve leave** has Approve / Decline / Ask for change buttons, a header and a grid.
- **Confirm leave arrangements** (HR) has Confirm / Decline buttons and a **Leave types** lookup that fills whether the leave is paid and needs a certificate.
- **Change leave request** has Resubmit / Withdraw buttons.
