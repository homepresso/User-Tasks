# NetSuite vendor bill (AP) approval

NetSuite posts a vendor bill id. UserTasks reads the bill, applies the **AP approval limits** decision table by subsidiary and amount, and gives the AP approver a task with a **Cost centres** lookup and **Approve** / **Hold** / **Reject** buttons, then a second approval when the limit needs it. The approval status is written back to the bill.

## Endpoints called (integration "NetSuite", base `https://1234567.suitetalk.api.netsuite.example.com/services/rest/record/v1`)

| Reference | Request | Used for |
|---|---|---|
| Get vendor bill | `GET /vendorBill/{bill_id}?expandSubResources=true` | `tranId`, `tranDate`, `dueDate`, `entity.id` / `entity.refName`, `subsidiary.refName`, `currency.refName`, `total`, `taxTotal`, `terms.refName`, `approvalStatus`, `item.items[]`, `expense.items[]` |
| Update bill approval | `PATCH /vendorBill/{bill_id}` body `{"approvalStatus": {"id": "2"}, "paymentHold": false, "memo": "..."}` | `approvalStatus` 1 = Pending Approval, 2 = Approved, 3 = Rejected; Hold keeps 1 and sets `paymentHold: true` (NetSuite answers 204) |

## Starting it from NetSuite

A user event script on **Vendor Bill**:

```javascript
/** @NApiVersion 2.1 @NScriptType UserEventScript */
define(['N/https'], (https) => ({
  afterSubmit: (ctx) => {
    if (ctx.type !== ctx.UserEventType.CREATE) return;
    const rec = ctx.newRecord;
    https.post({ url: '<workflow webhook URL>', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bill_id: String(rec.id), tran_id: rec.getValue('tranid') }) });
  }
}));
```

## Adapting it

- **Approval routing off**: without Vendor Bill approval routing, `approvalStatus` is not settable; use a custom body field (e.g. `custbody_ut_approval`) in Update bill approval instead.
- **Limits**: AP approval limits matches the subsidiary display name (`(NZ)`, `(AU)`, `(US)`) and the bill total; add a rule per subsidiary. The last rule is the catch-all.
- **Cost centres**: the lookup stores the cost centre `code` and fills its name, budget owner and NetSuite department id. To write the department back to the expense lines, add a PATCH of `expense.items` with `department.id`.
- **Foreign currency**: `total` is in the bill currency; map `exchangeRate` and compare `total * exchangeRate` if your limits are in the base currency.
- The memo is inserted into a JSON body as text: keep comments free of double quotes or switch the reference to a JSON body.
