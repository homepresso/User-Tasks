# Invoice three-way match

Match invoices to purchase orders and goods receipts, pay what matches and route exceptions to AP.

## What's inside

- **Invoice three-way match** workflow (headless: started by your AP / OCR system)
- **Match tolerance** decision table (exact match, tolerance, high-risk vendors, large variances)
- **ERP** REST integration with *Get purchase order*, *Get goods receipts*, *Schedule payment* and *Update invoice status*
- Two vendor email templates: credit note request and invoice rejected

## After installing

1. Complete setup: the ERP base URL and API token, and the default AP clerk.
2. Adjust the tolerance rules to your policy.
3. Post invoices from your capture system:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"invoice_number":"INV-55410","vendor_id":"V-2001","po_number":"PO-4500123","invoice_total":11500,"currency":"NZD","invoice_date":"2026-10-20","lines":[{"line":1,"quantity":200,"unit_price":12.5}]}}'
```

## New in 1.1.0

- **Resolve match exception** has Approve variance / Request credit note / Reject buttons, a header and a grid.
