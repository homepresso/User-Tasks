# Vendor onboarding with KYC

Screen, tier, review and verify a new vendor before it reaches the ERP.

## What's inside

- **Vendor application** form page: four steps with a progress bar (Company details → Banking → Spend & compliance → Review & submit), Application mode with in-form **Next**, **Back** and **Submit application** buttons, a country autocomplete that stores the ISO code and shows the country name, and form rules
- **Vendor applications** page: a Data table of every application (search, filters, sorting, currency / date / badge formats), a row click that opens the details tab, and editable status and notes saved back to the table
- **Vendor onboarding** workflow (started by the Vendor application, the Run dialog or the start API)
- **Vendor applications** data table: one row per application, kept up to date by the workflow (six sample rows)
- **Vendor risk tier** decision table (blocked, high, medium, low and re-screen interval)
- **Country risk** data table with eleven sample countries
- **KYC screening service** integration with *Company checks*, and an **ERP** integration with *Create vendor*
- Two email templates: vendor welcome and onboarding declined

## After installing

1. Complete setup: both integrations' base URLs and tokens, the compliance reviewer and the finance verifier.
2. Align the country ratings and tier rules with your policy.
3. Share **Forms → Vendor application** (`/f/<id>`) with procurement, and **Forms → Vendor applications** with the people who track onboarding (reading the table needs **View data**; saving a status needs **Manage rows**).
4. Or start a request from **Automations → Workflows → Run**, or from your supplier request page:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"legal_name":"Harbourline Logistics Limited","registration_number":"5123987","country":"NZ","iban":"NZ12-3456-7890123-00","contact_email":"accounts@harbourline.example.com","spend_category":"Logistics","expected_annual_spend":120000}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Compliance review** has Approve / Approve with conditions / Reject buttons, a grid, a header and a **Country risk** lookup.
- **Verify bank details** has Verified / Details do not match buttons.

## New in 1.2.0

- **Vendor application** form page with steps and a progress bar, in Application mode: the form's own Next / Back / Submit application buttons, no bottom bar.
- Autocomplete with a stored value and a display label: the country stores `NZ` and shows "New Zealand (NZ)", and fills the country risk.
- Form rules (**Rules** tab): the spend justification shows only for NZD 100,000 or more and is required then; a declared conflict of interest needs details; the vendor contact cannot be your own email; picking a medium or high risk country shows a note.
- **Vendor applications** table, written by the workflow at each step (Screening → Compliance review → Bank verification → Approved / Declined, with the risk tier, score, ERP vendor id and re-screen date).
- **Vendor applications** page: a Data table with formats, filters and a 12-month base filter; click a row to open its details, or change a status / note and **Save changes** (for each changed row → update the table).
- Upgrading from 1.1.0 keeps your Country risk rows and settings; the new table, forms and workflow steps are added.
