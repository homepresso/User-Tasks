# Lead routing and enrichment

Enrich, score and route inbound leads to the right owner in seconds.

## What's inside

- **Lead routing** workflow (headless: started by your website or forms tool)
- **Lead score & routing** decision table (segment, score, priority)
- **Territories** data table with ten sample territories and a Rest of world fallback
- Three REST integrations: **Enrichment service** (*Enrich company*), **CRM** (*Create lead*) and **Marketing platform** (*Add to nurture list*)
- One email template: new lead assigned

## After installing

1. Complete setup: base URLs and credentials for the three integrations.
2. Put your reps in the Territories table and tune the scoring rules.
3. Post leads from your forms tool:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"email":"ana.ruiz@tailwindtraders.example.com","first_name":"Ana","company":"Tailwind Traders","country":"AU","source":"demo_request"}}'
```
