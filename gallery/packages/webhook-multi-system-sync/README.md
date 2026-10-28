# Webhook multi-system sync

Fan a CRM "account updated" webhook out to the ERP, billing and support desk, with a sync log.

## What's inside

- **Account sync** workflow (inbound webhook, headless)
- **ERP**, **Billing platform** and **Support desk** REST integrations, one reference each
- **Sync log** data table (one row per target per webhook)

## After installing

1. Complete setup: base URL and token for each of the three systems.
2. Create an inbound webhook for **Account sync** and register it in your CRM.
3. Test it:

```bash
curl -X POST "$USERTASKS_URL/api/webhooks/inbound?hook=<slug>" \
  -H "Authorization: Bearer <webhook secret>" -H "Content-Type: application/json" \
  -d '{"account_id":"ACC-20117","account_name":"Harbour Logistics Ltd","billing_address":{"line1":"14 Quay Street","city":"Auckland","postcode":"1010","country":"NZ"},"tax_id":"NZ-123-456-789","account_status":"active","owner_email":"jamie.cole@example.com","updated_at":"2026-10-26T07:14:02Z"}'
```
