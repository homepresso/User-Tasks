# Employee offboarding

Leaver to closed record: access revocation on the right day, equipment recovery, final pay, exit interview and the HR termination.

## What's inside

- **Employee offboarding** workflow (starts from a form: its inputs are the leaver form)
- **Offboarding controls** decision table (reason × privileged access → revocation timing, exit interview, garden leave)
- **HR system** integration with *Get employee* and *Record termination*
- Three email templates: equipment outstanding, offboarding complete (manager) and leaving information (leaver)

## After installing

1. Complete setup: the HR system base URL and API token, and the default IT owner, payroll officer and HR partner.
2. Review the control rules with your security team.
3. Start an offboarding from **Automations → Workflows → Run**, or from your HR portal:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"employee_id":"E-1042","last_working_day":"2026-11-27","reason":"resignation","rehire_eligible":true}}'
```
