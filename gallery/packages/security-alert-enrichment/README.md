# Security alert enrichment

Headless SIEM alert triage: enrich, decide, then close, investigate or contain.

## What's inside

- **Security alert enrichment** workflow (headless: started by your SIEM)
- **Alert disposition** decision table (IP score, asset criticality, privileged user, severity → auto-close / investigate / contain)
- Five REST integrations: **Threat intelligence** (*IP reputation*), **Directory** (*Get user*), **CMDB** (*Get asset*), **SIEM** (*Update alert*) and **Security operations (SOAR / EDR)** (*Create case*, *Isolate host*)

## After installing

1. Complete setup: base URLs and credentials for the five integrations, the SOC analyst and the SOC lead.
2. Review the disposition thresholds.
3. Create an inbound webhook for the workflow, or post alerts to the start API:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"alert_id":"ALR-559102","rule_name":"Multiple failed sign-ins followed by success","source_ip":"203.0.113.45","username":"d.whitfield","hostname":"fin-ws-0417","severity":"high"}}'
```
