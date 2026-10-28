# Supplier risk review

Event-driven third-party risk: a fresh rating, a rule-based tier and a procurement review for high-risk suppliers.

## What's inside

- **Supplier risk review** workflow (starts on Suppliers row created / updated)
- **Supplier risk** decision table (eight rules, catch-all last)
- **Suppliers** data table with six sample suppliers
- **Risk intelligence** REST integration with *Get supplier risk rating*
- Two email templates: supplier flagged and decision

## Loop guard

The workflow updates the same row it was started from, which raises another `updated` event. The first step lets a run continue only for a new row or when **Review requested** is ticked, and the update clears that flag, so the follow-up event ends immediately.

## After installing

1. Complete setup: the provider's base URL and token, and the procurement lead.
2. Open **Data → Suppliers**, tick **Review requested** on a supplier and watch the run in **Automations → Runs**.

## New in 1.1.0

- **Review supplier risk** has Accept / Mitigate / Exit buttons, a header and a grid.
