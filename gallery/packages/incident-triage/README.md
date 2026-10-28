# Incident triage

Alert-to-incident with deduplication, a priority matrix and on-call acknowledgement with escalation.

## What's inside

- **Incident triage** workflow (headless: started by your monitoring tool)
- **Incident priority** decision table (service tier × severity → P1-P4, response and resolution targets)
- **Service owners** data table with six sample services
- **IT service management** REST integration with *Find open incident*, *Create incident* and *Update incident*
- One email template: major incident notice for the business owner

## After installing

1. Complete setup: the ITSM base URL and token, the default on-call engineer and the incident manager.
2. Fill in the Service owners table and review the priority matrix.
3. Create an inbound webhook for the workflow, or post alerts to the start API:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"service":"order-service","summary":"Checkout error rate above 5%","severity_hint":"major","source":"alertmanager","host":"order-service-7c9f6d","dedupe_key":"order-service:error-rate"}}'
```
