# SAP supplier invoice posting with 3-way match

Match captured supplier invoices to the SAP S/4HANA purchase order and goods receipts, send exceptions to AP and post the rest automatically.

## SAP OData endpoints

Integration **SAP S/4HANA**: base URL `https://<host>/sap/opu/odata/sap`, Basic auth (communication user), headers `Accept: application/json` and `sap-client`.

| Reference | Method and path | Used for |
|---|---|---|
| Get purchase order item | `GET /API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem(PurchaseOrder='{{purchase_order}}',PurchaseOrderItem='{{po_item}}')` | `OrderQuantity`, `NetPriceAmount` / `NetPriceQuantity`, `DocumentCurrency`, `TaxCode` |
| Get goods receipts | `GET /API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem?$filter=PurchaseOrder eq '…' and PurchaseOrderItem eq '…' and GoodsMovementType eq '101' and GoodsMovementIsCancelled eq false` | `d.results[]`: `QuantityInEntryUnit` (summed), first `MaterialDocument` / `MaterialDocumentYear` / `MaterialDocumentItem` as the reference |
| Post supplier invoice | `POST /API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice` | deep insert with `to_SuplrInvcItemPurOrdRef`; returns `d.SupplierInvoice` and `d.FiscalYear` |

Communication scenarios: SAP_COM_0053, SAP_COM_0108 and SAP_COM_0057.

### CSRF tokens

The POST needs an `x-csrf-token`. Use SAP API Management / a BTP destination that handles it (recommended), or fetch one with a `GET` carrying `x-csrf-token: Fetch` and pass it (with the session cookie) to the optional `x-csrf-token` header input.

## Start it

```json
{"invoice_reference": "NW-88213", "supplier": "17300001", "company_code": "1010", "document_date": "2026-10-27",
 "purchase_order": "4500001245", "po_item": "10", "invoiced_quantity": 100, "invoiced_unit_price": 12.9,
 "gross_amount": 1535.1, "currency": "EUR", "capture_id": "CAP-2026-10-27-0042"}
```

In this sample 100 units are invoiced at 12.90 against a PO price of 12.50 with 90 received, so the run stops at the exception task.

## What is included

- Decision table **Invoice tolerance**: quantity over receipt, price variance %, amount variance → within tolerance, exception and a suggested reason code.
- Data tables **Invoice match log** (every invoice, variances, SAP document) and **Variance reason codes** (lookup on the exception form; fills the reason and SAP payment block).
- Exception task form with grid layout, header and **Approve variance** / **Hold** / **Reject** buttons, reminders and escalation.

## Adapting it

- One invoice line per run. For multi-line invoices, post the lines as an array and loop over them, collecting `to_SuplrInvcItemPurOrdRef` entries with a JSON add-to-array step.
- Prefer to let SAP block instead of UserTasks? Post every invoice with `PaymentBlockingReason` `R` when outside tolerance and use the task only for release.
- Change the `$filter` if you post goods receipts with other movement types (e.g. 103/105 for GR blocked stock).
