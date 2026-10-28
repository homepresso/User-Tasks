# Purchase requisition to PO

Requisition, approval, quotes and an issued purchase order, driven by your purchasing policy.

## What's inside

- **Purchase requisition** workflow (starts from a form: its inputs are the requisition)
- **Purchasing approval** decision table (approver level, quotes required)
- **Approved suppliers** data table with seven sample suppliers
- **ERP** REST integration with *Create purchase order*
- Three email templates: PO raised (requester), purchase order (supplier), not approved

## After installing

1. Complete setup: the ERP base URL and API token, the default manager and buyer.
2. Replace the sample suppliers and adjust the policy thresholds.
3. Start a requisition from **Automations → Workflows → Run**, or from your intranet:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"requester_email":"alex.morgan@example.com","item_description":"Laptops","quantity":10,"unit_price":1450,"supplier":"Contoso Computing","category":"it_hardware","cost_centre":"CC-310","justification":"New starters"}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Approve requisition** has Approve / Reject buttons, a header and a grid.
- **Collect quotes** has Supplier selected / Cancel requisition buttons; the selected supplier is a lookup into **Approved suppliers** that fills the supplier id, payment terms and orders email.
