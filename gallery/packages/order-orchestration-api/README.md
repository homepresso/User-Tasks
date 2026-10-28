# Order orchestration API

One synchronous call from the storefront: validate, price, fraud-screen, reserve, authorise and ship.

## What's inside

- **Order orchestration** workflow (middleware: the caller waits for the JSON response)
- **Manual fraud review** sub-workflow (started in the background for flagged orders)
- **Fraud screening** decision table (accept, review, reject and a risk score)
- Three REST integrations: **Inventory API**, **Payments API** and **Fulfilment API** (six references)

## After installing

1. Complete setup: the three APIs' base URLs and tokens, and the fraud reviewer.
2. Tune the fraud rules and the tax and shipping variables.
3. Create a middleware webhook for the workflow and call it from checkout. The response looks like:

```json
{ "result": "accepted", "order_id": "SO-100482", "order_status": "confirmed", "total": 162.38,
  "reservation_id": "RSV-771204", "authorization_id": "AUTH-5Q2K91", "shipment_id": "SHP-310588",
  "estimated_delivery": "2026-10-29", "needs_review": false }
```

Send a payment token reference from your payment provider, never card numbers.
