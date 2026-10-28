# Scheduled data reconciliation

Daily order-to-invoice reconciliation with an exceptions table and a summary.

## What's inside

- **Order-invoice reconciliation** workflow (daily at 05:30 UTC)
- **Order system**, **Billing API** and **Ops webhook** REST integrations
- **Reconciliation exceptions** data table
- **Reconciliation summary** email template

## After installing

1. Complete setup: the base URLs and tokens.
2. Set finance_ops_email and amount_tolerance on the workflow variables.
3. To reconcile a specific day now, run the workflow with `{"as_of":"2026-10-25"}`.
