# Optional drivers

Some features need a package that not every install wants: the Snowflake,
Oracle and MongoDB drivers, the cloud SDKs behind the storage, email, secrets
and KMS providers, and the SAML library. They are `optionalDependencies` in
`package.json`. A feature whose package is missing fails with a message that
says how to add it, and nothing else is affected.

The PostgreSQL (`pg`), SQL Server (`mssql`) and MySQL (`mysql2`) drivers are
regular dependencies and always installed. So are `@azure/identity` (Entra
auth for SQL Server and Azure providers), `google-auth-library` (Google Cloud
KMS and the Google providers' credentials) and `ldapts` (LDAP). The
Microsoft 365, Gmail, Resend, HashiCorp Vault and Vault Transit providers use
plain HTTPS and need no SDK.

> [!IMPORTANT]
> **The build decides.** When a package is not in `node_modules` at build
> time, `next build` bundles a stub in its place (see `next.config.ts` and
> `lib/optional-drivers/`). Installing it later is not enough: **rebuild**
> (`npm run build`, or a new Docker image), then restart. The same applies
> to the `worker.cjs` and `admin.cjs` bundles in the Docker image.

## What each package is for

Versions are the ranges in `package.json`, the ones the release is tested
with.

| Package | Needed for | Version | Native / system requirements | Licence and notes |
|---|---|---|---|---|
| `snowflake-sdk` | [Snowflake connector](#snowflake) | `^2.4.0` | None (pure JavaScript) | Apache-2.0. The largest: about 12 MB plus its own AWS, Azure and Google Cloud storage clients (for result downloads) |
| `oracledb` | [Oracle connector](#oracle) | `^6.10.0` | None: thin mode, no Oracle Instant Client | Apache-2.0 or UPL-1.0. About 4 MB |
| `mongodb` | [MongoDB connector](#mongodb) | `^7.1.1` | None | Apache-2.0. About 4 MB |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | `STORAGE_PROVIDER=s3` (S3, MinIO, Ceph, …); the presigner for signed download URLs | `^3.1156.0` | None | Apache-2.0 |
| `@azure/storage-blob` | `STORAGE_PROVIDER=azure_blob` | `^12.32.0` | None | MIT |
| `@google-cloud/storage` | `STORAGE_PROVIDER=gcs` | `^7.22.0` | None | Apache-2.0 |
| `nodemailer` | `EMAIL_PROVIDER=smtp` | `^10.2.1` | None | MIT-0 |
| `@aws-sdk/client-sesv2` | `EMAIL_PROVIDER=ses` | `^3.1156.0` | None | Apache-2.0 |
| `@azure/communication-email` | `EMAIL_PROVIDER=azure_communication` | `^1.1.0` | None | MIT |
| `@aws-sdk/client-secrets-manager` | `SECRETS_PROVIDER=aws_secrets_manager` | `^3.1156.0` | None | Apache-2.0 |
| `@azure/keyvault-secrets` | `SECRETS_PROVIDER=azure_key_vault` | `^4.11.2` | None | MIT |
| `@google-cloud/secret-manager` | `SECRETS_PROVIDER=gcp_secret_manager` | `^6.3.0` | None | Apache-2.0 |
| `@aws-sdk/client-kms` | `KMS_PROVIDER=aws_kms` | `^3.1156.0` | None | Apache-2.0 |
| `@azure/keyvault-keys` | `KMS_PROVIDER=azure_key_vault` | `^4.10.2` | None | MIT. The SQL Server driver depends on it too, so it is effectively always installed |
| `@node-saml/node-saml` | SAML sign-in with built-in auth ([Auth](services/auth.md)) | `^5.1.0` | None | MIT |

None of them needs a compiler, a system library or a licence key.

## Installed by default?

| Package group | From source (`npm ci` / `npm install`) | Docker image built from the `Dockerfile` | Vercel |
|---|---|---|---|
| Snowflake, Oracle, MongoDB drivers | Yes | **No**: build with `INCLUDE_OPTIONAL_DB_DRIVERS=true` (about 40 MB more) | Yes |
| Storage SDKs (S3, Azure Blob, Cloud Storage) | Yes | Yes: `INCLUDE_STORAGE_SDKS=false` drops them | Yes |
| Email, secrets and KMS SDKs (except Key Vault keys) | Yes | Yes: `INCLUDE_PROVIDER_SDKS=false` drops them | Yes |
| `@azure/keyvault-keys`, `@node-saml/node-saml` | Yes | Always | Yes |

There is no prebuilt public image: you build the image from this
repository's `Dockerfile`, so the build args above are how you choose.

## From source (Node)

`npm ci` and `npm install` install optional packages by default. Check one
with `npm ls snowflake-sdk`: npm skips an optional package that fails to
download or install instead of failing the whole install, so "empty" means
it is missing.

```bash
npm ci                                   # everything in package-lock.json, optional packages included
npm ls snowflake-sdk oracledb mongodb    # confirm
npm run build && npm run start
```

Adding one that was left out (versions from the table above):

```bash
npm install snowflake-sdk@^2.4.0         # or oracledb@^6.10.0, mongodb@^7.1.1, nodemailer@^10.2.1, …
npm run build                            # required: the stub was chosen at build time
npm run start
```

`npm run dev` decides when it starts, so restarting the dev server is
enough there.

To leave a package out, delete its folder before building
(`rm -rf node_modules/snowflake-sdk`) or `npm uninstall` it (which edits
`package.json` and the lockfile). Don't use `npm ci --omit=optional`: it
also drops the platform binaries that Next.js, Tailwind and lightningcss
install as optional dependencies, and the build fails.

## Docker

The `Dockerfile` runs `npm ci` and then removes the groups you did not ask
for, before `next build`, so the standalone output (and `worker.cjs`,
`admin.cjs`) contains exactly the drivers you chose.

```bash
# Snowflake, Oracle and MongoDB on top of the defaults
docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://tasks.example.com \
  --build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true \
  -t usertasks:with-drivers .

# Smallest image: no optional packages except Key Vault keys and SAML
docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://tasks.example.com \
  --build-arg INCLUDE_STORAGE_SDKS=false \
  --build-arg INCLUDE_PROVIDER_SDKS=false \
  -t usertasks:slim .
```

With Docker Compose, put the same names in `.env` (`docker-compose.yml`
passes `INCLUDE_OPTIONAL_DB_DRIVERS`, `INCLUDE_STORAGE_SDKS` and
`INCLUDE_PROVIDER_SDKS` to the build), then `docker compose up --build`.

Check what an image contains. Database drivers are bundled into the server
chunks (their `node_modules` folders only hold a few traced files), so look
for the stub instead: a package listed here was **not** included.

```bash
docker run --rm --entrypoint sh usertasks:with-drivers -c \
  'grep -rhoE "Cannot find module .(snowflake-sdk|oracledb|mongodb|nodemailer|@(aws-sdk|azure|google-cloud|node-saml)/[a-z0-9-]+)." .next/server | sort -u'
```

> [!WARNING]
> You can't add a driver to a finished image with a `FROM usertasks` layer
> that runs `npm install snowflake-sdk`. The server bundle already contains
> the stub, so the driver would never load. Rebuild from source with the
> build arg instead.

## Kubernetes and Helm

Build the image with the build args you need (above), push it to your
registry and reference it in your manifests or chart values. The same image
runs the web server (`node server.js`), the worker (`node worker.cjs`) and
the migration Job (`node admin.cjs db migrate`), so all three get the same
drivers. Tag images by what they contain (for example
`usertasks:1.4.0-dbdrivers`) so a later rebuild doesn't drop a driver by
accident.

## Vercel

Vercel runs `npm install`, which installs every optional package in
`package-lock.json`, so every connector and provider works without changes.
Installed database drivers are bundled into the server functions;
`snowflake-sdk` is the largest and brings its own cloud storage clients.
A build with everything included fits Vercel's function size limit. To
trim a deployment anyway, set the project's Install Command to remove what
you don't use:

```bash
npm ci && rm -rf node_modules/snowflake-sdk node_modules/oracledb node_modules/mongodb
```

## Air-gapped installs

Prepare on a connected machine with the same OS, CPU architecture and Node
version as the target:

- **Docker (simplest).** Build the image with the build args you need,
  `docker save` it, and load or push it into the internal registry. The
  image needs no network access to add drivers later because there is
  nothing to add: choose them at build time.
- **From source.** Fill an npm cache online, copy the repository and the
  cache across, and install offline:

  ```bash
  # connected machine
  npm ci --cache ./npm-cache
  # copy the repository (with ./npm-cache) to the target, then
  npm ci --offline --cache ./npm-cache
  npm run build
  ```

  Or run `npm ci && npm run build` on the connected machine and copy the
  built tree (`node_modules`, `.next`, `public`), or the standalone output
  (`NEXT_OUTPUT_STANDALONE=true`), across.
- **An internal registry** (Artifactory, Nexus, Verdaccio) works as usual:
  point `npm config set registry` at it and mirror the packages and versions
  in `package-lock.json`.

See [On-premises and air-gapped](topologies/on-premises.md#air-gapped-installs)
for the rest of an air-gapped install.

## Checking for a missing package

A missing package shows up where the feature is used, with the package, the
version to install, the rebuild, the Docker build arg and this page:

| Where | Message (example) |
|---|---|
| Connector **Test connection**, and every query of a Snowflake, Oracle or MongoDB connector | The Snowflake connector requires the optional package snowflake-sdk; install it with `npm install snowflake-sdk@^2.4.0`, then rebuild (`npm run build`) and restart (Docker: rebuild the image with --build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true). See /docs/self-hosting/optional-drivers. |
| File uploads and downloads | This storage provider needs the optional package @aws-sdk/client-s3: install it with `npm install @aws-sdk/client-s3@^3.1156.0`, then rebuild … |
| Sending email | EMAIL_PROVIDER=smtp needs the optional package nodemailer: install it with `npm install nodemailer@^10.2.1`, then rebuild … |
| Resolving `secret://` references | SECRETS_PROVIDER=gcp_secret_manager needs the optional package @google-cloud/secret-manager: … |
| Envelope encryption | KMS_PROVIDER=aws_kms needs the optional package @aws-sdk/client-kms: … |
| SAML sign-in | SAML sign-in needs the optional package @node-saml/node-saml: … |

`usertasks-admin doctor` checks storage, secrets and KMS by using the
configured provider (email too with `--email-to <address>`), so a missing
SDK fails that area's check with the same message. Run it after changing providers or building a new image. The
connector form's setup hint for Snowflake, Oracle and MongoDB links here
too.

## Snowflake

- **Account identifier.** `orgname-accountname` (preferred) or the account
  locator with its region and cloud, such as `xy12345.us-east-1` or
  `xy12345.east-us-2.azure`. Leave out `.snowflakecomputing.com`.
- **Warehouse, database** (required), **schema** (default `PUBLIC`) and an
  optional **role**.
- **Authentication: username and password only.** Key-pair, OAuth and
  browser SSO are not supported by the connector yet. Snowflake is phasing
  out single-factor password sign-in for people, so use a dedicated service
  user that your Snowflake policy still allows to use a password, restricted
  by a network policy to your app's egress addresses, with a role that has
  only the grants the workflows need.
- **Network.** The app connects out to `<account>.snowflakecomputing.com` on
  443 and, for large result sets, downloads result chunks from Snowflake's
  cloud storage (S3, Azure Blob or Google Cloud Storage URLs in the same
  region); the driver also checks certificate revocation (OCSP). Allow these
  through your egress firewall. `ALLOW_PRIVATE_EGRESS` isn't needed: it
  guards a connector's host, and Snowflake connectors are addressed by
  account identifier.
- **PrivateLink.** Use the PrivateLink form of the identifier
  (`xy12345.us-east-1.privatelink`) and make sure your DNS resolves the
  `…privatelink.snowflakecomputing.com` names to your endpoint.
- **Proxy.** The driver honours `HTTPS_PROXY` and `NO_PROXY` in the app's
  environment. Set `NODE_EXTRA_CA_CERTS` if the proxy re-signs TLS.

## Oracle

- **Thin mode, always.** `oracledb` 6 connects in pure JavaScript (thin
  mode), with no Oracle Instant Client, to Oracle Database 12.1 and later.
  The connector does not switch to thick mode, so features that need it
  (Native Network Encryption and checksumming, some older database versions,
  external authentication) are not available: use TLS (TCPS) for
  encryption, for example with a TNS descriptor.
- **Connection types.** Host, port and service name, host and SID, or a
  full TNS descriptor / Easy Connect string.
- **Network.** A private database host needs `ALLOW_PRIVATE_EGRESS=true`;
  trust a private CA with `NODE_EXTRA_CA_CERTS`.

## MongoDB

- **Connection string.** `mongodb://…` or `mongodb+srv://…` (required).
  Username and password fields are merged into it when the string has none.
- **SRV** (`mongodb+srv://`, as Atlas gives you) needs DNS SRV and TXT
  lookups from the app, and turns TLS on by default.
- **TLS.** With `mongodb://`, add `tls=true` to the options. Trust a private
  CA with `NODE_EXTRA_CA_CERTS`.
- **Network.** A host that resolves to a private address (on-premises,
  Atlas private endpoints) needs `ALLOW_PRIVATE_EGRESS=true`.

## Providers

- **SMTP email** (`nodemailer`): see [Email](services/email.md).
- **Storage SDKs**: see [File storage](services/storage.md).
- **Secret stores** (AWS Secrets Manager, Azure Key Vault, Google Secret
  Manager): see [Secrets](services/secrets.md).
- **KMS** (AWS KMS, Azure Key Vault keys; Google Cloud KMS and Vault Transit
  need no optional package): see [KMS](services/kms.md).
- **SAML** (`@node-saml/node-saml`): see [Auth](services/auth.md).
