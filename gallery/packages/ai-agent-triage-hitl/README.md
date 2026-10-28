# AI ticket triage with human review

An AI agent triages every ticket and drafts the reply; the rules decide when a person checks it first.

## What's inside

- **AI ticket triage** workflow (headless: started by your helpdesk)
- **Ticket triage agent** (category, urgency, sentiment, summary, suggested reply, confidence)
- **Triage routing** decision table (auto-reply or review, queue, priority)
- **AI model (OpenAI-compatible)** integration and a **Helpdesk** integration with *Post reply* and *Update ticket*
- One email template: ticket escalated

## After installing

1. Complete setup: the model endpoint and key, the helpdesk URL and token, and the default reviewer.
2. Review the agent's instructions and the routing rules.
3. Post tickets from your helpdesk:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"ticket_id":"T-48213","subject":"Charged twice","body":"Two charges for October…","customer_email":"lee.chen@example.com","tier":"pro"}}'
```
