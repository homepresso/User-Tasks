# Active Directory and AD FS

UserTasks works with an on-premises Active Directory domain in four ways.
You can use any combination of them:

| What | How | Configured in |
|---|---|---|
| Sign in with AD FS (OpenID Connect) | AD FS application group, authorization code flow with PKCE | `AUTH_SSO_PROVIDERS` or Settings → Infrastructure → Auth (instance) |
| Sign in with AD FS (SAML 2.0) | AD FS relying party trust, signed assertions | `AUTH_SSO_PROVIDERS` or Settings → Infrastructure → Auth (instance) |
| Sync users, groups and managers from AD | LDAPS or StartTLS, paged searches, nested groups, delta by `uSNChanged` | Settings → SSO & Directory → LDAP (per workspace) |
| Sign in with the AD password (LDAP bind) | Bind as the user's DN, on the organisation's login page | The LDAP connection's **Let users sign in with their directory password** option |

All four were tested end to end against Windows Server 2025 AD DS and AD FS.
Sign-in with AD FS and LDAP bind need the built-in auth provider
(`AUTH_PROVIDER=builtin`, passwords next to SSO), or `oidc` / `saml` (SSO
only). Directory sync works with every auth provider.

## Before you start

- **Serve UserTasks over https** (`APP_URL=https://…`). AD FS accepts only
  https SAML endpoints, and it drops an http ACS from a relying party trust
  without an error. OIDC redirect URIs can be `http://localhost` for testing.
- **Trust your CA.** AD FS and the domain controllers usually have
  certificates from an internal CA (AD CS). Give the server the CA certificate
  with `NODE_EXTRA_CA_CERTS=/etc/ssl/corp-ca.pem`, which is used for AD FS
  discovery, keys and metadata. LDAPS takes its own CA bundle per connection.
  Never turn certificate verification off. To export the CA certificate on a
  domain-joined machine, run `certutil -ca.cert corp-ca.cer` and convert it
  with `openssl x509 -inform der -in corp-ca.cer -out corp-ca.pem`.
- **Network:** the server must reach AD FS on 443 and a domain controller
  on 636 (LDAPS) or 389 (StartTLS). Browsers must reach AD FS. A domain
  controller on a private address also needs `ALLOW_PRIVATE_EGRESS=true`.
- **Pick one matching key** (next section) before anyone signs in.

## One account per person: the matching key

A person can reach UserTasks through AD FS (OIDC or SAML), LDAP bind and
directory sync. They all end up as the same account, linked by email
address:

- Directory sync links each AD entry to an account by `objectGUID`. The
  first time, it finds the account by email, or creates it.
- SSO links an identity to an account by the IdP's subject. The first time,
  it uses the email, which counts as verified only when `allowedDomains`
  lists your domains (or with `trustEmail`).
- LDAP bind uses the directory link, else the email.

So every path must produce the **same email** for a person. Most domains
have `mail` equal to `userPrincipalName`, and the defaults work as they are.
If they differ (for example `mail` is `jane.doe@contoso.com` and the UPN is
`jdoe@corp.contoso.local`), choose one and set it in every place:

| Key | AD FS OIDC | AD FS SAML | LDAP connection |
|---|---|---|---|
| `mail` (default) | `emailClaim: "email"` (default) | `emailAttribute` default (`…/claims/emailaddress`) | `attributes.email: "mail"` (default; the UPN is used when `mail` is empty) |
| UPN | `emailClaim: "upn"` | `emailAttribute: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn"` | `attributes.email: "userPrincipalName"` |

Mixing keys creates a second account for anyone whose two values differ.
SharePoint shows the same people as `i:0#.w|contoso\jdoe` (Windows: the
`sAMAccountName`) and `i:0e.t|trusted|jdoe@contoso.local` (AD FS trusted
identity: the claim the trust uses, usually the UPN or email). Use the same
attribute as your SharePoint trusted identity provider's identifier claim,
and the accounts line up.

## AD FS with OpenID Connect

### 1. Register UserTasks in AD FS

On the AD FS server, in PowerShell as an AD FS administrator (replace the
URL and the group name):

