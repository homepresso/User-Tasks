# Salesforce opportunity discount approval

A Salesforce Flow submits an opportunity discount. UserTasks reads the deal, picks the approvers with the **Discount tiers** decision table, runs the sales manager and finance approvals (task forms with **Approve** / **Reject** buttons) and writes the decision back to the opportunity.

## Endpoints called (integration "Salesforce", base `https://acme.my.salesforce.example.com/services/data/v61.0`)

| Reference | Request | Used for |
|---|---|---|
| Get opportunity | `GET /sobjects/Opportunity/{opportunity_id}?fields=Id,Name,Amount,...` | `Name`, `Amount`, `CurrencyIsoCode`, `StageName`, `CloseDate`, `Type`, `OwnerId`, `Discount_Percent__c`, `Discount_Reason__c`, `Contract_Term_Months__c` |
| Query opportunity products | `GET /query?q=SELECT Id, ProductCode, Product2.Name, Product2.Family, Quantity, ListPrice, UnitPrice, Discount, TotalPrice FROM OpportunityLineItem WHERE OpportunityId = '<id>'` | `records[]`, `totalSize`, `done` (the deepest line discount is used when the opportunity has no discount field) |
| Update discount approval | `PATCH /sobjects/Opportunity/{opportunity_id}` body `{"Discount_Approval_Status__c": "Approved" \| "Rejected", "Approved_Discount_Percent__c": n, "Discount_Approval_Notes__c": "..."}` | Decision (Salesforce answers `204 No Content`) |

## Starting it from Salesforce

Record-triggered Flow on **Opportunity**, after save, when `Discount_Approval_Status__c` changes to `Submitted`: an **HTTP Callout** action (or an Apex `@future(callout=true)` / platform event subscriber) that posts

```json
{ "opportunity_id": "{!$Record.Id}", "owner_email": "{!$Record.Owner.Email}", "account_name": "{!$Record.Account.Name}" }
```

to the workflow webhook URL (add it as a Named Credential / Remote Site).

## Adapting it

- **Different field names**: edit the `fields` query input and the output paths of Get opportunity, and the body of Update discount approval.
- **More line detail**: the SOQL is a node input on "Query opportunity products"; add fields such as `Product2.Margin__c` and use them in the task description.
- **Tiers**: Discount tiers matches on discount % and amount; the last rule (up to 10%) is the rep's own authority and approves automatically.
- **Reason codes**: edit the Discount reason codes table; its rows feed the Justification lookup in the sales manager's form.
- Notes go into a JSON body as text: keep them free of double quotes or switch the reference to a JSON body.
