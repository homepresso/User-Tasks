# Change management with CAB

RFC to closure: risk scoring, CAB / emergency CAB approval, implementation and post-implementation review.

## What's inside

- **Change request** workflow (starts from a form: its inputs are the RFC)
- **Change risk** decision table (type and risk answers → risk level, approval path, freeze check)
- **IT service management** REST integration with *Create change request* and *Update change request*
- Three email templates: approved, rejected and closed

## After installing

1. Complete setup: the ITSM base URL and token, the CAB chair, ECAB approver, implementer and change manager.
2. Review the risk rules and the ITSM state names.
3. Submit an RFC from **Automations → Workflows → Run**, or from your portal:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"requester_name":"Alex Morgan","requester_email":"alex.morgan@example.com","change_title":"Upgrade order database","system":"order-db-prod","change_type":"normal","description":"Major version upgrade","customer_impact":"minor","rollback_tested":true,"out_of_hours":true,"window_start":"2026-11-07T22:00:00Z","window_end":"2026-11-08T02:00:00Z","backout_plan":"Fail back to replica"}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **CAB review** and **Emergency CAB review** have Approve / Approve with conditions / Reject (/ Defer) buttons; **Implement change** has Implemented / Rolled back; **Post-implementation review** has Successful / Successful with issues / Unsuccessful. Each has a header and a grid.
