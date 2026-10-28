# Release notes: optional drivers guide

A new page, [Optional drivers](../optional-drivers.md), explains how to
install the Snowflake, Oracle and MongoDB drivers and the other optional
packages (storage, email, secrets and KMS SDKs, and the SAML library), for
installs from source, the Docker image, Kubernetes, Vercel and air-gapped
networks. It also covers the Snowflake, Oracle and MongoDB connection details.

## Changed

- **Install messages say to rebuild.** A missing optional package is
  replaced by a stub when the app is built, so restarting after
  `npm install` was not enough. Every "needs the optional package" error
  (connector Test connection and queries, storage, email, secrets, KMS and
  SAML) now gives the version to install, says to rebuild and restart,
  names the Docker build arg, and links to `/docs/self-hosting/optional-drivers`:

  > The Snowflake connector requires the optional package snowflake-sdk;
  > install it with `npm install snowflake-sdk@^2.4.0`, then rebuild
  > (`npm run build`) and restart (Docker: rebuild the image with
  > --build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true). See
  > /docs/self-hosting/optional-drivers.

- **One list of optional packages** (`lib/optional-drivers`), used by
  `next.config.ts` and by the error messages. A test checks it against
  `package.json`, the stubs and the `Dockerfile` build args.
- **Docker Compose** passes `INCLUDE_STORAGE_SDKS` and
  `INCLUDE_PROVIDER_SDKS` to the image build, as well as
  `INCLUDE_OPTIONAL_DB_DRIVERS`.

What the image includes by default is unchanged: the three database drivers
are left out unless you build with `INCLUDE_OPTIONAL_DB_DRIVERS=true`, and the
storage, email, secrets, KMS and SAML packages are included. No migrations.
