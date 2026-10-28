// Bundled in place of @aws-sdk/rds-signer when it is not installed at build time (see
// next.config.ts). Importing it fails like a missing module, which the caller
// turns into an "install the optional package" error.
throw Object.assign(new Error("Cannot find module '@aws-sdk/rds-signer'"), { code: "MODULE_NOT_FOUND" })

export {}