```powershell
$name   = 'UserTasks'
$appUrl = 'https://tasks.contoso.com'
$cid    = [guid]::NewGuid().ToString()

New-AdfsApplicationGroup -Name $name -ApplicationGroupIdentifier $name
$app = Add-AdfsServerApplication -Name "$name - Server" -ApplicationGroupIdentifier $name `
  -Identifier $cid -RedirectUri "$appUrl/auth/sso/adfs/callback" -GenerateClientSecret -PassThru

# Claims for UserTasks: UPN, email, display name, given name / surname and group names.
$rules = @'
@RuleTemplate = "LdapClaims"
@RuleName = "AD attributes"
c:[Type == "http://schemas.microsoft.com/ws/2008/06/identity/claims/windowsaccountname", Issuer == "AD AUTHORITY"]
 => issue(store = "Active Directory", types = ("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname", "http://schemas.xmlsoap.org/claims/Group"), query = ";userPrincipalName,mail,displayName,givenName,sn,tokenGroups;{0}", param = c.Value);
'@
# The web API's identifier is the client id, so its claims go into the ID token.
Add-AdfsWebApiApplication -Name "$name - Web API" -ApplicationGroupIdentifier $name `
  -Identifier $cid -IssuanceTransformRules $rules -AccessControlPolicyName 'Permit everyone'
Grant-AdfsApplicationPermission -ClientRoleIdentifier $cid -ServerRoleIdentifier $cid `
  -ScopeNames openid,profile,email,allatclaims

"Client id: $cid"
"Client secret: $($app.ClientSecret)"   # store it in your secret store, then clear the screen
```

`tokenGroups` issues the names of every group the user belongs to,
including nested and primary groups. To send only some groups, filter them
with a second rule, or issue group SIDs instead (the `groupsid` claim, and
`groupsClaim: "groupsid"` below). Replace `Permit everyone` with an access
control policy to limit who can sign in.

### 2. Configure UserTasks

Add the IdP to `AUTH_SSO_PROVIDERS`, or to Settings → Infrastructure → Auth →
Identity providers. Both are stored encrypted. Keep the client secret in the
secret store and reference it:

```json
[{ "id": "adfs", "type": "oidc", "preset": "adfs", "name": "Contoso sign-in",
   "baseUrl": "https://adfs.contoso.com",
   "clientId": "<client id>", "clientSecret": "secret://adfs-client-secret",
   "allowedDomains": ["contoso.com"],
   "defaultOrg": "contoso", "defaultRole": "member",
   "roleMapping": { "UserTasks Admins": "admin", "UserTasks Managers": "manager" },
   "enforceRoleMapping": true }]
```

What the `adfs` preset does:

- Issuer `<baseUrl>/adfs`, from discovery at
  `<baseUrl>/adfs/.well-known/openid-configuration`.
- Groups come from AD FS's `group` claim (the Group claim type), plus
  `role` and `groups`. Set `groupsClaim` to read only one, such as `groupsid`.
- The display name comes from `unique_name` (the Name claim type), else
  `given_name` + `family_name`.
- The email comes from `email`, else `upn`. Set `emailClaim: "upn"` to key on
  the UPN.
- AD FS sends no `email_verified`, so set `allowedDomains` to the domains your
  directory owns. Otherwise the email is not trusted for new accounts or for
  linking.

AD FS 2019 and later put the web API's claims in the ID token even without
the `allatclaims` scope. AD FS 2016 needs it: add
`"scopes": ["openid", "profile", "email", "allatclaims"]`.

## AD FS with SAML 2.0

### 1. Get the service provider metadata

Add the IdP to UserTasks first (step 2), then download
`<APP_URL>/auth/saml/<id>/metadata`. It holds the entity ID
(`<APP_URL>/auth/saml/<id>/metadata`) and the ACS
(`<APP_URL>/auth/saml/<id>/acs`, HTTP-POST).

### 2. Configure UserTasks

```json
[{ "id": "adfs-saml", "type": "saml", "preset": "adfs", "name": "Contoso sign-in (SAML)",
   "metadataUrl": "https://adfs.contoso.com/FederationMetadata/2007-06/FederationMetadata.xml",
   "allowedDomains": ["contoso.com"],
   "defaultOrg": "contoso", "defaultRole": "member",
   "roleMapping": { "UserTasks Admins": "admin" }, "enforceRoleMapping": true }]
