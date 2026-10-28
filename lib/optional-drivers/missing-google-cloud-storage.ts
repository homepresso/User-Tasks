// Bundled in place of @google-cloud/storage when it is not installed at build time (see
// next.config.ts). Importing it fails like a missing module, which
// lib/providers/storage/optional-sdk.ts turns into an "install the optional package" error.
throw Object.assign(new Error("Cannot find module '@google-cloud/storage'"), { code: "MODULE_NOT_FOUND" })

export {}
