# Quote approval with discount tiers

Discount approvals by authority level, with approve, reject and counter-offer at every step.

## What's inside

- **Quote approval** workflow (starts from a form: its inputs are the quote)
- **Discount authority** decision table (auto ≤ 10%, sales manager ≤ 20%, VP sales ≤ 30%, deal desk and CFO above)
- **CPQ system** REST integration with *Record quote approval*
- Three email templates: approved, rejected, counter-offer

## After installing

1. Complete setup: the CPQ base URL and API token, and the four default approvers.
2. Adjust the discount bands to your policy.
3. Submit a quote from **Automations → Workflows → Run**, or from your CPQ:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"quote_id":"Q-2026-0457","customer":"Fourth Coffee","product":"Platform Professional","list_price":60000,"discount_pct":18,"term_months":24,"justification":"Competitive deal","rep_email":"sam.patel@example.com"}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- Each tier (sales manager, VP sales, deal desk, CFO) has Approve / Reject / Counter-offer buttons, a header and a grid.
