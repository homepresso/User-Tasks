# Customer onboarding with KYC

New business customer to open account: KYC screening, credit check, risk rating, compliance review and kickoff.

## What's inside

- **Customer onboarding** workflow (starts from a form: its inputs are the new-customer form)
- **Customer risk rating** decision table (KYC result, credit score, country risk, volume → tier, limit, terms, review)
- **Country risk** data table with seven sample entries
- Three REST integrations: **KYC provider** (*Run KYC checks*), **Credit bureau** (*Get credit report*), **Billing and CRM** (*Create customer account*)
- Two email templates: welcome and declined

## After installing

1. Complete setup: base URLs and tokens for the three integrations, the compliance officer, account manager and onboarding manager.
2. Edit the country list and the rating rules.
3. Register a customer from **Automations → Workflows → Run**, or from your CRM:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"company_name":"Harbourside Logistics Ltd","registration_number":"5523017","country":"New Zealand","contact_name":"Pat Hollis","contact_email":"pat.hollis@example.com","product":"Business","expected_monthly_volume":85000,"account_manager_email":"sam.carter@example.com"}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Compliance review** has Approve / Request documents / Decline buttons, a header and a grid, and a **Country risk** lookup that shows the country rating and whether enhanced due diligence applies.
- **Collect documents** and **Onboarding kickoff** have outcome buttons, headers and grids.
