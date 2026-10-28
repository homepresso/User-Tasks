# SAP purchase requisition → PO approval

Approve SAP S/4HANA purchase requisitions on task forms and create the purchase order when they are approved.

## SAP OData endpoints

Integration **SAP S/4HANA**: base URL `https://<host>/sap/opu/odata/sap`, Basic auth (communication user), headers `Accept: application/json` and `sap-client`.

| Reference | Method and path | Used for |
|---|---|---|
| Get purchase requisition | `GET /API_PURCHASEREQ_PROCESS_SRV/A_PurchaseRequisitionHeader('{{purchase_requisition}}')` | `d.PurchaseRequisitionType`, `d.PurReqnDescription` |
| Get requisition items | `GET /API_PURCHASEREQ_PROCESS_SRV/A_PurchaseRequisitionHeader('{{purchase_requisition}}')/to_PurchaseReqnItem` | `d.results[]`: `RequestedQuantity`, `PurchaseRequisitionPrice`, `MaterialGroup`, `Plant`, `CompanyCode`, `PurchasingOrganization`, `PurchasingGroup`, `FixedSupplier` |
| Create purchase order | `POST /API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder` | deep insert with `to_PurchaseOrderItem`; returns `d.PurchaseOrder` |

Communication scenarios: SAP_COM_0102 (purchase requisition integration) and SAP_COM_0053 (purchase order integration).

### CSRF tokens

SAP Gateway rejects a POST without a valid `x-csrf-token`. Options:

1. Call SAP through SAP API Management or a BTP destination / Cloud Connector setup that fetches the token for you (recommended), or
2. Fetch it yourself: `GET` any entity set with header `x-csrf-token: Fetch`, then pass the returned token (and the session cookie) on the POST. The **Create purchase order** reference has an optional `x-csrf-token` header input for this.

## Start it

```json
{"purchase_requisition": "10000123"}
```

Typical sources: the `sap.s4.beh.purchaserequisition.v1.PurchaseRequisition.Changed.v1` business event via Event Mesh, or a scheduled ABAP report that posts newly released requisitions.

## What is included

- Decision table **PR approval matrix** (amount, material group, plant → approver level, two-step flag, SLA days).
- Data tables **Cost centres** (lookup on the approval form: fills name, responsible, remaining budget, G/L account) and **Requisition approvals** (log with the PO number).
- Two task forms with grid layout, header and **Approve** / **Reject** buttons; reminders and escalation.

## Adapting it

- The PO body maps `CostCenter` and `GLAccount` on each item; in SAP these belong in the item's account assignment (`to_AccountAssignment`). Adjust the body template in Integrations to your release (the response model and inputs stay the same).
- Prices are per `PurReqnPriceQuantity`; the item value divides by it.
- Material group rules use `starts_with`; add rules per plant or purchasing group as needed.
