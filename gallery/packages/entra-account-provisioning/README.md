# Microsoft 365 / Entra account provisioning

A themed **New starter account request** form (grid layout, header, theme, **Departments lookup** that fills the licence and group) starts the workflow through its **Form submitted** trigger. The approving manager gets an **Approve and create** / **Reject** task; then Microsoft Graph creates and licenses the account.

## Endpoints called (integration "Microsoft Graph", base `https://graph.microsoft.example.com/v1.0`)

| Reference | Request | Used for |
|---|---|---|
| Find user by UPN | `GET /users?$filter=userPrincipalName eq '<upn>'&$select=id,displayName,userPrincipalName,accountEnabled` | `value[]`: is the UPN taken? |
| Create user | `POST /users` with `accountEnabled`, `displayName`, `givenName`, `surname`, `mailNickname`, `userPrincipalName`, `jobTitle`, `department`, `officeLocation`, `usageLocation`, `employeeId`, `passwordProfile` | `id`, `userPrincipalName` |
| Assign licence | `POST /users/{id}/assignLicense` body `{"addLicenses": [{"skuId": "<sku>", "disabledPlans": []}], "removeLicenses": []}` | Department licence (needs `usageLocation`) |
| Add group member | `POST /groups/{group_id}/members/$ref` body `{"@odata.id": "https://graph.microsoft.com/v1.0/directoryObjects/<id>"}` | Department group (204 No Content) |
| Create Temporary Access Pass | `POST /users/{id}/authentication/temporaryAccessPassMethods` body `{"startDateTime", "lifetimeInMinutes": 480, "isUsableOnce": false}` | First sign-in pass for the manager (continues on error) |

## Permissions

Application permissions with admin consent: `User.ReadWrite.All`, `GroupMember.ReadWrite.All`, `LicenseAssignment.ReadWrite.All`, `UserAuthenticationMethod.ReadWrite.All`. The integration token is a client-credentials token for `https://graph.microsoft.com/.default`.

## Adapting it

- **Departments**: each row holds the licence SKU id (`GET /subscribedSkus` → `skuId`), the group object id and defaults. Several groups per department: add more columns and more "Add group member" steps, or use a dynamic group on `department` and drop that step.
- **Group membership URL**: the `directory_object` input in "Add to department group" uses the placeholder host; set it to `https://graph.microsoft.com/v1.0/directoryObjects/{{user_id}}`.
- **UPN format**: edit the "Mail nickname" and "User principal name" steps (e.g. first initial + last name).
- **Hybrid identity**: if accounts come from on-premises AD (Entra Connect), replace Create user with your AD provisioning API and keep the licence and group steps.
- The initial password is random and never shown; the starter signs in with the Temporary Access Pass and sets their own password.
