# Vendor onboarding with KYC

Screen, tier, review and verify a new vendor before it reaches the ERP.

## What's inside

- **Vendor onboarding** workflow (starts from a form: its inputs are the vendor request)
- **Vendor risk tier** decision table (blocked, high, medium, low and re-screen interval)
- **Country risk** data table with eleven sample countries
- **KYC screening service** integration with *Company checks*, and an **ERP** integration with *Create vendor*
- Two email templates: vendor welcome and onboarding declined

## After installing

1. Complete setup: both integrations' base URLs and tokens, the compliance reviewer and the finance verifier.
2. Align the country ratings and tier rules with your policy.
3. Start a request from **Automations → Workflows → Run**, or from your supplier request page:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"legal_name":"Harbourline Logistics Limited","registration_number":"5123987","country":"NZ","iban":"NZ12-3456-7890123-00","contact_email":"accounts@harbourline.example.com","spend_category":"Logistics","expected_annual_spend":120000}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Compliance review** has Approve / Approve with conditions / Reject buttons, a grid, a header and a **Country risk** lookup.
- **Verify bank details** has Verified / Details do not match buttons.
