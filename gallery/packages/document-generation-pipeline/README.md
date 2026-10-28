# Document generation pipeline

Contract data in; a filled contract and fee schedule filed in the DMS and out for signature.

## What's inside

- **Generate contract documents** workflow (headless: started by your application)
- **Document templates** data table with four sample document types
- **Document management system** integration (*Register document*) and **E-signature service** integration (*Create signature request*)
- One email template: document ready to sign

## Template placeholders

Word: `{{TITLE}}` `{{CUSTOMER}}` `{{DATE}}` `{{AMOUNT}}` `{{REFERENCE}}` `{{BODY}}`, plus an optional `[[SIGNER]]` for the signer's name. Excel (optional): labels are written to A2:A9 and values to B2:B9 of the first sheet.

## After installing

1. Complete setup: the DMS and e-signature base URLs and tokens.
2. Add your document types to the Document templates table.
3. Post contract data from your application:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"doc_type":"service_agreement","customer_name":"Fourth Coffee Limited","contract_reference":"CT-2026-118","start_date":"2026-11-01","amount":48000,"term_months":24,"signer_email":"robin.diaz@fourthcoffee.example.com","template_url":"https://files.example.com/templates/service-agreement.docx"}}'
```
