# Expense claims

Claim-to-reimbursement with category limits, an approval policy and a send-back loop.

## What's inside

- **Expense claim** workflow (starts from a form: its inputs are the claim form)
- **Expense approval policy** decision table
- **Expense categories** data table with six sample categories
- **Finance system** REST integration with *Get employee* and *Create expense reimbursement*
- Two email templates: approved and rejected

## After installing

1. Complete setup: the finance system's base URL and API token, and the default approver.
2. Adjust the categories and approval rules to your policy.
3. Start a claim from **Automations → Workflows → Run**, or from your portal:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"employee_id":"E-1001","claim_title":"Client visit","category":"travel","amount":640}}'
```

## New in 1.1.0

- The start form (Run dialog) has a grid, header and mini theme.
- **Approve expense claim** has Approve / Reject / Send back buttons, a header and a grid; the approver can recode the category (lookup) and the GL code and limit follow.
- **Fix and resubmit claim** has Resubmit / Withdraw buttons.