```

The metadata supplies the sign-on URL, the token-signing certificate(s) and
the issuer, and is re-read hourly, so AD FS certificate rollover is picked up.
Assertions must be signed (`wantAssertionsSigned`, the default; AD FS signs
the assertion by default). Audience, time conditions (60 s skew), the
`InResponseTo` of SP-initiated sign-ins and replays are all checked.

### 3. Add the relying party trust

```powershell
# If AD FS can reach UserTasks:
Add-AdfsRelyingPartyTrust -Name 'UserTasks' -MetadataUrl 'https://tasks.contoso.com/auth/saml/adfs-saml/metadata' `
  -AccessControlPolicyName 'Permit everyone' -SignatureAlgorithm 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' `
  -IssuanceTransformRules $rules
# Otherwise, download the metadata file and use -MetadataFile C:\temp\usertasks-sp.xml instead of -MetadataUrl.
```

With these issuance rules:

```powershell
$rules = @'
@RuleTemplate = "LdapClaims"
@RuleName = "AD attributes"
c:[Type == "http://schemas.microsoft.com/ws/2008/06/identity/claims/windowsaccountname", Issuer == "AD AUTHORITY"]
 => issue(store = "Active Directory", types = ("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name", "http://schemas.xmlsoap.org/claims/Group"), query = ";mail,userPrincipalName,displayName,tokenGroups;{0}", param = c.Value);

@RuleTemplate = "MapClaims"
@RuleName = "NameID = email"
c:[Type == "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"]
 => issue(Type = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier", Issuer = c.Issuer, OriginalIssuer = c.OriginalIssuer, Value = c.Value, ValueType = c.ValueType, Properties["http://schemas.xmlsoap.org/ws/2005/05/identity/claimproperties/format"] = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress");
'@
```

Check the trust kept its endpoint:
`(Get-AdfsRelyingPartyTrust -Name UserTasks).SamlEndpoints` must list the
https ACS. If it is empty, the ACS was http.

## Groups and roles

`roleMapping` maps AD group names, matched case-insensitively, to the system
roles `viewer`, `member`, `manager`, `admin` and `owner`. It applies in
`defaultOrg`:

- On the first sign-in, the account gets the highest mapped role, else
  `defaultRole`.
- On every later sign-in, the highest mapped role replaces the current one.
- With `enforceRoleMapping: true`, a sign-in with no mapped group sets the
  role back to `defaultRole`, so removing someone from the AD group removes
  their admin rights at their next sign-in. Without it, they keep the mapped
  role until an admin changes it.
- A workspace owner is never demoted by a mapping (unless it maps to `owner`).

Directory sync turns AD groups into **teams** (for assignment and
visibility). It does not grant roles: roles come from SSO group mapping, or
from an admin.

## Directory sync from Active Directory

### 1. A least-privilege bind account

Any enabled domain user can read users, groups and their membership.
UserTasks needs nothing more: no admin rights, and no write access.

```powershell
New-ADUser -Name svc-usertasks -SamAccountName svc-usertasks -UserPrincipalName svc-usertasks@contoso.com `
  -Path 'OU=Service Accounts,DC=contoso,DC=com' -Enabled $true -PasswordNeverExpires $true -CannotChangePassword $true `
  -AccountPassword (Read-Host -AsSecureString 'Password') -Description 'UserTasks directory sync (read only)'
```

Bind as `svc-usertasks@contoso.com`, `CONTOSO\svc-usertasks` or the full
DN. If your domain hides users from Authenticated Users, grant the account
**Read** on the user and group OUs. Deny it interactive logon by Group
Policy if your policy asks for that.

### 2. LDAPS or StartTLS

Domain controllers with a certificate from AD CS (auto-enrolled
"Domain Controller" or "Kerberos Authentication" templates) serve LDAPS on
636. Windows Server 2025 requires LDAP signing by default, so simple binds
over plain `ldap://` are refused. UserTasks then reports *"the directory
server requires an encrypted connection (LDAP signing): use ldaps:// (port
636) or StartTLS"*. Use:

