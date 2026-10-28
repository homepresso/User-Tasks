# Access request and provisioning

Risk-based access approvals with automatic provisioning and revocation of time-boxed access.

## What's inside

- **Access request** workflow (starts from a form: its inputs are the request form)
- **Revoke access on expiry** sub-workflow (waits 30 or 90 days, then revokes the grant)
- **Access approval path** decision table
- **Application catalogue** data table with seven sample applications
- **Identity platform** REST integration with *Get user*, *Create access grant* and *Revoke access grant*
- Three email templates: granted, declined and expired

## After installing

1. Complete setup: the identity platform's base URL and token, and the default approvers.
2. Edit the catalogue to your applications and groups, and the approval rules to your policy.
3. Start a request from **Automations → Workflows → Run**, or from your portal:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"requester_name":"Morgan Ellis","requester_email":"morgan.ellis@example.com","employee_id":"E-2040","application":"Finance ERP","role":"Accounts payable clerk","justification":"Quarter-end cover","duration":"90 days"}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Manager approval**, **Application owner approval** and **Security approval** have Approve / Reject buttons, headers and grids.
- The owner's provisioning group is a lookup into **Application catalogue** that shows the risk level and whether the role is privileged.
