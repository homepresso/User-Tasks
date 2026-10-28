# GDPR data subject requests

Access, erasure, rectification, portability and objection requests, handled inside the statutory deadline.

## What's inside

- **Data subject request** workflow (starts from a form: its inputs are the request form)
- **Statutory deadlines** decision table (EU GDPR, UK GDPR, CCPA, other)
- **DSAR register** data table
- **CRM**, **Billing system** and **Support desk** REST integrations, each with a search and an erasure reference
- Three email templates: identity check, not verified and the final response

## After installing

1. Complete setup: the three systems' base URLs and tokens, the privacy officer and the DPO.
2. Review the deadline rules with your legal team.
3. Log a request from **Automations → Workflows → Run**, or from your privacy form:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"requester_name":"Robin James","requester_email":"robin.james@example.com","request_type":"access","jurisdiction":"EU-GDPR"}}'
```

The deadline rules are a starting point, not legal advice.

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Verify identity** has Verified / Need more info / Reject buttons; **DPO review** has Approve response / Send back; **Revise response** has Resubmit. Each has a header and a grid.