- `ldaps://dc1.contoso.com:636` with the CA certificate in **CA certificate
  (PEM)**, or
- `ldap://dc1.contoso.com:389` with **Use StartTLS**.

If you connect by IP address or through a load balancer whose name is not
on the certificate, set **Certificate host name** (`tls_server_name`) to the
name that is on it.

### 3. Connect

Settings → SSO & Directory → LDAP, as a workspace admin. Choose **Active
Directory**, then fill in the server, bind account, password (or a
`secret://tenants/<workspace id>/<name>` reference) and base DN. **Test
connection** binds, counts users and groups, and shows sample entries, without
saving anything. The same is available through the API:

```bash
curl -X POST https://tasks.contoso.com/api/v1/directory-sync/connections \
  -H "Authorization: Bearer $UT_API_KEY" -H 'content-type: application/json' -d @- <<'JSON'
{ "provider": "ldap", "sync_groups": true, "auto_provision": true,
  "settings": {
    "url": "ldaps://dc1.contoso.com:636", "flavor": "active_directory",
    "ca_cert": "-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----",
    "bind_dn": "svc-usertasks@contoso.com", "base_dn": "DC=contoso,DC=com",
    "user_filter": "(&(objectCategory=person)(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:=CN=UserTasks Users,OU=Groups,DC=contoso,DC=com))",
    "group_filter": "(&(objectClass=group)(cn=UserTasks*))",
    "bind_login": true },
  "credentials": { "bind_password": "secret://tenants/<workspace id>/ldap-bind" } }
JSON
```

The Active Directory defaults:

| Setting | Default |
|---|---|
| Id | `objectGUID`, in Windows string form, so renames and moves keep the link |
| Login name / email | `sAMAccountName` / `mail`, else `userPrincipalName` |
| Name, profile | `displayName` (else `givenName` + `sn`), `title`, `department`, `physicalDeliveryOfficeName`, `employeeID`, `company`, `division` |
| Manager | `manager`, resolved to the synced manager's account |
| Users | `(&(objectCategory=person)(objectClass=user))` |
| Groups | `(objectClass=group)` |
| Disabled accounts | `userAccountControl` bit 2: not created, access revoked, and removed from their groups' teams. They return when re-enabled |
| Group members | Searched per group with `memberOf:1.2.840.113556.1.4.1941:=<group DN>` (nested membership, no `member;range=` paging needed) |
| Paging | Simple paged results, 500 entries per page |
| Delta | `uSNChanged` above the last `highestCommittedUSN`, with a full sync daily (which also deactivates entries that left the filter) |

Recommendations:

- **Scope the user filter** to the people who use UserTasks. The default
  takes every user object, including service accounts (they get an account
  when they have a `mail` or UPN). Members (nested) of one group is the
  easiest scope, as in the example above.
- **Scope the group filter** too. The default includes built-in groups
  (Domain Users, Domain Admins, …). Use `(&(objectClass=group)(cn=UserTasks*))`,
  an OU (Groups base DN), or exclude system groups with
  `(&(objectClass=group)(!(isCriticalSystemObject=TRUE)))`.
- Primary group membership (usually Domain Users) is not stored in
  `memberOf`, so that group shows no members. Use a regular group.
- **Point the URL at one domain controller** (or a name that always reaches
  the same one). `uSNChanged` values differ per DC, so a delta against a
  different DC can miss changes until the next daily full sync.

## Sign in with the AD password (LDAP bind)

With **Let users sign in with their directory password** on, the
organisation's login page checks the password with a bind as the user's
entry. The login field then reads **Email or user name**, and accepts:

- the email (`mail`) or `userPrincipalName`: `jdoe@contoso.com`
- the `sAMAccountName`: `jdoe`
- the down-level name: `CONTOSO\jdoe`

The entry is found with the bind account (exactly one enabled match in the
user filter), then the password is checked with a bind as its DN on a
separate connection. Empty passwords never reach the server. Names the
directory doesn't know fall through to local passwords, so a break-glass
local admin keeps working. Attempts are rate limited per IP and per
name.

## Checking the configuration

