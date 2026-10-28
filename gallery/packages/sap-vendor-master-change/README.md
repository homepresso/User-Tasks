# SAP vendor master change approval

A controlled, audited process for changing a supplier's bank details in SAP S/4HANA: compare, review, call back, approve (four eyes), post, log.

## SAP OData endpoints

Integration **SAP S/4HANA**: base URL `https://<host>/sap/opu/odata/sap`, Basic auth (communication user, scenario SAP_COM_0008), headers `Accept: application/json` and `sap-client`.

| Reference | Method and path | Used for |
|---|---|---|
| Get supplier | `GET /API_BUSINESS_PARTNER/A_Supplier('{{supplier}}')` | `SupplierName`, `SupplierAccountGroup`, `VATRegistration`, `PaymentIsBlockedForSupplier` |
| Get supplier company data | `GET /API_BUSINESS_PARTNER/A_SupplierCompany(Supplier='{{supplier}}',CompanyCode='{{company_code}}')` | `PaymentTerms`, `PaymentMethodsList`, `HouseBank`, `PaymentBlockingReason` |
| Get supplier bank details | `GET /API_BUSINESS_PARTNER/A_BusinessPartner('{{supplier}}')/to_BusinessPartnerBank` | `d.results[0]`: `BankIdentification`, `IBAN`, `SWIFTCode`, `BankCountryKey`, `BankAccountHolderName` |
| Add supplier bank detail | `POST /API_BUSINESS_PARTNER/A_BusinessPartnerBank` | new bank id (current + 1) valid from the effective date |
| End old bank detail | `PATCH /API_BUSINESS_PARTNER/A_BusinessPartnerBank(BusinessPartner='{{supplier}}',BankIdentification='{{bank_id}}')` | `ValidityEndDate` = day before the effective date |

### CSRF tokens

SAP Gateway needs an `x-csrf-token` on POST and PATCH. Use SAP API Management / a BTP destination that fetches it (recommended), or fetch it with a `GET` carrying `x-csrf-token: Fetch` and pass it (with the session cookie) to the optional `x-csrf-token` header input of the two write references.

## What is included

- A **themed start form** (grid layout, IBM Plex Sans, blue accent) on the webhook trigger.
- Decision table **Bank change risk** (country changed, holder matches, payment blocked → risk, call-backs, treasury SLA).
- Three task forms with grid layout and headers: **Finance review** (Approve / Reject), **Call-back verification** (checkboxes for what was confirmed; Verified / Could not verify) and **Treasury approval** (four-eyes confirmation; Approve / Reject).
- Data table **Vendor change audit log** with a 10-year retention policy, and the requester confirmation email.

## Adapting it

- The comparison uses the first bank detail (`d.results[0]`). If suppliers have several, filter `to_BusinessPartnerBank` by `BankIdentification` or add a `$filter` in the reference path.
- Some releases expect dates as `/Date(ms)/` in OData v2 bodies; change the body templates in Integrations if your gateway rejects ISO dates.
- To block payments while the change is pending, add a PATCH of `A_SupplierCompany` with `PaymentBlockingReason` after the request and clear it after posting.
