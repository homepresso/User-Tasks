// Bundled in place of @aws-sdk/s3-request-presigner when it is not installed at build time (see
// next.config.ts). Importing it fails like a missing module, which
// lib/providers/storage/optional-sdk.ts turns into an "install the optional package" error.
throw Object.assign(new Error("Cannot find module '@aws-sdk/s3-request-presigner'"), { code: "MODULE_NOT_FOUND" })

export {}
