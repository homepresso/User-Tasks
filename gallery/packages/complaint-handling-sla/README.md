# Complaint handling with SLAs

Complaint to resolution with tier-based SLA targets, escalation, compensation approval and CRM case tracking.

## What's inside

- **Complaint handling** workflow (starts from a form: its inputs are the complaint form)
- **Complaint SLA matrix** decision table (category × severity × tier → response hours, resolution days, handler level, compensation limit)
- **CRM** REST integration with *Find customer by email*, *Create case* and *Resolve case*
- Two email templates: acknowledgement and resolution

## After installing

1. Complete setup: the CRM base URL and API token, the default handler and the supervisor.
2. Tune the SLA matrix to your service levels.
3. Log a complaint from **Automations → Workflows → Run**, or from your contact-centre tool:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"customer_email":"taylor.brooks@example.net","order_number":"SO-558201","category":"delivery","severity":"high","description":"Order arrived late and damaged","channel":"phone"}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Investigate and resolve** has Resolved / Needs supervisor buttons; **Supervisor approval** has Approve / Send back. Both have headers and grids.
