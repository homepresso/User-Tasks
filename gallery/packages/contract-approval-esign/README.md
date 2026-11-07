# Contract approval and e-signature

Approve a contract internally, send it for signature through DocuSign, wait for the signer and record the signed PDF.

## What's inside

- **Contract approval and e-signature** workflow (headless: its inputs are the contract)
- **DocuSign** e-signature connection (developer sandbox by default)
- **Signed contracts** data table (title, counterparty, value, envelope id, signed PDF, signed at)
- **Contract signed** email template for the contract owner

## How it runs

1. **Approve contract** — the approver sees the title, counterparty and value with a link to the PDF, and approves or rejects it.
2. **Send for signature** — an approved contract goes to the signer as a DocuSign envelope (signature on the `/sn1/` anchor, reminders every 2 days, expires after 14 days).
3. **Wait for signature** — the run pauses until the envelope is completed, declined, voided or expired, or 21 days pass.
4. **Completed** — the signed PDF and certificate are stored, a row is added to **Signed contracts** and `notify_email` (if given) gets a link.
5. **Declined / Voided / Expired / Timeout** — a **Follow up** task goes to the contract owner.

## After installing

1. Complete setup: the DocuSign access token (or switch to JWT Grant or OAuth in **Connectors → DocuSign**) and the two assignees (approver, contract owner).
2. Register the DocuSign Connect webhook: point it at `https://<your UserTasks host>/api/webhooks/esign/docusign/<integration id>` with HMAC enabled and paste the HMAC key as the **Webhook secret** in **Connectors → DocuSign**. Without it, Wait for signature polls every 5 minutes. Details: `/docs/integrations/e-signature`.
3. Put the anchor text `/sn1/` in your contract PDFs where the signature goes (white text keeps it invisible).
4. Start a run from your application:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"contract_title":"Master services agreement 2027","counterparty":"Fourth Coffee Limited","contract_value":120000,"signer_name":"Robin Diaz","signer_email":"robin.diaz@fourthcoffee.example.com","contract_pdf":"https://files.example.com/contracts/msa-2027.pdf","notify_email":"legal@example.com"}}'
```

For production, set the connection's base URL to your account's host (for example `https://www.docusign.net/restapi`).