- `usertasks-admin doctor --area auth`, also on **Settings →
  Infrastructure**, checks each IdP. For OIDC: discovery, an issuer that
  matches, and signing keys. For SAML: metadata, the sign-on URL, signing
  certificates (warning 30 days before expiry), and a warning for an http
  ACS. It prints the redirect URI and ACS to register.
- `npm run auth -- redirect-uris` prints the URLs to register in AD FS.
- **Test connection** on the LDAP connection (or
  `POST /api/v1/directory-sync/connections/ldap/test`).
- `scripts/ad-adfs-check.ts` runs these checks against a real domain
  from the command line (credentials from the environment).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Login page: *That sign-in option is not available* or *Single sign-on failed*; server log `Could not reach the identity provider` | The server can't reach AD FS, or doesn't trust its certificate. Check DNS and port 443, and set `NODE_EXTRA_CA_CERTS` to the CA bundle. |
| `Identity provider issuer mismatch` | `baseUrl` is not AD FS's federation service name. Compare it with `(Get-AdfsProperties).HostName`: the issuer is `https://<HostName>/adfs`. |
| `Token exchange failed: MSIS9…` | The client secret or redirect URI differs from the server application. Reset the secret with `Set-AdfsServerApplication -TargetIdentifier <client id> -ResetClientSecret` and update `clientSecret`. |
| AD FS error page about scopes (`invalid_scope`) | A requested scope isn't granted: `Grant-AdfsApplicationPermission … -ScopeNames openid,profile,email,allatclaims`. |
| *Your identity provider did not supply a verified email address* | No email claim, or `allowedDomains` doesn't list the domain. Issue `mail`/`upn` in the claim rules and set `allowedDomains`. |
| *Your email domain is not allowed to sign in here* | The email's domain isn't in `allowedDomains` (for example `mail` is `@contoso.com` but only `contoso.local` is listed). |
| Role mapping does nothing | Look at the groups AD FS sends. They must match `roleMapping` keys (names, or SIDs with `groupsClaim: "groupsid"`), and `defaultOrg` must be set. |
| Two accounts for one person | Different matching keys on different paths (see the matching key section). Merge by deleting the extra account, align the settings, and sign in again. |
| SAML: the relying party trust has no endpoint, and AD FS shows an error page instead of posting back | `APP_URL` is http. AD FS keeps only https endpoints. |
| SAML: `The SAML response is not valid (Invalid signature)` | The token-signing certificate changed and `idpCert` is pinned. Use `metadataUrl`, or update `idpCert`. |
| SAML: `… InResponseTo is not valid` | The sign-in took longer than 10 minutes, or was started on another server without the shared database. Try again. |
| LDAP: *requires an encrypted connection (LDAP signing)* | Use `ldaps://` or StartTLS. |
| LDAP: *TLS verification failed … add the certificate of the CA* | Paste the issuing CA certificate (PEM) in **CA certificate**. |
| LDAP: *Hostname/IP does not match … set tls_server_name* | Connect with the DC's name, or set **Certificate host name**. |
| LDAP: *invalid credentials* for the bind account | Wrong password, locked or expired account. Use the UPN or the full DN. |
| LDAP: *could not reach the directory server* | Firewall, DNS, or the egress guard: list the DC in `EGRESS_PRIVATE_ALLOW` (e.g. `dc.contoso.local` or `10.0.0.0/24`). |
| Bind login says *Invalid login credentials* for a valid AD user | The user isn't matched by the user filter, is disabled, or two entries share the name. |

## Sign-out

Signing out of UserTasks ends the UserTasks session only. This is by design:
the person stays signed in to AD FS, and so to SharePoint and the other apps
that use it. The next click on the AD FS button signs them straight back in
to UserTasks without a password. To end the AD FS session as well (for
example on a shared computer), sign out of AD FS itself at
`https://<adfs>/adfs/ls/?wa=wsignout1.0`, or close the browser.

Reference: [Single sign-on](../infrastructure.md#single-sign-on-oidc-and-saml),
[Directory sync](../infrastructure.md#directory-sync),
[Choosing auth](auth.md), [Choosing directory sync](directory-sync.md).
